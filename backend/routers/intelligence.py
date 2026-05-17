"""Intelligence endpoints — people graph, open loops, clusters, timeline, briefing."""

import asyncio
import json
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
