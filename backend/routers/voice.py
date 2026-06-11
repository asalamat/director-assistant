"""Text-to-speech via ElevenLabs API."""

import re as _re

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/voice", tags=["voice"])


@router.post("/read/{email_id}")
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
                json={"text": text[:2500], "model_id": "eleven_monolingual_v1",
                      "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}},
            ) as resp:
                if resp.status_code != 200:
                    body_text = await resp.aread()
                    raise HTTPException(resp.status_code, body_text.decode()[:200])
                async for chunk in resp.aiter_bytes(4096):
                    yield chunk

    return StreamingResponse(generate(), media_type="audio/mpeg")
