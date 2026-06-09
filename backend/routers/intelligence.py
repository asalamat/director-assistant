"""Intelligence endpoints — people graph, open loops, clusters, timeline, briefing."""

import asyncio
import json
import re
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

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

    # Remove entries with no phones
    hints = {k: v for k, v in hints.items() if v["phones"]}

    return {"hints": hints}
