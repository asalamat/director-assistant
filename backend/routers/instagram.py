"""Instagram posting endpoints — settings, AI caption/image generation, publish via Graph API, history."""

import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Request

from routers.config import load_app_config, save_app_config

router = APIRouter(prefix="/api/instagram", tags=["instagram"])

GRAPH_BASE = "https://graph.facebook.com/v19.0"


def _ensure_tables(cache):
    with cache._conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS instagram_history (
                id TEXT PRIMARY KEY,
                caption TEXT,
                hashtags TEXT DEFAULT '[]',
                image_url TEXT,
                content_type TEXT DEFAULT 'image+text',
                scheduled_at TEXT,
                published_at TEXT,
                ig_media_id TEXT,
                status TEXT DEFAULT 'draft',
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)


def _get_instagram_settings() -> dict:
    cfg = load_app_config()
    ig = cfg.get("instagram", {}) or {}
    return {
        "app_id": ig.get("app_id", ""),
        "app_secret": ig.get("app_secret", ""),
        "access_token": ig.get("access_token", ""),
        "ig_user_id": ig.get("ig_user_id", ""),
        "image_model": ig.get("image_model", "dall-e-3"),
        "username": ig.get("username", ""),
        "ftp_host": ig.get("ftp_host", ""),
        "ftp_user": ig.get("ftp_user", ""),
        "ftp_pass": ig.get("ftp_pass", ""),
        "ftp_path": ig.get("ftp_path", ""),
        "ftp_public_url": ig.get("ftp_public_url", ""),
    }


async def _upload_to_ftp(data_uri: str, settings: dict) -> str:
    """Upload a base64 data URI via FTP and return the public HTTP URL."""
    import base64
    import ftplib
    import io

    host = settings.get("ftp_host", "")
    user = settings.get("ftp_user", "")
    passwd = settings.get("ftp_pass", "")
    path = settings.get("ftp_path", "/").rstrip("/") + "/"
    public_url = settings.get("ftp_public_url", "").rstrip("/")

    if not (host and user and public_url):
        return ""

    if "," in data_uri:
        b64 = data_uri.split(",", 1)[1]
    else:
        b64 = data_uri

    img_bytes = base64.b64decode(b64)
    filename = f"{uuid.uuid4().hex}.png"

    def _ftp_upload():
        ftp = ftplib.FTP(host)
        ftp.login(user, passwd)
        ftp.storbinary(f"STOR {path}{filename}", io.BytesIO(img_bytes))
        ftp.quit()

    import asyncio
    await asyncio.to_thread(_ftp_upload)
    return f"{public_url}/{filename}"


def _get_openai_key() -> str:
    cfg = load_app_config()
    key = cfg.get("openai_api_key", "")
    if key:
        return key
    for p in cfg.get("ai_providers", []):
        if p.get("type") == "openai" and p.get("key"):
            return p["key"]
    return ""


async def _ai_complete(request: Request, prompt: str, max_tokens: int = 800, system: str = "") -> str:
    advisor = getattr(request.app.state, "advisor", None)
    if not advisor:
        raise RuntimeError("AI advisor not available")
    messages = [{"role": "user", "content": prompt}]
    ant = getattr(advisor.ai, "_anthropic", None)
    kwargs: dict = {"model": "claude-haiku-4-5-20251001", "max_tokens": max_tokens, "messages": messages}
    if system:
        kwargs["system"] = system
    if ant:
        resp = await ant.messages.create(**kwargs)
    else:
        resp = await advisor.ai.messages.create(**kwargs)
    return resp.content[0].text.strip()


@router.get("/settings")
async def get_settings(request: Request):
    return _get_instagram_settings()


@router.post("/settings")
async def save_settings(body: dict, request: Request):
    cfg = load_app_config()
    ig = cfg.get("instagram", {}) or {}
    for key in ("app_id", "app_secret", "access_token", "ig_user_id", "image_model", "username",
                "ftp_host", "ftp_user", "ftp_pass", "ftp_path", "ftp_public_url"):
        if key in body and body[key] is not None:
            ig[key] = body[key]
    cfg["instagram"] = ig
    save_app_config(cfg)
    return {"status": "saved"}


@router.post("/generate-caption")
async def generate_caption(body: dict, request: Request):
    topic = (body.get("topic") or "").strip()
    tone = (body.get("tone") or "Engaging").strip()
    hashtag_count = int(body.get("hashtag_count") or 8)
    if not topic:
        return {"caption": "", "hashtags": [], "error": "topic is required"}

    caption_system = (
        "You are an Instagram caption writer. "
        "Output ONLY the caption text — nothing else. "
        "No JSON, no code blocks, no labels, no hashtags in the body."
    )
    caption_prompt = (
        f"Write an engaging Instagram caption about: {topic}.\n"
        f"Tone: {tone}. Use line breaks and emojis where natural. "
        "Do NOT include hashtags in the caption body. "
        "Output ONLY the caption text — start immediately."
    )
    try:
        caption = (await _ai_complete(request, caption_prompt, max_tokens=600, system=caption_system)).strip()
    except Exception as e:
        return {"caption": "", "hashtags": [], "error": str(e)}

    hashtag_system = "Return ONLY a comma-separated list of hashtag words without the # symbol. No JSON. No other text."
    hashtag_prompt = (
        f"Give {hashtag_count} Instagram hashtags for a post about: {topic}. "
        "Return ONLY comma-separated words."
    )
    hashtags: list[str] = []
    try:
        ht_raw = await _ai_complete(request, hashtag_prompt, max_tokens=120, system=hashtag_system)
        hashtags = [h.strip().lstrip("#") for h in ht_raw.split(",") if h.strip() and len(h.strip()) < 35][:hashtag_count]
    except Exception:
        pass

    return {"caption": caption, "hashtags": hashtags}


@router.post("/generate-image")
async def generate_image(body: dict, request: Request):
    topic = (body.get("topic") or "").strip()
    caption = (body.get("caption") or "").strip()
    custom_prompt = body.get("custom_prompt")

    openai_key = _get_openai_key()
    if not openai_key:
        return {"url": "", "prompt": "", "error": "OpenAI API key not configured — add it in Settings → AI Providers (type: openai)"}
    if not openai_key.startswith("sk-"):
        return {"url": "", "prompt": "", "error": f"OpenAI key looks invalid (should start with 'sk-'). Current key starts with: {openai_key[:8]}…"}

    base = custom_prompt.strip() if custom_prompt else ""
    summary = caption[:600] if caption else topic

    if base:
        topic_line = f"Topic: {topic}." if topic else ""
        summary_line = f" Context: {summary[:300]}" if summary else ""
        full_prompt = f"{base}. {topic_line}{summary_line}".strip(". ").strip()
    else:
        img_system = "Return ONLY the image prompt text — no JSON, no labels, no extra text."
        img_prompt = (
            "Write ONE detailed DALL-E image prompt for a square Instagram post.\n\n"
            f"POST TOPIC: {topic}\n"
            f"CAPTION (use this for the visual theme):\n{summary}\n\n"
            "The prompt must:\n"
            "- Visually represent the core message\n"
            "- Be vibrant and Instagram-appropriate\n"
            "- Include composition, lighting, color tone, and mood\n"
            "Return ONLY the prompt text — nothing else."
        )
        try:
            full_prompt = (await _ai_complete(request, img_prompt, max_tokens=300, system=img_system)).strip().strip('"').strip("'")
        except Exception as e:
            return {"url": "", "prompt": "", "error": f"AI prompt generation failed: {e}"}
        if not full_prompt:
            return {"url": "", "prompt": "", "error": "Could not generate image prompt"}

    _IMAGE_MODELS = ("dall-e-3", "gpt-image-1", "gpt-5.5", "dall-e-2")
    _SKIP = ("does not exist", "not supported", "not available", "no access", "model_not_found")

    preferred = _get_instagram_settings().get("image_model", "dall-e-3") or "dall-e-3"
    fallback_list = [preferred] + [m for m in _IMAGE_MODELS if m != preferred]
    headers = {"Authorization": f"Bearer {openai_key}", "Content-Type": "application/json"}

    last_error = ""
    result_url = ""
    async with httpx.AsyncClient(timeout=120.0) as client:
        for mdl in fallback_list:
            payload: dict = {"model": mdl, "prompt": full_prompt[:4000], "n": 1, "size": "1024x1024"}
            try:
                r = await client.post("https://api.openai.com/v1/images/generations", headers=headers, json=payload)
            except Exception as e:
                last_error = f"Request failed: {e}"
                break
            if r.status_code == 200:
                item = r.json().get("data", [{}])[0]
                result_url = item.get("url") or (f"data:image/png;base64,{item['b64_json']}" if item.get("b64_json") else "")
                if result_url:
                    # Auto-upload data URIs via FTP so Instagram Graph API gets a public URL
                    if result_url.startswith("data:"):
                        ig_settings = _get_instagram_settings()
                        if ig_settings.get("ftp_host"):
                            try:
                                ftp_url = await _upload_to_ftp(result_url, ig_settings)
                                if ftp_url:
                                    result_url = ftp_url
                            except Exception:
                                pass  # leave as data URI; publish will show the helpful error
                    return {"url": result_url, "prompt": full_prompt, "model_used": mdl}
                last_error = f"{mdl} returned no image data"
                break
            eb = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            last_error = eb.get("error", {}).get("message", r.text[:300])
            if not any(p in last_error.lower() for p in _SKIP):
                break  # real error, not a model-access issue

    return {"url": "", "prompt": full_prompt, "error": last_error or "Image generation failed"}


async def _publish_to_instagram(settings: dict, image_url: str, full_caption: str) -> dict:
    access_token = settings.get("access_token", "")
    ig_user_id = settings.get("ig_user_id", "")
    if not access_token:
        return {"error": "Instagram access token not configured — go to Settings → Instagram"}
    if not ig_user_id:
        return {"error": "Instagram User ID not configured — go to Settings → Instagram"}
    if not image_url or image_url.startswith("data:"):
        return {"error": "Instagram requires a public image URL (data URIs are not supported by the Graph API)"}

    async with httpx.AsyncClient(timeout=60.0) as http:
        container = await http.post(
            f"{GRAPH_BASE}/{ig_user_id}/media",
            data={"image_url": image_url, "caption": full_caption, "access_token": access_token},
        )
        if container.status_code >= 400:
            return {"error": f"Container creation failed {container.status_code}: {container.text[:300]}"}
        creation_id = (container.json() or {}).get("id", "")
        if not creation_id:
            return {"error": "Instagram did not return a creation_id"}

        publish = await http.post(
            f"{GRAPH_BASE}/{ig_user_id}/media_publish",
            data={"creation_id": creation_id, "access_token": access_token},
        )
        if publish.status_code >= 400:
            return {"error": f"Publish failed {publish.status_code}: {publish.text[:300]}"}
        ig_media_id = (publish.json() or {}).get("id", "")

    return {"ig_media_id": ig_media_id}


@router.post("/publish")
async def publish(body: dict, request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    post_id = body.get("id") or str(uuid.uuid4())
    caption = body.get("caption") or ""
    hashtags = body.get("hashtags") or []
    image_url = body.get("image_url") or ""
    content_type = body.get("content_type", "image+text")
    scheduled_at = body.get("scheduled_at")

    import json
    hashtags_json = json.dumps(hashtags)

    with cache._conn() as conn:
        exists = conn.execute("SELECT 1 FROM instagram_history WHERE id=?", (post_id,)).fetchone()
        if not exists:
            conn.execute(
                """INSERT INTO instagram_history
                   (id, caption, hashtags, image_url, content_type, status)
                   VALUES (?, ?, ?, ?, ?, 'pending')""",
                (post_id, caption, hashtags_json, image_url, content_type),
            )

    if scheduled_at:
        try:
            sched_dt = datetime.fromisoformat(str(scheduled_at).replace("Z", "+00:00"))
            if sched_dt.tzinfo is None:
                sched_dt = sched_dt.replace(tzinfo=timezone.utc)
            is_future = sched_dt > datetime.now(timezone.utc)
        except Exception:
            is_future = True
        if is_future:
            with cache._conn() as conn:
                conn.execute(
                    "UPDATE instagram_history SET status='scheduled', scheduled_at=? WHERE id=?",
                    (scheduled_at, post_id),
                )
            return {"status": "scheduled", "scheduled_for": scheduled_at}

    hashtag_line = " ".join(h if h.startswith("#") else f"#{h}" for h in hashtags)
    full_caption = (caption + ("\n\n" + hashtag_line if hashtag_line else "")) if content_type != "image" else hashtag_line

    settings = _get_instagram_settings()
    result = await _publish_to_instagram(settings, image_url, full_caption)
    if "error" in result:
        with cache._conn() as conn:
            conn.execute("UPDATE instagram_history SET status='failed' WHERE id=?", (post_id,))
        return {"error": result["error"]}

    ig_media_id = result.get("ig_media_id", "")
    with cache._conn() as conn:
        conn.execute(
            """UPDATE instagram_history
               SET status='published', published_at=datetime('now'), ig_media_id=?,
                   image_url=COALESCE(NULLIF(?, ''), image_url)
               WHERE id=?""",
            (ig_media_id, image_url, post_id),
        )
    return {"status": "published", "ig_media_id": ig_media_id}


@router.get("/history")
async def get_history(request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT * FROM instagram_history ORDER BY created_at DESC LIMIT 50"
        ).fetchall()
    return {"posts": [dict(r) for r in rows]}


@router.delete("/history/{post_id}")
async def delete_history(post_id: str, request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        conn.execute("DELETE FROM instagram_history WHERE id=?", (post_id,))
    return {"status": "deleted"}


@router.post("/verify")
async def verify_instagram(request: Request):
    """Verify Instagram access token by fetching the IG business account profile."""
    settings = _get_instagram_settings()
    access_token = settings.get("access_token", "")
    ig_user_id = settings.get("ig_user_id", "")
    if not access_token:
        return {"instagram": {"ok": False, "message": "No access token configured"}}
    if not ig_user_id:
        return {"instagram": {"ok": False, "message": "No Instagram User ID configured"}}
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            r = await http.get(
                f"{GRAPH_BASE}/{ig_user_id}",
                params={"fields": "id,username", "access_token": access_token},
            )
        if r.status_code == 200:
            data = r.json()
            username = data.get("username", "")
            return {"instagram": {"ok": True, "message": f"Connected as @{username}" if username else "Connected"}}
        eb = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        msg = eb.get("error", {}).get("message", r.text[:200])
        return {"instagram": {"ok": False, "message": f"HTTP {r.status_code}: {msg}"}}
    except Exception as e:
        return {"instagram": {"ok": False, "message": str(e)}}


@router.post("/verify-ftp")
async def verify_ftp(request: Request):
    """Test FTP connection and write/delete a probe file."""
    import ftplib
    import asyncio

    s = _get_instagram_settings()
    host = s.get("ftp_host", "")
    user = s.get("ftp_user", "")
    passwd = s.get("ftp_pass", "")
    path = (s.get("ftp_path", "/") or "/").rstrip("/") + "/"
    public_url = (s.get("ftp_public_url", "") or "").rstrip("/")

    if not host:
        return {"ok": False, "message": "FTP host not configured"}
    if not user:
        return {"ok": False, "message": "FTP username not configured"}
    if not public_url:
        return {"ok": False, "message": "Public URL base not configured"}

    probe = f"da_probe_{uuid.uuid4().hex[:8]}.txt"

    def _test():
        ftp = ftplib.FTP()
        ftp.connect(host, timeout=10)
        ftp.login(user, passwd)
        import io
        ftp.storbinary(f"STOR {path}{probe}", io.BytesIO(b"ok"))
        ftp.delete(f"{path}{probe}")
        ftp.quit()

    try:
        await asyncio.to_thread(_test)
        return {"ok": True, "message": f"FTP connected. Files will be served at {public_url}/"}
    except ftplib.all_errors as e:
        return {"ok": False, "message": f"FTP error: {e}"}
    except Exception as e:
        return {"ok": False, "message": str(e)}
