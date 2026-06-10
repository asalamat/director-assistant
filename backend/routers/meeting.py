"""Meeting intelligence — audio transcription and action extraction."""

import json
import os
import tempfile
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/meeting", tags=["meeting"])


class SaveRecordingRequest(BaseModel):
    transcript: str
    action_items: list[str] = []
    draft_email: str = ""
    duration_secs: int = 0
    title: str = ""


@router.post("/recordings")
async def save_recording(req: SaveRecordingRequest, request: Request):
    """Persist a meeting recording to the database."""
    cache = request.app.state.cache
    title = req.title.strip() or (req.transcript[:60].split('.')[0] + '…')
    with cache._conn() as conn:
        cur = conn.execute(
            """INSERT INTO meeting_recordings (transcript, action_items, draft_email, duration_secs, title)
               VALUES (?,?,?,?,?)""",
            (req.transcript, json.dumps(req.action_items), req.draft_email, req.duration_secs, title),
        )
        rid = cur.lastrowid

    # Index transcript into RAG so Ask can search it (best-effort)
    try:
        rag = request.app.state.rag
        rag.ingest_contact(
            email_addr=f"meeting__{rid}",
            name=f"Meeting: {title}",
            note=req.transcript[:4000],
            source="meeting",
        )
    except Exception:
        pass

    return {"id": rid, "title": title}


@router.get("/recordings")
async def list_recordings(request: Request):
    """List all saved meeting recordings, newest first."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT id, recorded_at, duration_secs, title,
                      substr(transcript, 1, 200) as preview
               FROM meeting_recordings ORDER BY recorded_at DESC LIMIT 50"""
        ).fetchall()
    return {"recordings": [dict(r) for r in rows]}


@router.get("/recordings/{recording_id}")
async def get_recording(recording_id: int, request: Request):
    """Get full detail of a recording."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        row = conn.execute(
            "SELECT * FROM meeting_recordings WHERE id = ?", (recording_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Recording not found")
    d = dict(row)
    d["action_items"] = json.loads(d.get("action_items") or "[]")
    return d


@router.delete("/recordings/{recording_id}")
async def delete_recording(recording_id: int, request: Request):
    """Delete a recording."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM meeting_recordings WHERE id = ?", (recording_id,))
    return {"deleted": recording_id}


@router.post("/transcribe")
async def transcribe_meeting(request: Request, audio: UploadFile = File(...)):
    """Transcribe audio via Whisper, extract action items and draft follow-up email."""
    from routers.config import load_app_config
    cfg = load_app_config()
    openai_key = cfg.get("openai_api_key", "").strip()
    if not openai_key:
        raise HTTPException(400, "OpenAI API key not configured — add it in Settings → App Settings")

    cache = request.app.state.cache

    content = await audio.read()
    if not content:
        raise HTTPException(400, "Empty audio file")

    # Determine file suffix from content type or filename
    suffix = ".webm"
    if audio.filename:
        ext = os.path.splitext(audio.filename)[1]
        if ext in (".mp3", ".mp4", ".m4a", ".wav", ".ogg", ".flac", ".webm"):
            suffix = ext

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        from openai import AsyncOpenAI
        oai = AsyncOpenAI(api_key=openai_key)

        # Transcribe with Whisper
        with open(tmp_path, "rb") as f:
            transcription = await oai.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="text",
            )
        transcript = str(transcription).strip()
        if not transcript:
            return {"transcript": "", "action_items": [], "draft_email": ""}

        # Extract action items and draft follow-up using existing AI
        advisor = request.app.state.advisor
        prompt = f"""You are an executive assistant. A meeting just ended.

MEETING TRANSCRIPT:
{transcript[:6000]}

Extract:
1. A JSON array of concise action items (strings under 120 chars each), max 10 items.
2. A professional follow-up email body (2–4 short paragraphs) summarising key decisions and listing action items.

Respond with valid JSON only, no markdown fences:
{{"action_items": ["...", "..."], "draft_email": "..."}}"""

        draft_email = ""
        action_items: list[str] = []
        try:
            ant = getattr(advisor.ai, "_anthropic", None)
            if ant:
                resp = await ant.messages.create(
                    model="claude-haiku-4-5-20251001", max_tokens=1200,
                    messages=[{"role": "user", "content": prompt}],
                )
                raw = resp.content[0].text.strip()
            else:
                resp = await advisor.ai.messages.create(
                    model="claude-haiku-4-5-20251001", max_tokens=1200,
                    messages=[{"role": "user", "content": prompt}],
                )
                raw = resp.content[0].text.strip()
            s, e = raw.find("{"), raw.rfind("}") + 1
            data = json.loads(raw[s:e]) if s >= 0 else {}
            action_items = data.get("action_items", [])
            draft_email = data.get("draft_email", "")
        except Exception:
            data = {}

        # Auto-save recording to DB
        try:
            auto_title = (transcript[:60].split('.')[0] + '…') if transcript else "Meeting"
            with cache._conn() as conn:
                conn.execute(
                    """INSERT INTO meeting_recordings (transcript, action_items, draft_email, title)
                       VALUES (?,?,?,?)""",
                    (transcript, json.dumps(action_items), draft_email, auto_title),
                )
        except Exception:
            pass

        return {
            "transcript": transcript,
            "action_items": action_items,
            "draft_email": draft_email,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Transcription failed: {exc}") from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
