"""Background worker tasks for Director Assistant.

Contains the proactive feature loops that run independently of the poll cycle:
- _commitment_scan_loop   — scan sent mail for commitments every 30 min
- _rules_loop             — apply all enabled email rules every 30 min
- _relationship_health_loop — alert on long-awaited replies every 2 hours
- _auto_label_loop        — label recent unlabeled emails every hour
- _auto_deadline_extract  — extract deadlines from new emails per poll cycle
- _auto_cluster_alert     — alert when 3+ new emails share a topic
- _auto_sentiment_escalation — alert on frustrated tone from VIP senders
- _auto_recommend         — pre-cache recommendations for high-priority emails
- _auto_autopilot         — generate/send AI replies for autopilot-rule senders
"""

import asyncio

from routers.config import get_effective_api_key
from routers.proactive import push_alert


# ── Keyword helpers ───────────────────────────────────────────────────────────

_URGENT_KEYWORDS = frozenset({
    "urgent", "asap", "deadline", "action required", "time-sensitive",
    "immediately", "critical", "time sensitive", "respond by", "due today",
    "overdue", "emergency", "important",
})


def _is_high_priority(email) -> bool:
    return any(kw in (email.subject or "").lower() for kw in _URGENT_KEYWORDS)


# ── Per-poll-cycle tasks ──────────────────────────────────────────────────────

async def _auto_recommend(app, new_emails: list) -> None:
    """Background: run the advisor on up to 3 high-priority new emails per poll cycle."""
    from routers.email_list import _rec_cache, _REC_COOLDOWN
    from time import monotonic

    if not get_effective_api_key():
        return

    advisor = app.state.advisor
    rag = app.state.rag
    cache = app.state.cache

    candidates = [e for e in new_emails if _is_high_priority(e)][:3]
    for email in candidates:
        if email.id in _rec_cache:
            ts, _ = _rec_cache[email.id]
            if monotonic() - ts < _REC_COOLDOWN:
                continue
        try:
            similar = await rag.get_similar_emails(email, n=5)
            doc_query = f"{email.subject} {(email.body or '')[:300]}"
            related_docs = [r for r in rag.semantic_search(doc_query, n=3)
                            if r.get("source_type") == "document"]
            thread_history: list[dict] = []
            if email.thread_id:
                with cache._conn() as conn:
                    t_rows = conn.execute(
                        """SELECT subject, sender, date, body FROM emails
                           WHERE thread_id = ? AND id != ?
                           ORDER BY date ASC LIMIT 3""",
                        (email.thread_id, email.id),
                    ).fetchall()
                    thread_history = [
                        {"subject": r["subject"] or "", "sender": r["sender"] or "",
                         "date": r["date"] or "", "text": (r["body"] or "")[:800]}
                        for r in t_rows
                    ]
            rec = await advisor.get_recommendation(email, similar, related_docs, thread_history)
            _rec_cache[email.id] = (monotonic(), rec)
            print(f"[auto-rec] pre-cached recommendation: {email.subject!r}")
        except Exception as e:
            print(f"[auto-rec] skipped {email.id}: {e}")


async def _auto_deadline_extract(app, new_emails: list) -> None:
    """Feature 2: Extract deadlines from new emails and auto-create follow-up reminders."""
    import json as _json
    from datetime import datetime, date as _date

    if not new_emails or not get_effective_api_key():
        return
    advisor = app.state.advisor
    cache = app.state.cache
    ant = getattr(advisor.ai, "_anthropic", None)
    for em in new_emails[:5]:
        body = (em.body or "")[:600]
        if not body:
            continue
        prompt = (
            f"Does this email mention a deadline, due date, or time-sensitive request?\n"
            f"Subject: {em.subject}\n{body}\n\n"
            'If yes, return JSON: {"has_deadline": true, "description": "brief action", "due_date": "YYYY-MM-DD or null"}\n'
            'If no, return {"has_deadline": false}'
        )
        try:
            if ant:
                resp = await ant.messages.create(
                    model="claude-haiku-4-5-20251001", max_tokens=120,
                    messages=[{"role": "user", "content": prompt}])
                text = resp.content[0].text.strip()
            else:
                resp = await advisor.ai.messages.create(
                    model="claude-haiku-4-5-20251001", max_tokens=120,
                    messages=[{"role": "user", "content": prompt}])
                text = resp.content[0].text.strip()
            start, end = text.find("{"), text.rfind("}") + 1
            data = _json.loads(text[start:end]) if start >= 0 else {}
            if data.get("has_deadline"):
                desc = data.get("description") or em.subject or "Follow up"
                due = data.get("due_date") or _date.today().isoformat()
                # Validate date format
                try:
                    datetime.fromisoformat(due)
                except Exception:
                    due = _date.today().isoformat()
                from models import FollowUp
                f = FollowUp(email_id=em.id, subject=em.subject or "", due_date=due,
                             note=f"Auto-detected deadline: {desc}", done=False)
                cache.add_follow_up(f)
                push_alert(app, "deadline",
                           f"Deadline detected: {desc} — {em.subject or 'new email'}", "actions")
        except Exception as e:
            print(f"[proactive-deadline] {em.id}: {e}")


async def _auto_cluster_alert(app, new_emails: list) -> None:
    """Feature 5: Alert when 3+ new emails cluster around the same topic."""
    if len(new_emails) < 3:
        return
    rag = app.state.rag
    try:
        # Use the first email as query to find how many of the new emails are similar
        query = f"{new_emails[0].subject} {(new_emails[0].body or '')[:200]}"
        related = rag.semantic_search(query, n=10)
        related_ids = {r.get("email_id") for r in related if r.get("source_type") != "document"}
        new_ids = {em.id for em in new_emails}
        cluster_size = len(related_ids & new_ids)
        if cluster_size >= 3:
            topic = new_emails[0].subject or "a shared topic"
            push_alert(app, "cluster",
                       f"{cluster_size} new emails about the same topic: \"{topic}\" — view together in Topic Search",
                       "ask")
    except Exception as e:
        print(f"[proactive-cluster] {e}")


async def _auto_sentiment_escalation(app, new_emails: list) -> None:
    """Feature 6: Alert on frustrated/demanding tone from VIP contacts with unreplied emails."""
    import json as _json

    if not new_emails or not get_effective_api_key():
        return
    advisor = app.state.advisor
    cache = app.state.cache
    ant = getattr(advisor.ai, "_anthropic", None)

    # Get VIP senders (top 20 by frequency)
    with cache._conn() as conn:
        vip_rows = conn.execute(
            "SELECT LOWER(sender) as s FROM emails GROUP BY LOWER(sender) "
            "ORDER BY COUNT(*) DESC LIMIT 20"
        ).fetchall()
    vip_senders = {r["s"].split("@")[0] for r in vip_rows if r["s"]}

    for em in new_emails[:5]:
        sender_lower = (em.sender or "").lower()
        is_vip = any(v in sender_lower for v in vip_senders)
        if not is_vip:
            continue
        body = (em.body or "")[:400]
        if not body:
            continue
        prompt = (
            f"Is this email frustrated, demanding, or expressing urgency/disappointment?\n"
            f"Subject: {em.subject}\n{body}\n\n"
            'Return JSON: {"escalate": true/false, "reason": "brief reason"}'
        )
        try:
            if ant:
                resp = await ant.messages.create(
                    model="claude-haiku-4-5-20251001", max_tokens=80,
                    messages=[{"role": "user", "content": prompt}])
                text = resp.content[0].text.strip()
            else:
                resp = await advisor.ai.messages.create(
                    model="claude-haiku-4-5-20251001", max_tokens=80,
                    messages=[{"role": "user", "content": prompt}])
                text = resp.content[0].text.strip()
            start, end = text.find("{"), text.rfind("}") + 1
            data = _json.loads(text[start:end]) if start >= 0 else {}
            if data.get("escalate"):
                display = (em.sender or "Someone").split("<")[0].strip() or em.sender
                push_alert(app, "sentiment",
                           f"Urgent tone from {display}: {data.get('reason', '')} — {em.subject}",
                           "inbox")
        except Exception as e:
            print(f"[proactive-sentiment] {em.id}: {e}")


async def _auto_autopilot(app, new_emails: list) -> None:
    """Check new emails against autopilot rules; generate and send/draft replies."""
    from services.autopilot_engine import handle_incoming_email, _retry_queue
    cache = app.state.cache
    rag = app.state.rag
    ai = app.state.advisor.ai
    if not getattr(ai, '_providers', None):
        return

    # Process new emails first
    for em in new_emails:
        try:
            await handle_incoming_email(em, cache, rag, ai)
        except Exception as e:
            print(f"[autopilot] error for {em.id}: {e}")

    # Retry previously failed emails (AI was temporarily unavailable)
    if _retry_queue:
        retry_ids = list(_retry_queue.keys())
        for eid in retry_ids:
            if eid in _retry_queue:  # may have been cleared by new_emails loop above
                em, _ = _retry_queue[eid]
                try:
                    await handle_incoming_email(em, cache, rag, ai)
                except Exception as e:
                    print(f"[autopilot] retry error for {eid}: {e}")


async def _autopilot_startup_recovery(app) -> None:
    """On startup, find emails from rule-senders never processed by autopilot.

    Emails received during a server restart or before autopilot rules were added
    are in the DB but not in autopilot_activity. This scan recovers them.
    """
    await asyncio.sleep(90)  # let initial poll and ingest complete first

    from services.autopilot_engine import handle_incoming_email
    import sqlite3

    cache = app.state.cache
    rag = app.state.rag
    ai = app.state.advisor.ai
    if not getattr(ai, '_providers', None):
        return

    try:
        rules = cache.list_autopilot_rules()
        if not rules:
            return

        active_rules = [r for r in rules if r.get("mode", "off") != "off"]
        if not active_rules:
            return

        db_path = getattr(cache, "db_path", None)
        if not db_path:
            return

        recovered = 0
        for rule in active_rules:
            sender_email = rule.get("email_addr", "").strip().lower()
            if not sender_email:
                continue

            with sqlite3.connect(db_path) as conn:
                conn.row_factory = sqlite3.Row
                # Find emails from this sender in the last 7 days that were:
                # (a) never processed (no activity row), OR
                # (b) failed with ai_failed/error and have fewer than 3 failure attempts.
                # Skip emails already successfully replied or drafted.
                rows = conn.execute(
                    """SELECT e.id FROM emails e
                       WHERE INSTR(LOWER(e.sender), ?) > 0
                         AND e.date >= datetime('now', '-7 days')
                         AND e.folder NOT IN ('Sent', 'Drafts', 'Trash', '[Gmail]/Sent Mail',
                                              '[Gmail]/Drafts', '[Gmail]/Trash')
                         AND NOT EXISTS (
                             SELECT 1 FROM autopilot_activity a
                             WHERE a.email_id = e.id
                               AND a.action IN ('reply_sent', 'draft_saved')
                         )
                         AND (
                             SELECT COUNT(*) FROM autopilot_activity a
                             WHERE a.email_id = e.id
                               AND a.action IN ('ai_failed', 'error')
                         ) < 3
                       ORDER BY e.date ASC""",
                    (sender_email,),
                ).fetchall()

            for row in rows:
                em = cache.get(row["id"])
                if em is None:
                    continue
                try:
                    await handle_incoming_email(em, cache, rag, ai)
                    recovered += 1
                    print(f"[autopilot] recovered orphaned email {em.id} ({em.subject!r})")
                except Exception as e:
                    print(f"[autopilot] recovery error for {em.id}: {e}")

        if recovered:
            print(f"[autopilot] startup recovery processed {recovered} orphaned email(s)")

    except Exception as e:
        print(f"[autopilot] startup recovery failed: {e}")


# ── Long-running background loops ─────────────────────────────────────────────

async def _commitment_scan_loop(app: "object") -> None:
    """Feature 1: Periodically scan sent mail for commitments and add to action board."""
    import json as _json

    await asyncio.sleep(120)   # let startup settle
    while True:
        await asyncio.sleep(1800)  # every 30 min
        if not get_effective_api_key():
            continue
        try:
            cache = app.state.cache
            advisor = app.state.advisor
            ant = getattr(advisor.ai, "_anthropic", None)
            with cache._conn() as conn:
                rows = conn.execute(
                    """SELECT id, subject, body FROM emails
                       WHERE LOWER(folder) LIKE '%sent%'
                       AND date >= datetime('now', '-7 days')
                       ORDER BY date DESC LIMIT 10"""
                ).fetchall()
                existing_ids = {r[0] for r in conn.execute(
                    "SELECT DISTINCT email_id FROM action_items"
                ).fetchall()}
            new_items = 0
            for row in rows:
                if row["id"] in existing_ids:
                    continue
                body = (row["body"] or "")[:500]
                if not body:
                    continue
                prompt = (
                    f"Extract concrete commitments from this email you sent.\n"
                    f"Subject: {row['subject']}\n{body}\n\n"
                    'Return JSON: {"commitments": ["item1"]} or {"commitments": []}'
                )
                try:
                    if ant:
                        resp = await ant.messages.create(
                            model="claude-haiku-4-5-20251001", max_tokens=150,
                            messages=[{"role": "user", "content": prompt}])
                        text = resp.content[0].text.strip()
                    else:
                        resp = await advisor.ai.messages.create(
                            model="claude-haiku-4-5-20251001", max_tokens=150,
                            messages=[{"role": "user", "content": prompt}])
                        text = resp.content[0].text.strip()
                    s, e = text.find("{"), text.rfind("}") + 1
                    data = _json.loads(text[s:e]) if s >= 0 else {}
                    items = data.get("commitments", [])
                    if items:
                        cache.add_action_items(row["id"], row["subject"] or "", items)
                        new_items += len(items)
                except Exception:
                    continue
            if new_items > 0:
                push_alert(app, "commitment",
                           f"Found {new_items} commitment{'' if new_items==1 else 's'} in your sent mail — check the action board",
                           "actions")
        except Exception as e:
            print(f"[proactive-commitments] {e}")


async def _relationship_health_loop(app: "object") -> None:
    """Feature 3: Alert when important contacts are waiting too long for a reply."""
    await asyncio.sleep(300)
    while True:
        await asyncio.sleep(7200)  # every 2 hours
        try:
            cache = app.state.cache
            with cache._conn() as conn:
                # VIP contacts = top 20 senders
                vip_rows = conn.execute(
                    "SELECT sender FROM emails GROUP BY LOWER(sender) "
                    "ORDER BY COUNT(*) DESC LIMIT 20"
                ).fetchall()
                vip_senders = [r["sender"] for r in vip_rows if r["sender"]]

                for sender in vip_senders[:10]:
                    # Count unreplied emails from them in last 7 days
                    unreplied = conn.execute(
                        """SELECT COUNT(*) as cnt FROM emails e
                           WHERE LOWER(e.sender) = LOWER(?)
                           AND e.date >= datetime('now', '-7 days')
                           AND NOT EXISTS (
                               SELECT 1 FROM emails r
                               WHERE r.thread_id = e.thread_id
                               AND LOWER(r.folder) LIKE '%sent%'
                               AND r.date > e.date
                           )""",
                        (sender,),
                    ).fetchone()
                    count = unreplied["cnt"] if unreplied else 0
                    if count >= 3:
                        display = sender.split("<")[0].strip() or sender
                        push_alert(app, "relationship",
                                   f"{display} has {count} emails waiting for your reply",
                                   "inbox")
                        break  # only alert for one contact per cycle
        except Exception as e:
            print(f"[proactive-relationship] {e}")


async def _auto_label_loop(app: "object") -> None:
    """Periodically label recent unlabeled emails."""
    await asyncio.sleep(180)
    while True:
        await asyncio.sleep(3600)  # every hour
        try:
            cache = app.state.cache
            classifier = app.state.classifier
            with cache._conn() as conn:
                rows = conn.execute(
                    """SELECT id, subject, sender, body FROM emails
                       WHERE id NOT IN (SELECT email_id FROM email_categories)
                       AND date >= datetime('now', '-7 days')
                       ORDER BY date DESC LIMIT 30"""
                ).fetchall()
            for row in rows:
                try:
                    cat = await classifier.classify(
                        row["id"], row["subject"] or "", row["sender"] or "",
                        (row["body"] or "")[:200]
                    )
                    cache.set_category(row["id"], cat)
                except Exception:
                    continue
            if rows:
                print(f"[auto-label] labeled {len(rows)} emails")
        except Exception as e:
            print(f"[auto-label] {e}")


async def _scheduled_send_loop(app: "object") -> None:
    """Check and dispatch scheduled emails every 60 seconds."""
    import asyncio
    while True:
        try:
            cache = app.state.cache
            with cache._conn() as conn:
                from datetime import datetime, timezone
                now = datetime.now(timezone.utc).isoformat()
                rows = conn.execute(
                    "SELECT * FROM scheduled_sends WHERE sent=0 AND send_at <= ? ORDER BY send_at LIMIT 10",
                    (now,)
                ).fetchall()
            loop = asyncio.get_event_loop()
            for row in rows:
                try:
                    from email.mime.multipart import MIMEMultipart
                    from email.mime.text import MIMEText
                    from routers.email_send import _resolve_account, _smtp_send
                    acc = _resolve_account(cache, row["account_id"])
                    msg = MIMEMultipart()
                    msg["From"] = acc.username
                    msg["To"] = row["to_addr"]
                    msg["Subject"] = row["subject"]
                    msg.attach(MIMEText(row["body"], "plain", "utf-8"))
                    await loop.run_in_executor(None, _smtp_send, acc, msg)
                    with cache._conn() as conn:
                        conn.execute("UPDATE scheduled_sends SET sent=1 WHERE id=?", (row["id"],))
                except Exception as e:
                    print(f"[scheduled-send] failed id={row['id']}: {e}")
        except Exception as e:
            print(f"[scheduled-send] loop error: {e}")
        await asyncio.sleep(60)


# ── Scheduled report, overnight triage, and mailer live in workers/reports_worker.py ──
from workers.reports_worker import _send_app_email, _scheduled_report_loop, _overnight_triage_loop  # noqa: F401,E402


async def _followup_reminder_loop(app: "object") -> None:
    """Feature 3: Auto-add sent emails with no reply to the Chase Queue as follow-up reminders.

    Runs hourly. Sent emails older than N days (config `followup_reminder_days`, default 3)
    with no detected reply are added as follow-ups, deduped against existing ones by email_id.
    """
    from datetime import date as _date
    from models import FollowUp

    await asyncio.sleep(240)  # let startup settle
    while True:
        await asyncio.sleep(3600)  # every hour
        try:
            from routers.config import load_app_config
            cfg = load_app_config()
            if not cfg.get("followup_reminder_enabled", True):
                continue
            try:
                days = int(cfg.get("followup_reminder_days", 3))
            except (TypeError, ValueError):
                days = 3
            days = max(1, days)

            cache = app.state.cache
            from services.waiting_reply import get_waiting_replies
            waiting = get_waiting_replies(cache, threshold_days=days, limit=50)
            if not waiting:
                continue

            existing_ids = {f.email_id for f in cache.list_follow_ups()}
            added = 0
            for em in waiting:
                if em["id"] in existing_ids:
                    continue
                recipient = em.get("recipient") or ""
                f = FollowUp(
                    email_id=em["id"],
                    subject=em.get("subject") or "",
                    sender=recipient,
                    due_date=_date.today().isoformat(),
                    note=f"No reply after {em.get('days_waiting', days)} days — sent to {recipient or 'recipient'}",
                    done=False,
                )
                cache.add_follow_up(f)
                added += 1
            if added > 0:
                push_alert(app, "followup",
                           f"{added} sent email{'' if added == 1 else 's'} with no reply added to your Chase Queue",
                           "actions")
                print(f"[followup-reminder] added {added} follow-ups")
        except Exception as e:
            print(f"[followup-reminder] {e}")


async def daily_focus_task(app) -> None:
    """Send a daily focus email at 8am with overdue actions, today's due items, and open loops count."""
    from datetime import datetime, date as _date
    import email.mime.text
    import email.mime.multipart
    import asyncio

    await asyncio.sleep(120)  # let server settle
    while True:
        try:
            from routers.config import load_app_config
            cfg = load_app_config()
            if not cfg.get("daily_focus_enabled", False):
                await asyncio.sleep(3600)
                continue

            now = datetime.now()
            if now.hour != 8:
                # Sleep until roughly the next check (check every 30 min)
                await asyncio.sleep(1800)
                continue

            to_email = cfg.get("report_email_to", "").strip()
            if not to_email:
                await asyncio.sleep(3600)
                continue

            cache = app.state.cache
            today = _date.today().isoformat()

            with cache._conn() as conn:
                overdue = conn.execute(
                    "SELECT subject, due_date FROM follow_ups WHERE due_date < ? AND done = 0 ORDER BY due_date",
                    (today,),
                ).fetchall()
                due_today = conn.execute(
                    "SELECT subject, due_date FROM follow_ups WHERE due_date = ? AND done = 0",
                    (today,),
                ).fetchall()

            svc = getattr(app.state, "intelligence", None)
            open_loops_count = 0
            if svc:
                try:
                    loops = await svc.get_open_loops(max_emails=50)
                    open_loops_count = len(loops) if isinstance(loops, list) else 0
                except Exception:
                    pass

            lines = [
                f"Director Assistant — Daily Focus",
                f"{'=' * 40}",
                "",
            ]

            if overdue:
                lines.append(f"OVERDUE ({len(overdue)}):")
                for r in overdue:
                    lines.append(f"  - {r['subject']} (was due {r['due_date']})")
                lines.append("")

            if due_today:
                lines.append(f"DUE TODAY ({len(due_today)}):")
                for r in due_today:
                    lines.append(f"  - {r['subject']}")
                lines.append("")

            lines.append(f"OPEN LOOPS: {open_loops_count} threads waiting on action")
            lines.append("")
            lines.append("---")
            lines.append("Sent by Director Assistant")

            body_text = "\n".join(lines)
            subject = f"Daily Focus — {_date.today().strftime('%A, %B %d')}"

            msg = email.mime.multipart.MIMEMultipart()
            msg["To"] = to_email
            msg["Subject"] = subject
            msg.attach(email.mime.text.MIMEText(body_text, "plain"))

            await _send_app_email(cache, msg, "[daily-focus]")
            print(f"[daily-focus] sent to {to_email}")

            # Sleep ~23h to avoid double-firing on the same day
            await asyncio.sleep(82800)

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[daily-focus] error: {e}")
            await asyncio.sleep(3600)


async def _rules_loop(app: "object") -> None:
    """Apply all enabled email rules every 30 minutes."""
    await asyncio.sleep(60)  # let startup settle
    while True:
        await asyncio.sleep(1800)  # every 30 min
        try:
            cache = app.state.cache
            rag = getattr(app.state, "rag", None)
            with cache._conn() as conn:
                emails = conn.execute(
                    "SELECT id, sender, subject, body FROM emails ORDER BY date DESC LIMIT 2000"
                ).fetchall()
                rules = conn.execute(
                    "SELECT * FROM email_rules WHERE enabled=1 ORDER BY priority DESC"
                ).fetchall()
            if not rules:
                continue
            labeled = archived = marked = deleted = 0
            for row in emails:
                email_id = row["id"]
                for rule in rules:
                    field = rule["field"]
                    val = ""
                    if field == "sender":
                        val = (row["sender"] or "").lower()
                    elif field == "subject":
                        val = (row["subject"] or "").lower()
                    elif field == "body":
                        val = ((row["body"] or "")[:1000]).lower()
                    check = rule["value"].lower()
                    cond = rule["condition"]
                    matched = (
                        (cond == "contains" and check in val) or
                        (cond == "equals" and val == check) or
                        (cond == "starts_with" and val.startswith(check)) or
                        (cond == "ends_with" and val.endswith(check))
                    )
                    if not matched:
                        continue
                    action = rule["action"]
                    if action == "label" and rule["label"]:
                        cache.set_category(email_id, rule["label"])
                        labeled += 1
                    elif action == "mark_read":
                        with cache._conn() as conn:
                            conn.execute("UPDATE emails SET is_read=1 WHERE id=?", (email_id,))
                        marked += 1
                    elif action == "archive":
                        with cache._conn() as conn:
                            conn.execute("UPDATE emails SET folder='Archive' WHERE id=?", (email_id,))
                        archived += 1
                    elif action == "delete":
                        with cache._conn() as conn:
                            conn.execute("DELETE FROM emails WHERE id=?", (email_id,))
                        if rag:
                            try:
                                rag.remove_email(email_id)
                            except Exception:
                                pass
                        deleted += 1
                        break
            from routers.email_rules import log_rules_run
            log_rules_run(cache, labeled, archived, marked, deleted)
            print(f"[rules-loop] rules run: labeled={labeled} archived={archived} marked={marked} deleted={deleted}")
        except Exception as e:
            print(f"[rules-loop] error: {e}")


# Instagram and LinkedIn autopilot loops live in workers/social_workers.py
