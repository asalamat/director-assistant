"""Scheduled report, overnight triage, and app-mailer workers."""
import asyncio


async def _send_app_email(cache, msg, tag: str = "[mailer]") -> None:
    """Send a pre-built MIMEMultipart message via the best available account.

    Tries SMTP (password-based) first; falls back to Gmail REST API for
    OAuth-only setups so scheduled emails work even without an App Password.
    """
    accounts = cache.list_accounts()

    smtp_acc = next((a for a in accounts if getattr(a, "password", None)), None)
    if smtp_acc:
        msg["From"] = smtp_acc.username
        loop = asyncio.get_running_loop()
        from routers.email_send import _smtp_send
        await loop.run_in_executor(None, _smtp_send, smtp_acc, msg)
        return

    gmail_acc = next(
        (a for a in accounts if str(getattr(a, "provider", "")).lower() in ("gmail", "gmail_oauth")),
        None,
    )
    if gmail_acc:
        try:
            from services.email_extras import _kr_get_oauth_bundle
            import base64, httpx
            bundle = _kr_get_oauth_bundle(gmail_acc.id)
            access_token = bundle.get("access_token") or ""
            if not access_token:
                print(f"{tag} Gmail OAuth token missing — cannot send")
                return
            msg["From"] = gmail_acc.username
            raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(
                    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                    headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
                    json={"raw": raw},
                )
                if r.status_code == 401:
                    print(f"{tag} Gmail token expired — reconnect Google account in Settings")
                    return
                r.raise_for_status()
            return
        except Exception as e:
            print(f"{tag} Gmail API send failed: {e}")
            return

    print(f"{tag} no sendable account found — add an IMAP account or reconnect Google OAuth")


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
        return 24 * 3600

    now = datetime.now()
    today_weekday = now.weekday()
    days_ahead = (target_day - today_weekday) % 7
    fire_dt = now.replace(hour=target_hour, minute=target_min, second=0, microsecond=0)
    if days_ahead == 0 and fire_dt <= now:
        days_ahead = 7
    fire_dt += timedelta(days=days_ahead)
    return max(60.0, (fire_dt - now).total_seconds())


async def _scheduled_report_loop(app) -> None:
    """Background loop: send weekly brief email at the configured schedule."""
    await asyncio.sleep(60)
    while True:
        try:
            from routers.config import load_app_config
            cfg = load_app_config()
            enabled = cfg.get("report_email_enabled", False)
            schedule = cfg.get("report_email_schedule", "monday:07:00")
            to_email = cfg.get("report_email_to", "").strip()

            if not enabled or not to_email:
                await asyncio.sleep(3600)
                continue

            wait_secs = _next_fire_seconds(schedule)
            print(f"[report-scheduler] next report in {wait_secs/3600:.1f}h to {to_email}")
            await asyncio.sleep(wait_secs)

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
    await asyncio.sleep(90)
    while True:
        try:
            from routers.config import load_app_config
            cfg = load_app_config()
            enabled = cfg.get("overnight_triage_enabled", False)
            triage_hour = int(cfg.get("overnight_triage_hour", 23))

            if not enabled:
                await asyncio.sleep(3600)
                continue

            from datetime import datetime
            now = datetime.now()
            next_run = now.replace(hour=triage_hour, minute=0, second=0, microsecond=0)
            if next_run <= now:
                from datetime import timedelta
                next_run += timedelta(days=1)
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
    try:
        cache = app.state.cache
        advisor = app.state.advisor

        with cache._conn() as conn:
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

                check_prompt = f"""Does this email require a reply? Subject: {subject} From: {sender} Preview: {body_preview[:200]}
Reply with just YES or NO."""
                ant = getattr(advisor.ai, "_anthropic", None)
                ai_call = ant.messages.create if ant else advisor.ai.messages.create
                r = await ai_call(
                    model="claude-haiku-4-5-20251001", max_tokens=5,
                    messages=[{"role": "user", "content": check_prompt}],
                )
                if "yes" not in r.content[0].text.lower():
                    continue

                draft_prompt = f"""Write a professional, concise reply to this email.

From: {sender}
Subject: {subject}
Body: {body_preview}

Write a natural, helpful reply. Keep it brief (2-4 sentences). Return ONLY the email body text."""
                dr = await ai_call(
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
    try:
        from routers.config import load_app_config
        cfg = load_app_config()
        to_email = cfg.get("report_email_to", "").strip()
        if not to_email:
            return

        cache = app.state.cache
        advisor = app.state.advisor

        try:
            from routers.weekly_brief import generate_brief
            brief = await generate_brief(cache, advisor)
        except Exception as e:
            print(f"[report-scheduler] brief generation failed: {e}")
            brief = {"summary": "Weekly brief could not be generated."}

        summary = brief.get("summary") or "No summary available."
        actions = brief.get("action_items") or []
        waiting = brief.get("waiting_for") or []

        lines = ["Director Assistant — Weekly Brief", "=" * 40, "", summary, ""]
        if actions:
            lines.append("ACTION ITEMS:")
            for a in actions[:10]:
                text = a.get("text", str(a)) if isinstance(a, dict) else str(a)
                lines.append(f"  - {text}")
            lines.append("")
        if waiting:
            lines.append("WAITING FOR REPLY:")
            for w in waiting[:5]:
                text = w.get("text", str(w)) if isinstance(w, dict) else str(w)
                lines.append(f"  - {text}")
            lines.append("")
        lines += ["---", "Sent by Director Assistant"]

        import email.mime.text, email.mime.multipart
        msg = email.mime.multipart.MIMEMultipart()
        msg["To"] = to_email
        msg["Subject"] = "Weekly Brief — Director Assistant"
        msg.attach(email.mime.text.MIMEText("\n".join(lines), "plain"))

        await _send_app_email(cache, msg, "[report-scheduler]")
        print(f"[report-scheduler] report sent to {to_email}")

    except Exception as e:
        print(f"[report-scheduler] send failed: {e}")


async def _daily_brief_scheduler(app) -> None:
    """Send morning brief daily at the configured time."""
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from datetime import datetime as _dt, date as _date
    await asyncio.sleep(45)
    while True:
        await asyncio.sleep(60)
        try:
            from routers.config import load_app_config, save_app_config
            from routers.email_send import _smtp_send
            cfg = load_app_config()
            if not cfg.get("morning_brief_email_enabled"):
                continue
            to_email = cfg.get("morning_brief_email_to", "").strip()
            if not to_email:
                continue
            brief_time = cfg.get("morning_brief_email_time", "08:00")
            now = _dt.now()
            today_str = now.strftime("%Y-%m-%d")
            if cfg.get("morning_brief_last_sent") == today_str:
                continue
            h, m = map(int, brief_time.split(":"))
            if now < now.replace(hour=h, minute=m, second=0, microsecond=0):
                continue
            from routers.morning_brief import (
                _top_news, _priority_emails, _overdue_followups,
                _open_commitments, _active_projects,
            )
            from routers.calendar import get_today_events
            cache = app.state.cache
            news = await _top_news()
            emails = _priority_emails(cache)
            today = _date.today().isoformat()
            chase = _overdue_followups(cache, today)
            commitments = _open_commitments(cache)
            projects = _active_projects(cache)
            events = await get_today_events(cache)
            lines = [
                "Director Assistant — Morning Brief",
                now.strftime("%A, %B %-d, %Y"),
                "=" * 42, "",
            ]
            if events:
                lines += ["TODAY'S SCHEDULE:"] + [
                    f"  {e['start'][11:16]} - {e['end'][11:16]}  {e['title']}"
                    for e in events
                ] + [""]
            if emails:
                lines += ["PRIORITY INBOX:"] + [
                    f"  * {e['subject']}  ({e['sender']})" for e in emails[:5]
                ] + [""]
            if news:
                lines += ["NEWS TO KNOW:"] + [
                    f"  * {a.get('title','')}  [{a.get('source','')}]" for a in news[:4]
                ] + [""]
            if chase:
                lines += ["OVERDUE FOLLOW-UPS:"] + [
                    f"  * {c['subject']} (due {c['due_date']})" for c in chase
                ] + [""]
            if commitments:
                lines += ["OPEN COMMITMENTS:"] + [
                    f"  * {c['description']}" for c in commitments[:5]
                ] + [""]
            if projects:
                lines += ["ACTIVE PROJECTS:"] + [
                    f"  * {p['name']} - {p['status']}" for p in projects[:5]
                ] + [""]
            lines += ["---", "Sent by Director Assistant"]
            accounts = cache.list_accounts()
            smtp_acc = next((a for a in accounts if getattr(a, "password", None)), None)
            if not smtp_acc:
                print("[morning-brief-scheduler] no SMTP account — skipping")
                continue
            msg = MIMEMultipart()
            msg["From"] = smtp_acc.username
            msg["To"] = to_email
            msg["Subject"] = f"Morning Brief — {now.strftime('%A, %B %-d')}"
            msg.attach(MIMEText("\n".join(lines), "plain", "utf-8"))
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, _smtp_send, smtp_acc, msg)
            print(f"[morning-brief-scheduler] brief sent to {to_email}")
            cfg["morning_brief_last_sent"] = today_str
            save_app_config(cfg)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[morning-brief-scheduler] error: {e}")


async def _send_scheduled_digest(app) -> None:
    """Generate and send the daily digest email via SMTP."""
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from datetime import date as _date
    from routers.config import load_app_config
    from routers.email_send import _smtp_send
    cfg = load_app_config()
    to_email = cfg.get("digest_schedule_email", "")
    if not to_email:
        return
    digest_svc = app.state.digest
    cache = app.state.cache
    try:
        digest = await digest_svc.generate(cache, hours=24)
    except Exception as e:
        print(f"[digest-scheduler] generate failed: {e}")
        return
    accounts = cache.list_accounts()
    smtp_acc = next((a for a in accounts if getattr(a, "password", None)), None)
    if not smtp_acc:
        print("[digest-scheduler] no SMTP account — skipping send")
        return
    subject = f"Director Assistant Digest — {_date.today().strftime('%A, %B %d')}"
    lines = [digest.get("summary", ""), ""]
    if digest.get("top_action_items"):
        lines += ["Action Items:"] + [f"* {a}" for a in digest["top_action_items"][:5]] + [""]
    if digest.get("highlights"):
        lines += ["Highlights:"] + [f"* {h}" for h in digest["highlights"][:5]]
    msg = MIMEMultipart()
    msg["From"] = smtp_acc.username
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText("\n".join(lines), "plain", "utf-8"))
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _smtp_send, smtp_acc, msg)
    print(f"[digest-scheduler] digest sent to {to_email}")


async def _digest_scheduler(app) -> None:
    """Background loop: send digest at configured time once per day."""
    await asyncio.sleep(30)
    while True:
        await asyncio.sleep(60)
        try:
            from routers.config import load_app_config, save_app_config
            from datetime import datetime as _dt
            cfg = load_app_config()
            if not cfg.get("digest_schedule_enabled"):
                continue
            now = _dt.now()
            today_str = now.strftime("%Y-%m-%d")
            if cfg.get("digest_last_sent") == today_str:
                continue
            h, m = map(int, cfg.get("digest_schedule_time", "08:00").split(":"))
            if now >= now.replace(hour=h, minute=m, second=0, microsecond=0):
                await _send_scheduled_digest(app)
                cfg["digest_last_sent"] = today_str
                save_app_config(cfg)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[digest-scheduler] error: {e}")
