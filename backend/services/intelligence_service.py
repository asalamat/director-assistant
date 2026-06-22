"""
Role-transition intelligence: briefing, people graph, open loops, project clusters.
"""
import asyncio
import json
import re
import time
import logging
from collections import defaultdict
from typing import AsyncIterator, TYPE_CHECKING

if TYPE_CHECKING:
    from services.email_cache import EmailCache
    from services.ai_client import AIClient
    from services.rag_engine import RAGEngine

logger = logging.getLogger(__name__)

_CACHE: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 300


def _cached(key: str, ttl: int = _CACHE_TTL):
    entry = _CACHE.get(key)
    if entry and time.time() - entry[0] < ttl:
        return entry[1]
    return None


def _store(key: str, value: object):
    _CACHE[key] = (time.time(), value)


class IntelligenceService:
    def __init__(self, ai: "AIClient", cache: "EmailCache", rag: "RAGEngine"):
        self.ai = ai
        self.cache = cache
        self.rag = rag

    # ── People Graph ─────────────────────────────────────────────────────────

    def get_people(self, limit: int = 60) -> list[dict]:
        """Extract top contacts from email corpus with interaction stats."""
        cached = _cached("people")
        if cached is not None:
            return cached

        freq: dict[str, dict] = defaultdict(lambda: {
            "email": "", "name": "", "sent_count": 0, "received_count": 0,
            "subjects": [], "last_contact": ""
        })

        sys_filter = self._system_email_filter()
        with self.cache._conn() as conn:
            rows = conn.execute(
                f"SELECT sender, recipients, subject, date FROM emails WHERE 1=1 {sys_filter} ORDER BY date DESC"
            ).fetchall()

        for row in rows:
            sender = row["sender"] or ""
            subj = (row["subject"] or "").strip()
            date_str = row["date"] or ""

            sender_email, sender_name = _parse_address(sender)
            if sender_email and not _is_automated(sender_email):
                e = freq[sender_email]
                e["email"] = sender_email
                if not e["name"] and sender_name:
                    e["name"] = sender_name
                e["received_count"] += 1
                if subj and len(e["subjects"]) < 3 and subj not in e["subjects"]:
                    e["subjects"].append(subj)
                if date_str and (not e["last_contact"] or date_str > e["last_contact"]):
                    e["last_contact"] = date_str

            try:
                recipients = json.loads(row["recipients"] or "[]")
            except Exception:
                recipients = []
            for addr in recipients:
                recp_email, recp_name = _parse_address(str(addr))
                if recp_email and not _is_automated(recp_email):
                    e = freq[recp_email]
                    e["email"] = recp_email
                    if not e["name"] and recp_name:
                        e["name"] = recp_name
                    e["sent_count"] += 1
                    if date_str and (not e["last_contact"] or date_str > e["last_contact"]):
                        e["last_contact"] = date_str

        people = []
        for addr, data in freq.items():
            if not data["name"]:
                data["name"] = addr.split("@")[0].replace(".", " ").title()
            score = data["received_count"] * 2 + data["sent_count"]
            people.append({**data, "score": score})

        # Merge entries that share the same name (same person, multiple email addresses)
        name_groups: dict[str, list] = defaultdict(list)
        for p in people:
            key = (p["name"] or "").strip().lower()
            if key:
                name_groups[key].append(p)
            # Anonymous / no-name entries kept as-is
        merged: list[dict] = []
        for key, group in name_groups.items():
            if len(group) == 1:
                merged.append(group[0])
            else:
                group.sort(key=lambda p: p["score"], reverse=True)
                primary = dict(group[0])  # highest-score entry as base
                for other in group[1:]:
                    primary["received_count"] += other["received_count"]
                    primary["sent_count"] += other["sent_count"]
                    primary["score"] += other["score"]
                    if (other["last_contact"] or "") > (primary["last_contact"] or ""):
                        primary["last_contact"] = other["last_contact"]
                    for s in other["subjects"]:
                        if s not in primary["subjects"] and len(primary["subjects"]) < 5:
                            primary["subjects"].append(s)
                merged.append(primary)

        merged.sort(key=lambda p: p["score"], reverse=True)
        result = merged[:limit]
        _store("people", result)
        return result

    # ── Open Loops ────────────────────────────────────────────────────────────

    async def get_open_loops(self, max_emails: int = 300) -> list[dict]:
        """AI-powered scan for unresolved commitments and awaited responses."""
        cached = _cached("open_loops", ttl=600)
        if cached is not None:
            return cached

        sys_filter = self._system_email_filter()
        with self.cache._conn() as conn:
            rows = conn.execute(
                f"""SELECT id, subject, sender, body, date FROM emails
                   WHERE 1=1 {sys_filter}
                   ORDER BY date ASC LIMIT ?""",
                (max_emails,)
            ).fetchall()

        if not rows:
            return []

        # Use last 150 emails (most recent) in chronological order so
        # commitments and their replies land in the same batch
        recent = rows[-150:] if len(rows) > 150 else rows
        batches = [recent[i:i+25] for i in range(0, len(recent), 25)]

        async def process_batch(batch) -> list[dict]:
            text_blocks = []
            for row in batch:
                snip = (row["body"] or "")[:300].replace("\n", " ")
                text_blocks.append(
                    f"[{row['date'] or '?'}] From: {row['sender'] or '?'} | "
                    f"Subject: {row['subject'] or '?'} | Snippet: {snip}"
                )
            prompt = (
                "Analyze these emails in chronological order and identify ONLY open/unresolved items:\n"
                "1. Commitments made (I will, I'll, we will, will send, will follow up, will get back)\n"
                "2. Responses awaited (please let me know, waiting for, can you, need your response, please confirm)\n"
                "3. Deadlines or time-sensitive items mentioned\n\n"
                "IMPORTANT: If a later email in this list shows the commitment was fulfilled, "
                "the response was received, or the matter was resolved — do NOT include it. "
                "Only include items with no visible resolution in this email set.\n\n"
                "Return ONLY a JSON array (empty [] if none). Each item has keys:\n"
                "- type: 'commitment' | 'awaiting' | 'deadline'\n"
                "- text: one-sentence description of the open item\n"
                "- sender: who is involved\n"
                "- date: date string from the email\n"
                "- urgency: 'high' | 'medium' | 'low'\n\n"
                "Emails (oldest to newest):\n" + "\n---\n".join(text_blocks)
            )
            try:
                resp = await self.ai.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=1000,
                    messages=[{"role": "user", "content": prompt}]
                )
                text = resp.content[0].text.strip()
                m = re.search(r'\[.*\]', text, re.DOTALL)
                if m:
                    items = json.loads(m.group())
                    if isinstance(items, list):
                        return items
            except Exception as e:
                logger.warning(f"[intelligence] open_loops batch failed: {e}")
            return []

        results = await asyncio.gather(*[process_batch(b) for b in batches])
        all_loops = [item for batch_result in results for item in batch_result]

        _store("open_loops", all_loops)
        return all_loops

    # ── Project Clusters ──────────────────────────────────────────────────────

    async def get_clusters(self, max_emails: int = 400) -> list[dict]:
        """Group emails into project/topic clusters using AI subject analysis.

        The AI assigns line indices per cluster; we resolve those to real email IDs
        so Timeline can fetch exact members without any text search.
        """
        cached = _cached("clusters", ttl=600)
        if cached is not None:
            return cached

        sys_filter = self._system_email_filter()
        with self.cache._conn() as conn:
            rows = conn.execute(
                f"""SELECT id, subject, sender, date FROM emails
                   WHERE 1=1 {sys_filter}
                   ORDER BY date DESC LIMIT ?""",
                (max_emails,)
            ).fetchall()

        if not rows:
            return []

        sample = rows[:300]
        subjects_text = "\n".join(
            f"{i}: {r['date'] or '?'} | {r['subject'] or '(no subject)'} | {r['sender'] or ''}"
            for i, r in enumerate(sample)
        )

        prompt = (
            "Analyze these indexed email subjects and group them into 6-12 meaningful project/topic clusters.\n"
            "Each cluster = a distinct ongoing thread, project, or recurring topic.\n\n"
            "Return ONLY a JSON array. Each cluster object has these keys:\n"
            "- id: short kebab-case slug\n"
            "- name: cluster name (2-5 words)\n"
            "- description: one-sentence summary of what this cluster is about\n"
            "- member_indices: array of integer line indices (the numbers before the colon) that belong to this cluster\n"
            "- last_activity: most recent date string seen in this cluster\n"
            "- keywords: array of 3-5 search keywords for this cluster\n"
            "- status: 'active' | 'dormant' | 'resolved'\n\n"
            "IMPORTANT: member_indices must be exact integers from the numbered list below.\n\n"
            "Emails (index: date | subject | sender):\n" + subjects_text
        )

        try:
            resp = await self.ai.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=4000,
                messages=[{"role": "user", "content": prompt}]
            )
            text = resp.content[0].text.strip()
            m = re.search(r'\[.*\]', text, re.DOTALL)
            if not m:
                logger.warning("[intelligence] clusters: no JSON array found in AI response")
                return []
            clusters = json.loads(m.group())
            if not isinstance(clusters, list):
                return []
            # Resolve member_indices → actual email IDs
            for cluster in clusters:
                indices = cluster.pop("member_indices", []) or []
                email_ids = []
                for idx in indices:
                    if isinstance(idx, int) and 0 <= idx < len(sample):
                        email_ids.append(sample[idx]["id"])
                cluster["email_ids"] = email_ids
                cluster["email_count"] = len(email_ids) or cluster.get("email_count", 0)
            _store("clusters", clusters)
            return clusters
        except Exception as e:
            logger.warning(f"[intelligence] clusters failed: {e}")
            raise

    # ── Timeline ──────────────────────────────────────────────────────────────

    def get_emails_by_ids(self, email_ids: list[str], limit: int = 60) -> list[dict]:
        """Fetch emails by exact ID list — used for cluster member lookup."""
        if not email_ids:
            return []
        ids = email_ids[:limit]
        placeholders = ",".join("?" * len(ids))
        with self.cache._conn() as conn:
            rows = conn.execute(
                f"""SELECT id, subject, sender, date, body FROM emails
                   WHERE id IN ({placeholders})
                   ORDER BY date ASC""",
                ids
            ).fetchall()
        return [
            {
                "id": r["id"],
                "subject": r["subject"] or "",
                "sender": r["sender"] or "",
                "date": r["date"] or "",
                "snippet": (r["body"] or "")[:200].replace("\n", " "),
            }
            for r in rows
        ]

    # Subjects of emails the app generates and sends to itself — exclude from searches
    _SYSTEM_SUBJECT_PREFIXES = (
        "weekly brief — director assistant",
        "director assistant digest",
        "your director assistant weekly brief",
        "director assistant webhook",
    )

    def _system_email_filter(self) -> str:
        """SQL fragment excluding app-generated emails from result sets."""
        clauses = " AND ".join(
            f"LOWER(subject) NOT LIKE '{p}%'" for p in self._SYSTEM_SUBJECT_PREFIXES
        )
        return f"AND ({clauses})"

    def get_timeline(self, query: str, limit: int = 60) -> list[dict]:
        """Chronological timeline of emails matching a topic/cluster query.

        Strictness-first: never broaden to OR — false positives are worse than no results.
        1. FTS5 exact phrase       → "choice properties interview"
        2. FTS5 AND all tokens     → choice AND properties AND interview AND automation
        3. FTS5 AND top-2 tokens   → choice AND automation  (2 longest/most distinctive)
        4. LIKE subject only on single rarest token (longest, no common words)
        """
        sys_filter = self._system_email_filter()
        _stop = {'the', 'and', 'for', 'from', 'with', 'this', 'that', 'are',
                 'was', 'has', 'have', 'not', 'but', 'all', 'our', 'can',
                 'will', 'been', 'your', 'their', 'they', 'about', 'also',
                 'email', 'hello', 'dear', 'please', 'regards', 'thank',
                 'just', 'like', 'more', 'some', 'than', 'what', 'when'}
        tokens = [t.strip('.,!?') for t in query.split()
                  if len(t.strip('.,!?')) > 3 and t.lower().strip('.,!?') not in _stop]

        rows: list = []
        with self.cache._conn() as conn:
            def _fts(q: str) -> list:
                try:
                    return conn.execute(
                        f"""SELECT e.id, e.subject, e.sender, e.date, e.body
                           FROM emails e JOIN emails_fts f ON e.rowid = f.rowid
                           WHERE emails_fts MATCH ?
                           {sys_filter}
                           ORDER BY e.date ASC LIMIT ?""",
                        (q, limit)
                    ).fetchall()
                except Exception:
                    return []

            # 1. Exact phrase
            rows = _fts(f'"{query}"')

            # 2. AND all tokens — requires every token to be present
            if not rows and len(tokens) > 1:
                rows = _fts(" AND ".join(tokens))

            # 3. AND with only the 2 longest (most distinctive) tokens
            if not rows and len(tokens) > 2:
                top2 = sorted(tokens, key=len, reverse=True)[:2]
                rows = _fts(" AND ".join(top2))

            # 4. LIKE subject-only on the single longest token — NO OR, stays precise
            if not rows and tokens:
                anchor = sorted(tokens, key=len, reverse=True)[0]
                if len(anchor) > 5:  # skip generic short words even if they're longest
                    try:
                        rows = conn.execute(
                            f"""SELECT id, subject, sender, date, body FROM emails
                               WHERE subject LIKE ?
                               {sys_filter}
                               ORDER BY date ASC LIMIT ?""",
                            (f"%{anchor}%", limit)
                        ).fetchall()
                    except Exception:
                        rows = []

        return [
            {
                "id": r["id"],
                "subject": r["subject"] or "",
                "sender": r["sender"] or "",
                "date": r["date"] or "",
                "snippet": (r["body"] or "")[:200].replace("\n", " "),
            }
            for r in rows
        ]

    # ── Briefing Stream ───────────────────────────────────────────────────────

    async def stream_briefing(self):
        """Yield JSON lines for SSE — structured role-transition briefing."""

        def evt(section: str, content) -> str:
            return json.dumps({"section": section, "content": content}) + "\n"

        yield evt("status", "Analyzing key relationships…")
        people = self.get_people(limit=10)
        if people:
            lines = [
                f"{p['name']} ({p['email']}) — {p['received_count']} from, {p['sent_count']} to, last: {p['last_contact'][:10] if p['last_contact'] else '?'}"
                for p in people[:8]
            ]
            yield evt("people", lines)

        yield evt("status", "Identifying projects and scanning commitments…")
        clusters, loops = await asyncio.gather(
            self.get_clusters(),
            self.get_open_loops(max_emails=150),
        )
        if clusters:
            yield evt("projects", clusters)

        if loops:
            high = [l for l in loops if l.get("urgency") == "high"]
            others = [l for l in loops if l.get("urgency") != "high"]
            yield evt("loops", (high + others)[:15])

        yield evt("status", "Generating executive summary…")

        sys_filter = self._system_email_filter()
        with self.cache._conn() as conn:
            stats = conn.execute(
                f"SELECT COUNT(*) as cnt, MIN(date) as oldest, MAX(date) as newest FROM emails WHERE 1=1 {sys_filter}"
            ).fetchone()

        email_count = stats["cnt"] if stats else 0
        oldest = (stats["oldest"] or "")[:10] if stats else ""
        newest = (stats["newest"] or "")[:10] if stats else ""
        project_names = ", ".join(c["name"] for c in clusters[:6]) if clusters else "none detected"
        contact_names = ", ".join(p["name"] for p in people[:5]) if people else "none detected"

        summary_prompt = (
            f"You are briefing someone who just joined a new company and took over a role. "
            f"Based on {email_count} emails from {oldest} to {newest}, write a concise 3-paragraph "
            f"executive briefing covering:\n"
            f"1. Overall state of affairs and most important ongoing work\n"
            f"2. Key relationships to prioritize immediately\n"
            f"3. Recommended actions for their first week\n\n"
            f"Context:\n"
            f"- Active projects: {project_names}\n"
            f"- Top contacts: {contact_names}\n"
            f"- Open items: {len(loops)} pending commitments/responses found\n\n"
            f"Write in second person. Be specific and actionable. 3 short paragraphs max."
        )

        try:
            resp = await self.ai.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=700,
                messages=[{"role": "user", "content": summary_prompt}]
            )
            yield evt("summary", resp.content[0].text)
        except Exception as e:
            yield evt("summary", f"Summary unavailable: {e}")

        yield evt("done", "")

    def invalidate_cache(self):
        """Clear cached results so next request recomputes."""
        _CACHE.clear()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_address(addr: str) -> tuple[str, str]:
    if not addr:
        return "", ""
    m = re.search(r'<([^>]+)>', addr)
    if m:
        email = m.group(1).strip().lower()
        name = addr[:addr.index('<')].strip().strip('"').strip("'").strip()
        return email, name
    addr = addr.strip()
    if '@' in addr:
        return addr.lower(), ""
    return "", ""


def _is_automated(email: str) -> bool:
    skip = ('noreply', 'no-reply', 'donotreply', 'notifications@', 'mailer@',
            'bounce', 'postmaster', 'daemon', 'auto-confirm', 'alerts@',
            'newsletter@', 'unsubscribe')
    el = email.lower()
    return any(s in el for s in skip)
