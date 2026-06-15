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


@router.get("/clusters")
async def get_clusters(request: Request):
    svc = getattr(request.app.state, "intelligence", None)
    if not svc:
        return {"clusters": [], "error": "Intelligence service not available"}
    clusters = await svc.get_clusters()
    return {"clusters": clusters}


@router.post("/clusters/generate")
async def generate_clusters(request: Request):
    """Force-regenerate clusters by clearing cache then running AI analysis."""
    svc = getattr(request.app.state, "intelligence", None)
    if not svc:
        return {"clusters": [], "error": "Intelligence service not available"}
    svc.invalidate_cache()
    clusters = await svc.get_clusters()
    return {"clusters": clusters}


@router.get("/timeline")
async def get_timeline(request: Request, q: str = "", limit: int = 60):
    svc = getattr(request.app.state, "intelligence", None)
    if not svc:
        return {"events": []}
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

