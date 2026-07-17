"""Intelligence endpoints — people graph, open loops, clusters, timeline, briefing."""

import asyncio
import json
import re
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])


@router.get("/people")
async def get_people(request: Request, limit: int = 60):
    svc = getattr(request.app.state, "intelligence", None)
    if not svc:
        return {"people": [], "error": "Intelligence service not available"}
    people = svc.get_people(limit=limit)
    return {"people": people}


def _cluster_overrides(cache) -> dict:
    """Return {cluster_id: status} for all manually overridden clusters."""
    try:
        with cache._conn() as conn:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS cluster_overrides
                   (cluster_id TEXT PRIMARY KEY, status TEXT, updated_at TEXT)"""
            )
            rows = conn.execute(
                "SELECT cluster_id, status FROM cluster_overrides"
            ).fetchall()
        return {r["cluster_id"]: r["status"] for r in rows}
    except Exception:
        return {}


@router.get("/clusters")
async def get_clusters(request: Request, show_disabled: bool = False):
    svc = getattr(request.app.state, "intelligence", None)
    if not svc:
        return {"clusters": [], "error": "Intelligence service not available"}
    try:
        clusters = await svc.get_clusters()
    except Exception:
        clusters = []

    cache = getattr(request.app.state, "cache", None)
    if cache:
        overrides = _cluster_overrides(cache)
        for c in clusters:
            if c.get("id") in overrides:
                c["status"] = overrides[c["id"]]
        if not show_disabled:
            clusters = [c for c in clusters if c.get("status") != "disabled"]

    return {"clusters": clusters}


class ClusterStatusUpdate(BaseModel):
    status: str


@router.patch("/clusters/{cluster_id}")
async def update_cluster_status(cluster_id: str, req: ClusterStatusUpdate, request: Request):
    """Persist a manual status override for a cluster (active/dormant/resolved/disabled)."""
    valid = {"active", "dormant", "resolved", "disabled"}
    if req.status not in valid:
        raise HTTPException(400, f"status must be one of {sorted(valid)}")
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        raise HTTPException(503, "Cache not available")
    with cache._conn() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS cluster_overrides
               (cluster_id TEXT PRIMARY KEY, status TEXT, updated_at TEXT)"""
        )
        if req.status == "disabled":
            conn.execute(
                """INSERT INTO cluster_overrides (cluster_id, status, updated_at)
                   VALUES (?, ?, datetime('now'))
                   ON CONFLICT(cluster_id) DO UPDATE
                   SET status=excluded.status, updated_at=excluded.updated_at""",
                (cluster_id, req.status),
            )
        else:
            conn.execute(
                "DELETE FROM cluster_overrides WHERE cluster_id = ?", (cluster_id,)
            )
    return {"status": req.status, "cluster_id": cluster_id}


@router.post("/clusters/generate")
async def generate_clusters(request: Request):
    """Force-regenerate clusters by clearing cache then running AI analysis."""
    svc = getattr(request.app.state, "intelligence", None)
    if not svc:
        return {"clusters": [], "error": "Intelligence service not available"}
    svc.invalidate_cache()
    try:
        clusters = await svc.get_clusters()
    except Exception as e:
        return {"clusters": [], "error": str(e)}
    return {"clusters": clusters}


@router.get("/timeline")
async def get_timeline(request: Request, q: str = "", ids: str = "", limit: int = 60):
    svc = getattr(request.app.state, "intelligence", None)
    if not svc:
        return {"events": []}
    # If caller provides explicit email IDs (from cluster membership), fetch those directly
    if ids.strip():
        id_list = [i.strip() for i in ids.split(",") if i.strip()]
        events = svc.get_emails_by_ids(id_list, limit=limit)
        return {"events": events}
    if not q.strip():
        return {"events": []}
    events = svc.get_timeline(q.strip(), limit=limit)
    return {"events": events}


@router.post("/loops")
async def get_open_loops(request: Request):
    svc = getattr(request.app.state, "intelligence", None)
    if not svc:
        return {"loops": [], "error": "Intelligence service not available"}
    loops = await svc.get_open_loops()
    return {"loops": loops}


@router.post("/briefing")
async def stream_briefing(request: Request):
    svc = getattr(request.app.state, "intelligence", None)
    if not svc:
        async def err():
            yield 'data: {"section":"done","content":"Service not available"}\n\n'
        return StreamingResponse(err(), media_type="text/event-stream")

    async def generate():
        try:
            async for line in svc.stream_briefing():
                yield f"data: {line}\n"
        except Exception as e:
            yield f'data: {json.dumps({"section":"error","content":str(e)})}\n\n'
        yield "data: {\"section\":\"done\",\"content\":\"\"}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/invalidate")
async def invalidate_cache(request: Request):
    svc = getattr(request.app.state, "intelligence", None)
    if svc:
        svc.invalidate_cache()
    return {"status": "ok"}


_PHONE_RE = re.compile(r'\+?[\d][\d\s\-\.\(\)]{7,18}[\d]')


def _extract_phones(text: str) -> list[str]:
    """Return phone strings that contain at least 10 digits."""
    found = []
    for m in _PHONE_RE.finditer(text):
        raw = m.group(0).strip()
        if len(re.sub(r'\D', '', raw)) >= 10:
            found.append(raw)
    return found


def _scan_signature(body: str) -> list[str]:
    """Scan the last 3 non-empty lines of an email body for phone numbers."""
    lines = [l for l in body.splitlines() if l.strip()]
    tail = '\n'.join(lines[-3:]) if len(lines) >= 3 else '\n'.join(lines)
    return _extract_phones(tail)


@router.get("/contact-hints")
async def get_contact_hints(request: Request):
    """Return phone numbers per email address from 3 sources:
    email signatures, Microsoft Graph contacts, and indexed documents."""
    cache = getattr(request.app.state, "cache", None)
    rag = getattr(request.app.state, "rag", None)

    hints: dict[str, dict] = {}

    def _merge(email: str, phones: list[str], source: str):
        key = email.lower()
        if not key:
            return
        entry = hints.setdefault(key, {"phones": [], "sources": []})
        for ph in phones:
            if ph not in entry["phones"]:
                entry["phones"].append(ph)
        if source not in entry["sources"]:
            entry["sources"].append(source)

    # --- Source 1: email signatures ---
    if cache:
        try:
            with cache._conn() as conn:
                rows = conn.execute(
                    """
                    SELECT sender, body FROM emails
                    WHERE body IS NOT NULL AND length(body) > 50
                    GROUP BY LOWER(sender)
                    HAVING MAX(date)
                    ORDER BY MAX(date) DESC
                    LIMIT 500
                    """
                ).fetchall()
            for sender, body in rows:
                phones = _scan_signature(body)
                if phones:
                    _merge(sender, phones, "email")
        except Exception:
            pass

    # --- Source 2: Microsoft Graph contacts ---
    if cache:
        try:
            import httpx
            accounts = cache.list_accounts()
            acc = next(
                (a for a in accounts
                 if getattr(a, "access_token", None) and not getattr(a, "password", None)),
                None,
            )
            if acc:
                token = acc.access_token
                graph_url = (
                    "https://graph.microsoft.com/v1.0/me/contacts"
                    "?$select=emailAddresses,homePhones,mobilePhone,businessPhones&$top=200"
                )

                async def _graph_get(tok: str) -> dict:
                    async with httpx.AsyncClient(timeout=10) as c:
                        r = await c.get(graph_url, headers={"Authorization": f"Bearer {tok}"})
                        return r.status_code, r.json() if r.status_code in (200, 401) else {}

                status, data = await _graph_get(token)
                if status == 401:
                    new_token = await asyncio.get_event_loop().run_in_executor(
                        None, cache.refresh_oauth_token, acc.id
                    )
                    if new_token:
                        status, data = await _graph_get(new_token)

                if status == 200:
                    for contact in data.get("value", []):
                        phones: list[str] = []
                        for field in ("homePhones", "businessPhones"):
                            phones.extend(contact.get(field) or [])
                        mobile = contact.get("mobilePhone")
                        if mobile:
                            phones.append(mobile)
                        phones = [p for p in phones if len(re.sub(r'\D', '', p)) >= 10]
                        for addr_obj in contact.get("emailAddresses") or []:
                            email = (addr_obj.get("address") or "").strip()
                            if email and phones:
                                _merge(email, phones, "microsoft")
        except Exception:
            pass

    # --- Source 3: indexed documents ---
    if rag:
        try:
            results = rag.semantic_search("phone contact mobile tel", n=50)
            email_re = re.compile(r'[\w._%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}')
            for chunk in results:
                if getattr(chunk, "source_type", None) != "document":
                    continue
                text = getattr(chunk, "text", "") or getattr(chunk, "content", "") or ""
                phones = _extract_phones(text)
                if not phones:
                    continue
                emails_in_chunk = email_re.findall(text)
                for email in emails_in_chunk:
                    _merge(email, phones, "document")
        except Exception:
            pass

    # --- Source 4: manually imported contacts (vCard / CSV) ---
    if cache:
        try:
            with cache._conn() as conn:
                rows = conn.execute(
                    "SELECT email_addr, phones FROM imported_contacts WHERE phones != '[]'"
                ).fetchall()
            for row in rows:
                phones = json.loads(row["phones"] or "[]")
                if phones:
                    _merge(row["email_addr"], phones, "imported")
        except Exception:
            pass

    # Remove entries with no phones
    hints = {k: v for k, v in hints.items() if v["phones"]}

    return {"hints": hints}


@router.get("/people/{email}/heatmap")
async def get_contact_heatmap(email: str, request: Request):
    """Return daily email counts for a contact over the last 90 days."""
    from datetime import datetime, timedelta, timezone
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        return {"heatmap": []}

    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=89)  # 90 days inclusive

    try:
        with cache._conn() as conn:
            rows = conn.execute(
                """
                SELECT DATE(date) as day, COUNT(*) as cnt
                FROM emails
                WHERE LOWER(sender) = LOWER(?)
                  AND DATE(date) >= ?
                  AND DATE(date) <= ?
                GROUP BY day
                """,
                (email, start.isoformat(), end.isoformat()),
            ).fetchall()
    except Exception:
        return {"heatmap": []}

    counts: dict[str, int] = {row["day"]: row["cnt"] for row in rows}

    heatmap = []
    day = start
    while day <= end:
        key = day.isoformat()
        heatmap.append({"date": key, "count": counts.get(key, 0)})
        day += timedelta(days=1)

    return {"heatmap": heatmap}


class MeetingPrepRequest(BaseModel):
    subject: str
    attendees: list[str] = []
    meeting_date: str = ""


@router.post("/meeting-prep")
async def meeting_prep(req: MeetingPrepRequest, request: Request):
    """One-click meeting prep: scan email history with attendees, generate brief."""
    cache = request.app.state.cache
    advisor = request.app.state.advisor

    # Find relevant emails (with attendees or matching subject)
    email_snippets = []
    with cache._conn() as conn:
        for attendee in req.attendees[:5]:
            rows = conn.execute(
                """SELECT subject, sender, date, body FROM emails
                   WHERE (LOWER(sender) LIKE ? OR LOWER(recipients) LIKE ?)
                   ORDER BY date DESC LIMIT 5""",
                (f"%{attendee.lower()}%", f"%{attendee.lower()}%"),
            ).fetchall()
            for r in rows:
                email_snippets.append(f"[{(r['date'] or '')[:10]}] {r['sender']}: {r['subject']} — {(r['body'] or '')[:200]}")

    # Also search by meeting subject
    if req.subject:
        import json as _json
        from services.rag_engine import RAGEngine
        rag: RAGEngine = request.app.state.rag
        results = rag.semantic_search(req.subject, n=5)
        for r in results:
            email_snippets.append(f"[{r.get('date','')[:10]}] {r.get('sender','')}: {r.get('subject','')} — {r.get('text','')[:200]}")

    snippets_text = "\n".join(email_snippets[:20]) or "No prior email history found."

    prompt = f"""You are preparing an executive for a meeting.

Meeting: {req.subject}
Date: {req.meeting_date or 'upcoming'}
Attendees: {', '.join(req.attendees) or 'not specified'}

Prior email history with these people:
{snippets_text}

Generate a concise meeting prep brief with:
1. Background (2-3 sentences on relationship/context)
2. Key open items (what's outstanding)
3. Talking points (3-5 suggested points)
4. Watch-outs (any tensions or sensitivities)

Be specific and actionable. Format with clear section headers."""

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=1000,
                messages=[{"role": "user", "content": prompt}],
            )
            brief = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=1000,
                messages=[{"role": "user", "content": prompt}],
            )
            brief = resp.content[0].text.strip()
    except Exception as exc:
        raise HTTPException(500, str(exc))

    return {"brief": brief, "attendees": req.attendees, "subject": req.subject}


class InterviewPrepRequest(BaseModel):
    email_ids: list[str] = []
    cluster_name: str = ""


@router.post("/interview-prep")
async def interview_prep(req: InterviewPrepRequest, request: Request):
    """Generate interview prep brief from a cluster of email interactions."""
    svc = getattr(request.app.state, "intelligence", None)
    advisor = getattr(request.app.state, "advisor", None)
    cache = getattr(request.app.state, "cache", None)

    if not advisor or not cache:
        raise HTTPException(503, "Service not available")

    email_snippets = []
    if req.email_ids and svc:
        emails = svc.get_emails_by_ids(req.email_ids, limit=20)
        for e in emails:
            date_str = (e.get("date") or "")[:10]
            sender = e.get("sender") or ""
            subject = e.get("subject") or ""
            body = (e.get("body") or e.get("text") or "")[:300]
            email_snippets.append(f"[{date_str}] {sender}: {subject}\n{body}")
    elif req.email_ids and cache:
        placeholders = ",".join("?" * len(req.email_ids[:20]))
        with cache._conn() as conn:
            rows = conn.execute(
                f"SELECT sender, subject, date, body FROM emails WHERE id IN ({placeholders})",
                req.email_ids[:20],
            ).fetchall()
        for r in rows:
            date_str = (r["date"] or "")[:10]
            body = (r["body"] or "")[:300]
            email_snippets.append(f"[{date_str}] {r['sender']}: {r['subject']}\n{body}")

    emails_text = "\n\n---\n".join(email_snippets) or "No emails available."

    prompt = (
        f"Analyze this interview email history and provide: "
        f"1. Timeline of interactions "
        f"2. Key details about the role "
        f"3. Questions they've asked so far "
        f"4. Suggested questions to ask them "
        f"5. Key talking points. "
        f"Keep each section to 2-4 bullet points.\n\n"
        f"Cluster: {req.cluster_name}\n\n"
        f"Emails:\n{emails_text}"
    )

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=800,
                messages=[{"role": "user", "content": prompt}],
            )
            prep = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=800,
                messages=[{"role": "user", "content": prompt}],
            )
            prep = resp.content[0].text.strip()
    except Exception as exc:
        raise HTTPException(500, str(exc))

    return {"prep": prep, "cluster_name": req.cluster_name}


class DraftFollowupRequest(BaseModel):
    email_id: str
    subject: str = ""
    sender: str = ""
    original_body: str = ""


@router.post("/draft-followup")
async def draft_followup(req: DraftFollowupRequest, request: Request):
    """Generate a brief professional follow-up email for a chase-queue item."""
    advisor = request.app.state.advisor
    prompt = (
        f"Write a brief, professional follow-up email to {req.sender} "
        f"about '{req.subject}'. "
        f"The original context: {req.original_body[:500]}. "
        "Keep it under 100 words. Just the email body, no subject line."
    )
    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            draft = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            draft = resp.content[0].text.strip()
    except Exception as exc:
        raise HTTPException(500, str(exc))

    subject = req.subject
    if subject and not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"
    return {"draft": draft, "to": req.sender, "subject": subject}


def _ensure_nudge_dismissals(conn):
    conn.execute(
        """CREATE TABLE IF NOT EXISTS nudge_dismissals
           (email_addr TEXT PRIMARY KEY, dismissed_until TEXT)"""
    )


def _dismissed_set(cache) -> set:
    """Return the set of email addresses currently dismissed."""
    from datetime import datetime
    try:
        with cache._conn() as conn:
            _ensure_nudge_dismissals(conn)
            rows = conn.execute(
                "SELECT email_addr, dismissed_until FROM nudge_dismissals"
            ).fetchall()
        now_str = datetime.utcnow().isoformat()
        return {r["email_addr"] for r in rows if r["dismissed_until"] > now_str}
    except Exception:
        return set()


class NudgeDismissRequest(BaseModel):
    email: str
    days: int = 30  # how long to suppress this nudge


@router.post("/nudges/dismiss")
async def dismiss_nudge(req: NudgeDismissRequest, request: Request):
    """Persist a nudge dismissal so the contact is hidden for N days."""
    from datetime import datetime, timedelta
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        raise HTTPException(503, "Cache not available")
    addr = req.email.strip().lower()
    if not addr:
        raise HTTPException(400, "email required")
    until = (datetime.utcnow() + timedelta(days=max(1, min(req.days, 365)))).isoformat()
    with cache._conn() as conn:
        _ensure_nudge_dismissals(conn)
        conn.execute(
            """INSERT INTO nudge_dismissals (email_addr, dismissed_until)
               VALUES (?, ?)
               ON CONFLICT(email_addr) DO UPDATE SET dismissed_until=excluded.dismissed_until""",
            (addr, until),
        )
    return {"dismissed": addr, "until": until}


@router.delete("/nudges/dismiss/{email}")
async def undismiss_nudge(email: str, request: Request):
    """Remove a dismissal so the contact can appear in nudges again."""
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        raise HTTPException(503, "Cache not available")
    with cache._conn() as conn:
        _ensure_nudge_dismissals(conn)
        conn.execute("DELETE FROM nudge_dismissals WHERE email_addr = ?", (email.strip().lower(),))
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Chase queue state persistence
# ---------------------------------------------------------------------------

def _ensure_chase_tables(conn):
    conn.execute(
        """CREATE TABLE IF NOT EXISTS chase_dismissed
           (email_id TEXT PRIMARY KEY, dismissed_at TEXT)"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS chase_snoozed
           (email_id TEXT PRIMARY KEY, snoozed_until TEXT)"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS chase_notes
           (email_id TEXT PRIMARY KEY, note TEXT, updated_at TEXT)"""
    )


@router.get("/chase/state")
async def get_chase_state(request: Request):
    """Return all persisted chase queue state (dismissed, snoozed, notes)."""
    from datetime import datetime
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        return {"dismissed": [], "snoozed": {}, "notes": {}}
    try:
        with cache._conn() as conn:
            _ensure_chase_tables(conn)
            dismissed = [r["email_id"] for r in conn.execute(
                "SELECT email_id FROM chase_dismissed"
            ).fetchall()]
            now_str = datetime.utcnow().isoformat()
            snoozed = {r["email_id"]: r["snoozed_until"] for r in conn.execute(
                "SELECT email_id, snoozed_until FROM chase_snoozed WHERE snoozed_until > ?", (now_str,)
            ).fetchall()}
            notes = {r["email_id"]: r["note"] for r in conn.execute(
                "SELECT email_id, note FROM chase_notes"
            ).fetchall()}
        return {"dismissed": dismissed, "snoozed": snoozed, "notes": notes}
    except Exception:
        return {"dismissed": [], "snoozed": {}, "notes": {}}


class ChaseEmailId(BaseModel):
    email_id: str


class ChaseSnoozeRequest(BaseModel):
    email_id: str
    until: str  # ISO datetime string


class ChaseNoteRequest(BaseModel):
    email_id: str
    note: str


@router.post("/chase/dismiss")
async def chase_dismiss(req: ChaseEmailId, request: Request):
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        raise HTTPException(503, "Cache not available")
    with cache._conn() as conn:
        _ensure_chase_tables(conn)
        conn.execute(
            """INSERT INTO chase_dismissed (email_id, dismissed_at) VALUES (?, datetime('now'))
               ON CONFLICT(email_id) DO UPDATE SET dismissed_at=excluded.dismissed_at""",
            (req.email_id,),
        )
    return {"status": "ok"}


@router.delete("/chase/dismiss/{email_id:path}")
async def chase_restore(email_id: str, request: Request):
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        raise HTTPException(503, "Cache not available")
    with cache._conn() as conn:
        _ensure_chase_tables(conn)
        conn.execute("DELETE FROM chase_dismissed WHERE email_id = ?", (email_id,))
    return {"status": "ok"}


@router.delete("/chase/dismiss")
async def chase_clear_all_dismissed(request: Request):
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        raise HTTPException(503, "Cache not available")
    with cache._conn() as conn:
        _ensure_chase_tables(conn)
        conn.execute("DELETE FROM chase_dismissed")
    return {"status": "ok"}


@router.post("/chase/snooze")
async def chase_snooze(req: ChaseSnoozeRequest, request: Request):
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        raise HTTPException(503, "Cache not available")
    with cache._conn() as conn:
        _ensure_chase_tables(conn)
        conn.execute(
            """INSERT INTO chase_snoozed (email_id, snoozed_until) VALUES (?, ?)
               ON CONFLICT(email_id) DO UPDATE SET snoozed_until=excluded.snoozed_until""",
            (req.email_id, req.until),
        )
    return {"status": "ok"}


@router.delete("/chase/snooze/{email_id:path}")
async def chase_unsnooze(email_id: str, request: Request):
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        raise HTTPException(503, "Cache not available")
    with cache._conn() as conn:
        _ensure_chase_tables(conn)
        conn.execute("DELETE FROM chase_snoozed WHERE email_id = ?", (email_id,))
    return {"status": "ok"}


@router.post("/chase/note")
async def chase_save_note(req: ChaseNoteRequest, request: Request):
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        raise HTTPException(503, "Cache not available")
    with cache._conn() as conn:
        _ensure_chase_tables(conn)
        if req.note.strip():
            conn.execute(
                """INSERT INTO chase_notes (email_id, note, updated_at) VALUES (?, ?, datetime('now'))
                   ON CONFLICT(email_id) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at""",
                (req.email_id, req.note.strip()),
            )
        else:
            conn.execute("DELETE FROM chase_notes WHERE email_id = ?", (req.email_id,))
    return {"status": "ok"}


@router.delete("/chase/note/{email_id:path}")
async def chase_delete_note(email_id: str, request: Request):
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        raise HTTPException(503, "Cache not available")
    with cache._conn() as conn:
        _ensure_chase_tables(conn)
        conn.execute("DELETE FROM chase_notes WHERE email_id = ?", (email_id,))
    return {"status": "ok"}


@router.get("/relationship-nudges")
async def relationship_nudges(request: Request, days: int = 21, limit: int = 10):
    """Surface contacts not reached out to recently. Pure SQL, no AI."""
    from datetime import datetime, timedelta, timezone

    cache = getattr(request.app.state, "cache", None)
    if not cache:
        return {"nudges": [], "total": 0}

    dismissed = _dismissed_set(cache)

    days = max(1, min(days, 365))
    limit = max(1, min(limit, 100))
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)

    def _last_sent(conn, addr: str):
        like = f"%{addr}%"
        return conn.execute(
            """SELECT subject, date FROM emails
               WHERE LOWER(folder) LIKE '%sent%'
                 AND (LOWER(recipients) LIKE LOWER(?) OR LOWER(body) LIKE LOWER(?))
               ORDER BY date DESC LIMIT 1""",
            (like, like),
        ).fetchone()

    def _last_received(conn, addr: str):
        return conn.execute(
            """SELECT subject, date FROM emails
               WHERE LOWER(sender) LIKE LOWER(?)
               ORDER BY date DESC LIMIT 1""",
            (f"%{addr}%",),
        ).fetchone()

    def _parse(dt: str | None):
        if not dt:
            return None
        try:
            return datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            try:
                return datetime.strptime(dt[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                return None

    def _days_since(dt) -> int:
        if dt is None:
            return days + 1
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0, (now - dt).days)

    nudges: list[dict] = []
    seen: set[str] = set()

    with cache._conn() as conn:
        vips = conn.execute("SELECT email_addr, name FROM vip_contacts").fetchall()

        for vip in vips:
            addr = (vip["email_addr"] or "").strip().lower()
            if not addr or addr in seen:
                continue
            sent = _last_sent(conn, addr)
            sent_dt = _parse(sent["date"]) if sent else None
            if sent_dt is not None and sent_dt > cutoff:
                continue  # contacted recently — no nudge

            recv = _last_received(conn, addr)
            recv_dt = _parse(recv["date"]) if recv else None
            last_dt = sent_dt or recv_dt
            last_subject = (sent["subject"] if sent else None) or (recv["subject"] if recv else None)

            seen.add(addr)
            nudges.append({
                "name": vip["name"] or addr,
                "email": addr,
                "is_vip": True,
                "last_contact_date": last_dt.isoformat() if last_dt else None,
                "last_subject": last_subject,
                "days_since": _days_since(last_dt),
                "suggested_context": f"Last topic: {last_subject}" if last_subject else "No previous contact found",
            })

        # Top non-VIP senders by volume in last 90 days
        top = conn.execute(
            """SELECT sender, COUNT(*) AS cnt FROM emails
               WHERE date > datetime('now', '-90 days')
                 AND LOWER(folder) NOT LIKE '%sent%'
               GROUP BY LOWER(sender) ORDER BY cnt DESC LIMIT 30"""
        ).fetchall()

        for row in top:
            raw = (row["sender"] or "").strip()
            addr = raw.lower()
            if not addr or "@" not in addr or addr in seen:
                continue
            sent = _last_sent(conn, addr)
            sent_dt = _parse(sent["date"]) if sent else None
            if sent_dt is not None and sent_dt > cutoff:
                continue

            recv = _last_received(conn, addr)
            recv_dt = _parse(recv["date"]) if recv else None
            last_dt = sent_dt or recv_dt
            last_subject = (sent["subject"] if sent else None) or (recv["subject"] if recv else None)

            seen.add(addr)
            nudges.append({
                "name": raw,
                "email": addr,
                "is_vip": False,
                "last_contact_date": last_dt.isoformat() if last_dt else None,
                "last_subject": last_subject,
                "days_since": _days_since(last_dt),
                "suggested_context": f"Last topic: {last_subject}" if last_subject else "No previous contact found",
            })

    nudges = [n for n in nudges if n["email"] not in dismissed]
    nudges.sort(key=lambda n: (not n["is_vip"], -n["days_since"]))
    nudges = nudges[:limit]
    return {"nudges": nudges, "total": len(nudges)}


@router.get("/coaching")
async def email_coaching(request: Request):
    """Analyze sent email patterns and provide communication coaching tips."""
    from datetime import datetime, timedelta
    cache = request.app.state.cache
    advisor = request.app.state.advisor

    since = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
    with cache._conn() as conn:
        sent_rows = conn.execute(
            """SELECT subject, body, date FROM emails
               WHERE LOWER(folder) LIKE '%sent%' AND date >= ?
               ORDER BY date DESC LIMIT 30""",
            (since,),
        ).fetchall()

    if not sent_rows:
        return {"tips": ["No sent emails found in the last 30 days."], "stats": {}}

    # Basic stats
    avg_len = sum(len(r["body"] or "") for r in sent_rows) // max(len(sent_rows), 1)
    re_count = sum(1 for r in sent_rows if (r["subject"] or "").lower().startswith("re:"))

    samples = "\n\n---\n".join(
        f"Subject: {r['subject']}\n{(r['body'] or '')[:400]}"
        for r in sent_rows[:10]
    )

    prompt = f"""Analyze these sent emails and provide 3-5 specific, actionable communication coaching tips.

Stats: {len(sent_rows)} emails sent, avg {avg_len} chars, {re_count} were replies.

Sample emails:
{samples}

Return JSON:
{{
  "tips": ["specific coaching tip 1", "tip 2", ...],
  "strengths": ["what they do well 1", ...],
  "stats": {{
    "avg_length": {avg_len},
    "reply_ratio": {round(re_count/max(len(sent_rows),1)*100)},
    "emails_analyzed": {len(sent_rows)}
  }}
}}"""

    ant = getattr(advisor.ai, "_anthropic", None)
    import json as _json, re as _re
    try:
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=800,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=800,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
        text = _re.sub(r'^```[a-z]*\n?', '', text).rstrip('`').strip()
        s, e = text.find("{"), text.rfind("}") + 1
        data = _json.loads(text[s:e]) if s >= 0 else {}
    except Exception as exc:
        data = {"tips": [f"Analysis error: {exc}"], "strengths": [], "stats": {}}

    return data


@router.get("/stakeholders")
async def get_stakeholders(request: Request, days: int = 90, limit: int = 30):
    """Ranked stakeholder influence map — pure SQL, no AI."""
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        return {"stakeholders": [], "total": 0, "days": days}

    days = max(1, min(days, 365))
    limit = max(1, min(limit, 100))

    def _addr(s: str) -> str:
        s = (s or "").strip()
        m = re.search(r'<([^>]+)>', s)
        if m:
            return m.group(1).strip().lower()
        return s.lower()

    def _name(s: str) -> str:
        s = (s or "").strip()
        m = re.match(r'^\s*"?([^"<]+?)"?\s*<', s)
        if m and m.group(1).strip():
            return m.group(1).strip()
        addr = _addr(s)
        return addr.split("@")[0] if "@" in addr else (addr or s)

    contacts: dict[str, dict] = {}

    def _entry(email: str, raw: str) -> dict:
        e = contacts.get(email)
        if e is None:
            e = {
                "name": _name(raw),
                "email": email,
                "received_count": 0,
                "sent_count": 0,
                "last_contact": None,
                "is_vip": False,
            }
            contacts[email] = e
        elif (not e["name"] or "@" in e["name"]) and _name(raw) and "@" not in _name(raw):
            e["name"] = _name(raw)
        return e

    def _bump_last(e: dict, dt):
        if dt and (e["last_contact"] is None or dt > e["last_contact"]):
            e["last_contact"] = dt

    with cache._conn() as conn:
        recv_rows = conn.execute(
            f"""SELECT sender, COUNT(*) AS received_count, MAX(date) AS last_received
                FROM emails
                WHERE date > datetime('now', '-{days} days')
                  AND folder NOT LIKE '%sent%' AND folder != 'SENT'
                GROUP BY sender
                ORDER BY received_count DESC
                LIMIT 50"""
        ).fetchall()

        for r in recv_rows:
            raw = r["sender"] or ""
            email = _addr(raw)
            if not email or "@" not in email:
                continue
            e = _entry(email, raw)
            e["received_count"] += r["received_count"] or 0
            _bump_last(e, r["last_received"])

        sent_rows = conn.execute(
            f"""SELECT recipients, COUNT(*) AS sent_count
                FROM emails
                WHERE date > datetime('now', '-{days} days')
                  AND (folder LIKE '%sent%' OR folder = 'SENT')
                  AND recipients IS NOT NULL
                GROUP BY recipients
                ORDER BY sent_count DESC
                LIMIT 50"""
        ).fetchall()

        for r in sent_rows:
            raw = r["recipients"] or ""
            email = _addr(raw)
            if not email or "@" not in email:
                continue
            e = _entry(email, raw)
            e["sent_count"] += r["sent_count"] or 0

        vip_rows = conn.execute("SELECT LOWER(email_addr) AS e FROM vip_contacts").fetchall()
        vip_set = {(v["e"] or "").strip() for v in vip_rows if (v["e"] or "").strip()}

    stakeholders = []
    for e in contacts.values():
        for v in vip_set:
            if v and (v in e["email"] or e["email"] in v):
                e["is_vip"] = True
                break
        score = min(100, e["received_count"] * 2 + e["sent_count"] * 3)
        last = e["last_contact"]
        stakeholders.append({
            "name": e["name"],
            "email": e["email"],
            "received_count": e["received_count"],
            "sent_count": e["sent_count"],
            "total_interactions": e["received_count"] + e["sent_count"],
            "influence_score": score,
            "last_contact": last[:10] if last else None,
            "is_vip": e["is_vip"],
        })

    stakeholders.sort(key=lambda s: s["influence_score"], reverse=True)
    stakeholders = stakeholders[:limit]

    return {"stakeholders": stakeholders, "total": len(stakeholders), "days": days}


@router.get("/decisions")
async def get_decisions(request: Request, days: int = 30, limit: int = 40):
    """Find emails where a decision is pending — mine to make or waiting on others."""
    from datetime import datetime, timezone
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        return {"decisions": [], "mine_count": 0, "theirs_count": 0}

    with cache._conn() as conn:
        rows = conn.execute(
            f"""SELECT id, sender, subject, body, date, folder, recipients
                FROM emails
                WHERE date > datetime('now', '-{int(days)} days')
                AND lower(sender) NOT LIKE '%noreply%'
                AND lower(sender) NOT LIKE '%no-reply%'
                AND lower(sender) NOT LIKE '%donotreply%'
                AND lower(sender) NOT LIKE '%newsletter%'
                AND lower(sender) NOT LIKE '%notifications@%'
                AND lower(sender) NOT LIKE '%mailer@%'
                AND lower(sender) NOT LIKE '%bounce%'
                AND lower(sender) NOT LIKE '%@mailchimp%'
                AND (
                    lower(subject) LIKE '%approve%' OR lower(subject) LIKE '%approval%'
                    OR lower(subject) LIKE '%sign off%' OR lower(subject) LIKE '%sign-off%'
                    OR lower(body) LIKE '%please approve%' OR lower(body) LIKE '%awaiting your approval%'
                    OR lower(body) LIKE '%need your decision%' OR lower(body) LIKE '%your sign-off%'
                    OR lower(body) LIKE '%waiting on your%' OR lower(body) LIKE '%need you to approve%'
                    OR lower(body) LIKE '%decision needed%' OR lower(body) LIKE '%approval needed%'
                    OR lower(body) LIKE '%your approval%' OR lower(body) LIKE '%pending your%'
                )
                ORDER BY date DESC LIMIT {int(limit)}""",
        ).fetchall()

    now = datetime.now(timezone.utc)
    request_phrases = (
        "please approve", "awaiting your", "need your", "your sign-off",
        "need you to", "your approval", "pending your", "decision needed", "approval needed",
    )
    decisions, mine_count, theirs_count = [], 0, 0

    for r in rows:
        folder = (r["folder"] or "").lower()
        body = r["body"] or ""
        is_sent = "sent" in folder
        has_request = any(p in body.lower() for p in request_phrases)

        if is_sent:
            direction = "theirs"
            theirs_count += 1
        elif has_request:
            direction = "mine"
            mine_count += 1
        else:
            direction = "mine"
            mine_count += 1

        days_waiting = 0
        try:
            dt = datetime.fromisoformat((r["date"] or "").replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            days_waiting = max((now - dt).days, 0)
        except Exception:
            days_waiting = 0

        decisions.append({
            "id": r["id"],
            "subject": r["subject"] or "(no subject)",
            "sender": r["sender"] or "",
            "date": r["date"] or "",
            "direction": direction,
            "days_waiting": days_waiting,
            "snippet": body[:150],
        })

    return {"decisions": decisions, "mine_count": mine_count, "theirs_count": theirs_count}


class DecisionBriefRequest(BaseModel):
    email_id: str


@router.post("/decisions/brief")
async def decision_brief(req: DecisionBriefRequest, request: Request):
    """Generate a concise AI decision brief for a single email."""
    cache = getattr(request.app.state, "cache", None)
    advisor = getattr(request.app.state, "advisor", None)
    if not cache or not advisor:
        raise HTTPException(503, "Service not available")

    with cache._conn() as conn:
        row = conn.execute(
            "SELECT sender, subject, body, date FROM emails WHERE id = ?",
            (req.email_id,),
        ).fetchone()

    if not row:
        raise HTTPException(404, "Email not found")

    sender = row["sender"] or ""
    subject = row["subject"] or ""
    date = row["date"] or ""
    body = row["body"] or ""

    prompt = f"""You are an executive assistant. Based on this email, write a concise Decision Brief (3-4 sentences):
1. What decision is being requested
2. Key context or options (if mentioned)
3. What action the reader should take next

Email from: {sender}
Subject: {subject}
Date: {date}
Body: {body[:1500]}

Write ONLY the brief, no preamble."""

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            brief = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            brief = resp.content[0].text.strip()
    except Exception as exc:
        raise HTTPException(500, str(exc))

    return {"brief": brief, "subject": subject, "sender": sender}


@router.get("/escalations")
async def get_escalations(request: Request, days: int = 14, limit: int = 20):
    """Detect email threads showing escalation signals. Pure SQL, no AI."""
    from datetime import datetime

    cache = getattr(request.app.state, "cache", None)
    if not cache:
        return {"escalations": [], "total": 0}

    days = max(1, min(days, 365))
    limit = max(1, min(limit, 100))

    query = f"""
        SELECT
            REPLACE(REPLACE(REPLACE(REPLACE(lower(subject), 're: ', ''), 'fwd: ', ''), 'fw: ', ''), 'aw: ', '') AS thread_key,
            MAX(subject) AS subject,
            COUNT(*) AS reply_count,
            COUNT(DISTINCT sender) AS participant_count,
            MAX(date) AS last_reply,
            MIN(date) AS first_reply,
            GROUP_CONCAT(DISTINCT sender) AS senders,
            MAX(CASE WHEN lower(subject) LIKE '%urgent%' OR lower(subject) LIKE '%asap%'
                     OR lower(body) LIKE '%urgent%' OR lower(body) LIKE '%asap%'
                     OR lower(body) LIKE '%critical%' OR lower(body) LIKE '%escalat%'
                     THEN 1 ELSE 0 END) AS has_urgency,
            MAX(id) AS latest_email_id,
            GROUP_CONCAT(id) AS email_ids
        FROM emails
        WHERE date > datetime('now', '-{days} days')
        GROUP BY thread_key
        HAVING reply_count >= 2
        ORDER BY reply_count DESC, last_reply DESC
        LIMIT 60
    """

    try:
        with cache._conn() as conn:
            rows = conn.execute(query).fetchall()
    except Exception:
        return {"escalations": [], "total": 0}

    def _parse_name(raw: str) -> str:
        raw = (raw or "").strip()
        if "<" in raw:
            name = raw.split("<", 1)[0].strip().strip('"')
            if name:
                return name
            raw = raw.split("<", 1)[1].rstrip(">")
        if "@" in raw:
            return raw.split("@", 1)[0]
        return raw

    now = datetime.now()
    escalations = []

    for row in rows:
        reply_count = row["reply_count"]
        participant_count = row["participant_count"]
        has_urgency = bool(row["has_urgency"])

        score = 0
        if reply_count >= 5:
            score += 30
        elif reply_count >= 3:
            score += 15
        if participant_count >= 4:
            score += 25
        elif participant_count >= 2:
            score += 10
        if has_urgency:
            score += 30

        hours_ago = 999.0
        last_reply = row["last_reply"]
        if last_reply:
            try:
                last = datetime.fromisoformat(last_reply.replace("Z", "+00:00"))
                # Strip tzinfo so subtraction against naive now() always works
                if last.tzinfo is not None:
                    last = last.replace(tzinfo=None)
                hours_ago = (now - last).total_seconds() / 3600
            except (ValueError, AttributeError, TypeError):
                pass
        if hours_ago < 24:
            score += 15
        elif hours_ago < 48:
            score += 5

        if score < 20:
            continue

        senders_raw = (row["senders"] or "").split(",")
        seen_names: list[str] = []
        for s in senders_raw:
            name = _parse_name(s)
            if name and name not in seen_names:
                seen_names.append(name)
            if len(seen_names) >= 2:
                break

        escalations.append({
            "thread_key": row["thread_key"],
            "subject": row["subject"],
            "reply_count": reply_count,
            "participant_count": participant_count,
            "has_urgency": has_urgency,
            "last_reply": last_reply,
            "hours_since_last": round(hours_ago, 1),
            "escalation_score": min(score, 100),
            "latest_email_id": row["latest_email_id"],
            "senders_preview": seen_names,
        })

    escalations.sort(key=lambda e: e["escalation_score"], reverse=True)
    escalations = escalations[:limit]
    return {"escalations": escalations, "total": len(escalations)}

