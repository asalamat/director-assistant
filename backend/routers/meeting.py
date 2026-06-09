"""Meeting intelligence — audio transcription and action extraction."""

import json
import os
import tempfile
from fastapi import APIRouter, HTTPException, Request, UploadFile, File

router = APIRouter(prefix="/api/meeting", tags=["meeting"])


@router.post("/transcribe")
async def transcribe_meeting(request: Request, audio: UploadFile = File(...)):
    """Transcribe audio via Whisper, extract action items and draft follow-up email."""
    from routers.config import load_app_config
    cfg = load_app_config()
    openai_key = cfg.get("openai_api_key", "").strip()
    if not openai_key:
        raise HTTPException(400, "OpenAI API key not configured — add it in Settings → App Settings")

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
        except Exception:
            data = {}

        return {
            "transcript": transcript,
            "action_items": data.get("action_items", []),
            "draft_email": data.get("draft_email", ""),
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
