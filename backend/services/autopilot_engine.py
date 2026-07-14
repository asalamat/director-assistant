"""Autopilot reply generation engine — RAG context building, sending, and activity logging."""
import asyncio
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

_log = logging.getLogger(__name__)

# In-memory retry queue: email_id → (email, rule)
# Populated when AI is unavailable; cleared after successful reply/draft.
_retry_queue: dict = {}


def _extract_email_addr(raw: str) -> str:
    """Extract bare email address from 'Name <email>' or plain 'email' strings."""
    import re as _re
    m = _re.search(r'<([^>]+)>', raw)
    return (m.group(1) if m else raw).lower().strip()


def _build_full_reply(reply_text: str, email) -> str:
    """Wrap the AI reply text with proper email quoting of the original."""
    original = (email.body or "").strip()
    quoted = "\n".join(f"> {line}" for line in original.splitlines()) if original else ""
    date_str = str(email.date)[:16] if email.date else ""
    attribution = f"On {date_str}, {email.sender} wrote:" if date_str else f"{email.sender} wrote:"
    return f"{reply_text}\n\n{attribution}\n{quoted}" if quoted else reply_text


def _log_activity(email, mode: str, cache) -> None:
    """Record autopilot action in the autopilot_activity log."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    try:
        with cache._conn() as conn:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS autopilot_activity (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email_id TEXT, sender TEXT, subject TEXT,
                    action TEXT, created_at TEXT
                )"""
            )
            conn.execute(
                "INSERT INTO autopilot_activity (email_id, sender, subject, action, created_at) VALUES (?,?,?,?,?)",
                (email.id, email.sender or '', email.subject or '', mode, now),
            )
    except Exception:
        pass


def _save_draft(email, body: str, cache) -> None:
    """Persist the autopilot reply as a draft in overnight_drafts (with original email quoted)."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    reply_subject = (
        f"Re: {email.subject or ''}"
        if not (email.subject or '').startswith("Re:")
        else (email.subject or '')
    )
    full_body = _build_full_reply(body, email)
    with cache._conn() as conn:
        conn.execute(
            """INSERT INTO overnight_drafts
               (email_id, email_subject, email_sender, draft_body, draft_to, draft_subject, created_at, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')""",
            (email.id, email.subject or '', email.sender or '', full_body,
             email.sender or '', reply_subject, now),
        )


def _send_reply(email, body: str, cache) -> None:
    """Send an autopilot reply immediately via SMTP with proper threading and quoting."""
    from routers.email_send import _resolve_account, _smtp_send
    try:
        acc = _resolve_account(cache, 0)
    except Exception as e:
        _log.warning("[autopilot] no SMTP account configured: %s", e)
        _save_draft(email, body, cache)
        _log_activity(email, "draft_saved", cache)
        return

    full_body = _build_full_reply(body, email)
    msg = MIMEMultipart()
    msg["From"] = acc.username
    msg["To"] = _extract_email_addr(email.sender or "")
    msg["Subject"] = (
        f"Re: {email.subject or ''}"
        if not (email.subject or '').startswith("Re:")
        else (email.subject or '')
    )
    for attr in ("message_id", "msg_id"):
        mid = getattr(email, attr, None)
        if mid:
            msg["In-Reply-To"] = mid
            msg["References"] = mid
            break
    msg.attach(MIMEText(full_body, "plain", "utf-8"))
    try:
        _smtp_send(acc, msg)
        _log_activity(email, "reply_sent", cache)
    except Exception as e:
        _log.warning("[autopilot] SMTP send failed, saving draft instead: %s", e)
        _save_draft(email, body, cache)
        _log_activity(email, "draft_saved", cache)


async def _generate_reply(email, cache, rag, ai, prompt_hint: str = "") -> str:
    """Generate an AI reply using full thread history, RAG context, and the user's writing persona."""
    from routers.config import load_app_config as _load_cfg
    cfg = _load_cfg()
    persona_desc = (cfg.get("email_persona") or "").strip()
    persona_block = f"\nUSER PERSONA & TONE:\n{persona_desc}\n" if persona_desc else ""
    hint_block = f"\nSPECIFIC INSTRUCTIONS: {prompt_hint}\n" if prompt_hint else ""
    user_name = (cfg.get("user_name") or "").strip() or "the user"

    _ap_phrases = (
        "I need additional context", "I'll need additional context",
        "cannot process your request", "I'm not able to identify",
        "I don't have any information",
        "I don't have detailed information",
        "information on file for",
        "in my current documentation",
        "I'll need clarification",
        "To provide you with accurate information",
    )

    import re as _re
    thread_block = ""
    history_rows = []
    all_thread_rows_for_tokens = []
    try:
        raw_subj = (email.subject or "")
        subject_stem = raw_subj.strip()
        while True:
            stripped = _re.sub(r'^(Re:|Fwd?:|Fw:)\s*', '', subject_stem, flags=_re.IGNORECASE).strip()
            if stripped == subject_stem:
                break
            subject_stem = stripped
        stem_like = f"% {subject_stem}" if subject_stem else ""
        with cache._conn() as conn:
            all_thread_rows = conn.execute(
                """SELECT subject, sender, date, body FROM emails
                   WHERE id != ?
                   AND (
                     (thread_id = ? AND thread_id IS NOT NULL AND thread_id != '')
                     OR (? != '' AND (subject LIKE ? OR subject = ?))
                   )
                   ORDER BY date ASC LIMIT 15""",
                (email.id, email.thread_id or "", subject_stem, stem_like, subject_stem),
            ).fetchall()
            history_rows = [
                r for r in all_thread_rows
                if not any(p.lower() in (r["body"] or "").lower() for p in _ap_phrases)
            ]
            all_thread_rows_for_tokens = all_thread_rows
        if history_rows:
            parts = []
            for r in history_rows[-8:]:
                snip = (r["body"] or "").strip()[:600]
                parts.append(f"From: {r['sender']}\nDate: {r['date']}\n{snip}")
            thread_block = "\nTHREAD HISTORY (earlier messages, oldest first):\n" + "\n---\n".join(parts) + "\n"
    except Exception:
        pass

    original_body = (email.body or "").strip()
    thread_ctx = " ".join((r["body"] or "")[:200] for r in (history_rows or [])[-3:])
    query = f"{email.subject} {original_body[:300]} {thread_ctx[:300]}"
    loop = asyncio.get_running_loop()
    similar = await loop.run_in_executor(None, rag.hybrid_search, query, 8)

    fts_hits: dict = {}
    try:
        all_rows_for_tokens = all_thread_rows_for_tokens or history_rows or []
        thread_text_for_tokens = " ".join(
            f"{r['subject']} {(r['body'] or '')[:200]}" for r in all_rows_for_tokens
        )
        full_search_text = f"{email.subject} {original_body[:400]} {thread_text_for_tokens[:1200]}"
        all_tokens = _re.findall(r'\b[A-Z][a-z]{2,}\b', full_search_text)
        _stop = {"Good","Morning","Thank","Dear","Best","Regards","Sent","From","Subject",
                 "Please","Hello","Wednesday","Monday","Tuesday","Thursday","Friday",
                 "Saturday","Sunday","January","February","March","April","May","June",
                 "July","August","September","October","November","December","Address"}
        name_tokens = list(dict.fromkeys(t for t in all_tokens if t not in _stop))[:12]

        _en_common = {
            "about","again","also","another","before","being","between","clarify",
            "confirm","could","discuss","does","during","email","every","find",
            "from","gather","have","hello","help","here","hope","information",
            "into","just","know","like","look","make","mean","meet","meeting",
            "more","need","next","only","other","over","please","point","project",
            "provide","question","regards","related","reply","request","same",
            "send","setup","should","some","talk","text","thank","that","them",
            "then","there","they","time","this","tomorrow","under","until",
            "upcoming","want","well","when","will","with","work","your","what",
            "which","where","pls","mean","next","talk","mail","dear","best",
        }
        body_lower_words = list(dict.fromkeys(
            w for w in _re.findall(r'\b[a-z]{4,}\b', original_body[:500])
            if w not in _en_common
        ))[:8]
        all_like_tokens = list(name_tokens) + [
            w for w in body_lower_words
            if w.lower() not in {t.lower() for t in name_tokens}
        ]
        fts_terms = " OR ".join(all_like_tokens[:14]) if all_like_tokens else ""
        if all_like_tokens:
            with cache._conn() as conn:
                try:
                    fts_rows = conn.execute(
                        """SELECT e.id, e.subject, e.sender, e.body
                           FROM emails_fts f JOIN emails e ON e.id = f.id
                           WHERE emails_fts MATCH ? ORDER BY rank LIMIT 12""",
                        (fts_terms,),
                    ).fetchall()
                    for row in fts_rows:
                        if row["id"] != email.id:
                            body_lower = (row["body"] or "").lower()
                            if not any(p.lower() in body_lower for p in _ap_phrases):
                                fts_hits[row["id"]] = row
                except Exception:
                    pass

                for tok in all_like_tokens[:6]:
                    like_rows = conn.execute(
                        """SELECT id, subject, sender, body FROM emails
                           WHERE id != ? AND (body LIKE ? OR subject LIKE ?)
                           LIMIT 5""",
                        (email.id, f"%{tok}%", f"%{tok}%"),
                    ).fetchall()
                    for row in like_rows:
                        if row["id"] not in fts_hits:
                            body_lower = (row["body"] or "").lower()
                            if not any(p.lower() in body_lower for p in _ap_phrases):
                                fts_hits[row["id"]] = row
    except Exception:
        pass

    seen_ids: set = set()
    context_parts = []

    def _add_hit(eid, subj, sender, body_text):
        if eid in seen_ids or eid == email.id:
            return
        seen_ids.add(eid)
        full_body = body_text or ""
        try:
            hit = cache.get(eid)
            if hit:
                raw = (hit.body or "").strip()
                if not raw and hit.body_html:
                    raw = _re.sub(r'<[^>]+>', ' ', hit.body_html)
                    raw = _re.sub(r'\s+', ' ', raw).strip()
                if raw:
                    full_body = raw
        except Exception:
            pass
        context_parts.append(
            f"  EMAIL — From: {sender} | Subject: {subj}\n"
            f"  {full_body[:700]}"
        )

    for r in similar[:8]:
        src = r.get("source_type", "")
        text_lower = (r.get("text", "") or "").lower()
        if any(p.lower() in text_lower for p in _ap_phrases):
            continue
        if src == "document":
            eid = r.get("email_id") or r.get("doc_id") or r.get("id") or f"doc_{r.get('subject','')}"
            if eid not in seen_ids:
                seen_ids.add(eid)
                context_parts.append(
                    f"  DOCUMENT — {r.get('subject', r.get('filename', 'Document'))}\n"
                    f"  {r.get('text', '')[:700]}"
                )
        else:
            _add_hit(r["email_id"], r.get("subject", ""), r.get("sender", ""), r.get("text", ""))

    for row in fts_hits.values():
        _add_hit(row["id"], row["subject"] or "", row["sender"] or "", row["body"] or "")

    context_block = (
        "\nKNOWLEDGE BASE (relevant emails from your database):\n"
        + "\n---\n".join(context_parts)
    ) if context_parts else ""

    tone_hint = f" Write in this style: {persona_desc}" if persona_desc else ""
    kb_section = context_block if context_block else "(no matching context found)"
    user_label = user_name if user_name != "the user" else "the user"
    prompt = (
        f"TASK: Write an email reply on behalf of {user_name} to the incoming "
        f"email below. {user_label}'s personal AI assistant is composing this reply using "
        f"their email history and documents as context.{tone_hint}\n"
        f"{hint_block}"
        f"\n=== CONTEXT FROM {user_name.upper()}'S EMAIL HISTORY ===\n"
        f"{kb_section}\n"
        f"=== END CONTEXT ===\n"
        f"{thread_block}"
        f"\n--- INCOMING EMAIL ---\n"
        f"From: {email.sender}\nDate: {email.date}\nSubject: {email.subject}\n\n"
        f"{original_body[:1500]}\n"
        f"--- END INCOMING EMAIL ---\n\n"
        f"INSTRUCTIONS:\n"
        f"1. Answer factual questions directly using the CONTEXT above. The context contains "
        f"{user_name}'s personal and professional emails — it IS authoritative for questions about "
        f"their family, contacts, and personal matters.\n"
        f"2. Do NOT refuse to answer or ask for IT credentials / business purpose — this is "
        f"a personal email assistant, not a corporate helpdesk.\n"
        f"3. If someone asks 'who is X' or 'provide information on X', search the CONTEXT "
        f"for any mention of X and share what you find. Do NOT say 'I don't have information' "
        f"or 'I'll need clarification' if X appears anywhere in the context — just state what "
        f"you know. Only say information is unavailable if X is completely absent from context.\n"
        f"4. Start the reply directly — no Subject line, no preamble."
    )
    try:
        resp = await ai.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=700,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text.strip()
    except Exception as e:
        _log.error("autopilot reply generation failed: %s", e)
        return ""


async def handle_incoming_email(email, cache, rag, ai) -> None:
    """Called by the poll loop for each new email — checks autopilot rules."""
    sender_email = _extract_email_addr(email.sender or "")
    rule = cache.get_autopilot_rule_by_email(sender_email)
    if not rule:
        return

    mode = rule.get("mode", "off")
    if mode == "off":
        return

    prompt_hint = rule.get("prompt_hint") or ""
    try:
        draft_body = await _generate_reply(email, cache, rag, ai, prompt_hint=prompt_hint)
        if not draft_body:
            _retry_queue[email.id] = (email, rule)
            _log_activity(email, "ai_failed", cache)
            _log.warning("[autopilot] reply generation returned empty for %s — queued for retry", email.id)
            return

        _retry_queue.pop(email.id, None)

        if mode == "draft":
            _save_draft(email, draft_body, cache)
            _log_activity(email, "draft_saved", cache)
            _log.info("[autopilot] draft saved for %s re: %r", sender_email, email.subject)

        elif mode == "reply":
            _send_reply(email, draft_body, cache)
            _log.info("[autopilot] reply sent to %s re: %r", sender_email, email.subject)

    except Exception as e:
        _retry_queue[email.id] = (email, rule)
        _log.error("[autopilot] error for %s: %s — queued for retry", email.id, e)
        _log_activity(email, "error", cache)
