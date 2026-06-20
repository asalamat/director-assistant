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
            for row in rows:
                try:
                    from routers.email_send import _send_email
                    await _send_email(
                        cache=cache,
                        account_id=row["account_id"],
                        to_addr=row["to_addr"],
                        subject=row["subject"],
                        body=row["body"],
                    )
                    with cache._conn() as conn:
                        conn.execute("UPDATE scheduled_sends SET sent=1 WHERE id=?", (row["id"],))
                except Exception as e:
                    print(f"[scheduled-send] failed id={row['id']}: {e}")
        except Exception as e:
            print(f"[scheduled-send] loop error: {e}")
        await asyncio.sleep(60)


# ── Scheduled report email ─────────────────────────────────────────────────────

def _next_fire_seconds(schedule_str: str) -> float:
    """Calculate seconds until the next occurrence of 'weekday:HH:MM'.

    Returns at minimum 60.0 so the loop never fires immediately.
    """
    from datetime import datetime, timedelta
    DAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
            "friday": 4, "saturday": 5, "sunday": 6}
    try:
        parts = schedule_str.lower().split(":")
        target_day = DAYS.get(parts[0], 0)
        target_hour = int(parts[1])
        target_min = int(parts[2])
    except Exception:
        return 24 * 3600  # default 24h if malformed

    now = datetime.now()
    today_weekday = now.weekday()
    days_ahead = (target_day - today_weekday) % 7
    fire_dt = now.replace(hour=target_hour, minute=target_min, second=0, microsecond=0)
    if days_ahead == 0 and fire_dt <= now:
        days_ahead = 7  # already passed today, next week
    fire_dt += timedelta(days=days_ahead)
    secs = (fire_dt - now).total_seconds()
    return max(60.0, secs)


async def _scheduled_report_loop(app) -> None:
    """Background loop: send weekly brief email at the configured schedule."""
    import asyncio
    await asyncio.sleep(60)  # let server fully start
    while True:
        try:
            from routers.config import load_app_config
            cfg = load_app_config()
            enabled = cfg.get("report_email_enabled", False)
            schedule = cfg.get("report_email_schedule", "monday:07:00")
            to_email = cfg.get("report_email_to", "").strip()

            if not enabled or not to_email:
                await asyncio.sleep(3600)  # check again in 1h
                continue

            wait_secs = _next_fire_seconds(schedule)
            print(f"[report-scheduler] next report in {wait_secs/3600:.1f}h to {to_email}")
            await asyncio.sleep(wait_secs)

            # Re-check config after sleep (user may have disabled)
            cfg = load_app_config()
            if not cfg.get("report_email_enabled") or not cfg.get("report_email_to", "").strip():
                continue

            await _generate_and_send_report(app)

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[report-scheduler] error: {e}")
            await asyncio.sleep(3600)


async def _overnight_triage_loop(app) -> None:
    """Run overnight triage at the configured hour, generating draft replies for unread emails."""
    import asyncio
    await asyncio.sleep(90)  # let server settle

    while True:
        try:
            from routers.config import load_app_config
            cfg = load_app_config()
            enabled = cfg.get("overnight_triage_enabled", False)
            triage_hour = int(cfg.get("overnight_triage_hour", 23))  # 11 PM default

            if not enabled:
                await asyncio.sleep(3600)
                continue

            from datetime import datetime
            now = datetime.now()
            next_run = now.replace(hour=triage_hour, minute=0, second=0, microsecond=0)
            if next_run <= now:
                next_run = next_run.replace(day=next_run.day + 1)
            wait = (next_run - now).total_seconds()
            print(f"[overnight-triage] next run in {wait/3600:.1f}h")
            await asyncio.sleep(max(60, wait))

            cfg = load_app_config()
            if not cfg.get("overnight_triage_enabled"):
                continue

            await _run_overnight_triage(app)

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[overnight-triage] error: {e}")
            await asyncio.sleep(3600)


async def _run_overnight_triage(app) -> None:
    """Generate draft replies for unread emails."""
    import asyncio
    try:
        cache = app.state.cache
        advisor = app.state.advisor

        with cache._conn() as conn:
            # Get unread emails without existing overnight drafts
            rows = conn.execute(
                """SELECT id, subject, sender, body FROM emails
                   WHERE is_read = 0
                   AND id NOT IN (SELECT email_id FROM overnight_drafts WHERE status = 'pending')
                   ORDER BY date DESC LIMIT 20"""
            ).fetchall()

        drafted = 0
        for row in rows:
            try:
                body_preview = (row["body"] or "")[:600]
                subject = row["subject"] or ""
                sender = row["sender"] or ""

                # Only draft for emails that seem to need a reply
                check_prompt = f"""Does this email require a reply? Subject: {subject} From: {sender} Preview: {body_preview[:200]}
Reply with just YES or NO."""
                ant = getattr(advisor.ai, "_anthropic", None)
                if ant:
                    r = await ant.messages.create(
                        model="claude-haiku-4-5-20251001", max_tokens=5,
                        messages=[{"role": "user", "content": check_prompt}],
                    )
                    needs_reply = "yes" in r.content[0].text.lower()
                else:
                    r = await advisor.ai.messages.create(
                        model="claude-haiku-4-5-20251001", max_tokens=5,
                        messages=[{"role": "user", "content": check_prompt}],
                    )
                    needs_reply = "yes" in r.content[0].text.lower()

                if not needs_reply:
                    continue

                # Generate draft reply
                draft_prompt = f"""Write a professional, concise reply to this email.

From: {sender}
Subject: {subject}
Body: {body_preview}

Write a natural, helpful reply. Keep it brief (2-4 sentences). Return ONLY the email body text."""
                if ant:
                    dr = await ant.messages.create(
                        model="claude-haiku-4-5-20251001", max_tokens=400,
                        messages=[{"role": "user", "content": draft_prompt}],
                    )
                    draft = dr.content[0].text.strip()
                else:
                    dr = await advisor.ai.messages.create(
                        model="claude-haiku-4-5-20251001", max_tokens=400,
                        messages=[{"role": "user", "content": draft_prompt}],
                    )
                    draft = dr.content[0].text.strip()

                sender_email = sender.split("<")[-1].rstrip(">").strip() if "<" in sender else sender
                reply_subject = subject if subject.lower().startswith("re:") else f"Re: {subject}"

                with cache._conn() as conn:
                    conn.execute(
                        """INSERT INTO overnight_drafts (email_id, email_subject, email_sender, draft_body, draft_to, draft_subject)
                           VALUES (?,?,?,?,?,?)""",
                        (row["id"], subject, sender, draft, sender_email, reply_subject),
                    )
                drafted += 1
            except Exception:
                continue

        if drafted:
            print(f"[overnight-triage] generated {drafted} overnight drafts")
    except Exception as e:
        print(f"[overnight-triage] run error: {e}")


async def _generate_and_send_report(app) -> None:
    """Generate the weekly brief and email it to report_email_to."""
    import asyncio
    try:
        from routers.config import load_app_config
        cfg = load_app_config()
        to_email = cfg.get("report_email_to", "").strip()
        if not to_email:
            return

        cache = app.state.cache
        advisor = app.state.advisor

        # Build a simple plain-text weekly brief summary
        try:
            from routers.weekly_brief import generate_brief
            brief = await generate_brief(cache, advisor)
        except Exception as e:
            print(f"[report-scheduler] brief generation failed: {e}")
            brief = {"summary": "Weekly brief could not be generated."}

        summary = brief.get("summary") or "No summary available."
        actions = brief.get("action_items") or []
        waiting = brief.get("waiting_for") or []

        lines = [
            "Director Assistant — Weekly Brief",
            "=" * 40,
            "",
            summary,
            "",
        ]
        if actions:
            lines.append("ACTION ITEMS:")
            for a in actions[:10]:
                # items may be dicts with "text" key or plain strings
                text = a.get("text", str(a)) if isinstance(a, dict) else str(a)
                lines.append(f"  - {text}")
            lines.append("")
        if waiting:
            lines.append("WAITING FOR REPLY:")
            for w in waiting[:5]:
                text = w.get("text", str(w)) if isinstance(w, dict) else str(w)
                lines.append(f"  - {text}")
            lines.append("")
        lines.append("---")
        lines.append("Sent by Director Assistant")

        body_text = "\n".join(lines)

        # Send via first SMTP-capable account
        accounts = cache.list_accounts()
        smtp_acc = next(
            (a for a in accounts if getattr(a, "password", None)),
            None,
        )
        if not smtp_acc:
            print("[report-scheduler] no SMTP account found — cannot send report")
            return

        import email.mime.text
        import email.mime.multipart
        msg = email.mime.multipart.MIMEMultipart()
        msg["From"] = smtp_acc.username
        msg["To"] = to_email
        msg["Subject"] = "Weekly Brief — Director Assistant"
        msg.attach(email.mime.text.MIMEText(body_text, "plain"))

        loop = asyncio.get_event_loop()
        from routers.email_send import _smtp_send
        await loop.run_in_executor(None, _smtp_send, smtp_acc, msg)
        print(f"[report-scheduler] report sent to {to_email}")

    except Exception as e:
        print(f"[report-scheduler] send failed: {e}")


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
