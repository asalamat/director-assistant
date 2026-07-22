"""Voice: text-to-speech via ElevenLabs, speech-to-text via Whisper."""

import contextlib
import os
import re as _re
import tempfile

import httpx
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/voice", tags=["voice"])

MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024  # 25 MB
ALLOWED_AUDIO_TYPES = {
    "audio/webm", "audio/mp4", "audio/wav", "audio/x-wav",
    "audio/ogg", "audio/mpeg", "audio/mp3",
}


@router.get("/read/{email_id}")
async def read_email(email_id: str, request: Request):
    """Stream email body as audio via ElevenLabs TTS."""
    from routers.config import load_app_config
    cfg = load_app_config()
    api_key = cfg.get("elevenlabs_api_key", "").strip()
    if not api_key:
        raise HTTPException(400, "ElevenLabs API key not configured — add it in Settings → App Settings")

    cache = request.app.state.cache
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    body = (email.body or "")[:3000]
    body = _re.sub(r'<[^>]+>', ' ', body)
    body = _re.sub(r'\s+', ' ', body).strip()
    text = f"{email.subject or 'No subject'}. {body}" if body else (email.subject or "No content")

    voice_id = cfg.get("elevenlabs_voice_id", "21m00Tcm4TlvDq8ikWAM")  # default: Rachel

    async def generate():
        async with httpx.AsyncClient(timeout=30) as c:
            async with c.stream(
                "POST",
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json={"text": text[:2500], "model_id": "eleven_turbo_v2_5",
                      "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}},
            ) as resp:
                if resp.status_code != 200:
                    body_text = await resp.aread()
                    raise HTTPException(resp.status_code, body_text.decode()[:200])
                async for chunk in resp.aiter_bytes(4096):
                    yield chunk

    return StreamingResponse(generate(), media_type="audio/mpeg")


@router.post("/transcribe")
async def transcribe_dictation(request: Request, audio: UploadFile = File(...)):
    """Transcribe dictated audio via Whisper, then clean it up via the LLM for compose insertion."""
    from routers.config import load_app_config
    cfg = load_app_config()
    openai_key = cfg.get("openai_api_key", "").strip()
    if not openai_key:
        raise HTTPException(400, "OpenAI API key not configured — add it in Settings → App Settings")

    if audio.content_type and audio.content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(415, f"Unsupported audio type: {audio.content_type}")

    content = await audio.read()
    if not content:
        raise HTTPException(400, "Empty audio file")
    if len(content) > MAX_TRANSCRIBE_BYTES:
        raise HTTPException(413, "Audio too large (max 25 MB)")

    suffix = ".webm"
    if audio.filename:
        ext = os.path.splitext(audio.filename)[1]
        if ext in (".webm", ".mp4", ".m4a", ".wav", ".ogg", ".mp3"):
            suffix = ext

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        from openai import AsyncOpenAI
        oai = AsyncOpenAI(api_key=openai_key)
        with open(tmp_path, "rb") as f:
            result = await oai.audio.transcriptions.create(
                model="whisper-1", file=f, response_format="text",
            )
        transcript = str(result).strip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Transcription failed: {exc}") from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            with contextlib.suppress(Exception):
                os.unlink(tmp_path)

    if not transcript:
        return {"transcript": "", "cleaned": "", "duration_hint": ""}

    cleaned = transcript
    try:
        advisor = request.app.state.advisor
        prompt = (
            "Clean up this dictated text: remove filler words (um, uh, like), "
            "fix punctuation, fix capitalization. Return only the cleaned text, "
            "no commentary.\n\n" + transcript[:6000]
        )
        ant = getattr(advisor.ai, "_anthropic", None)
        client = ant or advisor.ai
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        out = resp.content[0].text.strip()
        if out:
            cleaned = out
    except Exception:
        cleaned = transcript

    words = len(transcript.split())
    duration_hint = f"~{max(1, round(words / 130))} min" if words else ""
    return {"transcript": transcript, "cleaned": cleaned, "duration_hint": duration_hint}
