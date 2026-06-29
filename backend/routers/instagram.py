"""Instagram posting endpoints — settings, AI caption/image generation, publish via Graph API, history."""

import json
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Request

from routers.config import load_app_config, save_app_config

router = APIRouter(prefix="/api/instagram", tags=["instagram"])

GRAPH_BASE = "https://graph.facebook.com/v21.0"
IG_GRAPH_BASE = "https://graph.instagram.com/v21.0"

IG_BUILTIN_TEMPLATES = [
    {
        "id": "ig-builtin-motivational",
        "name": "Motivational", "icon": "🌟", "tone": "Inspiring",
        "prompt": "Write a short motivational Instagram caption. Start with a powerful quote or statement. Use 2-3 lines max. Add relevant emojis. No hashtags in body.",
        "sample_image": "", "builtin": 1,
    },
    {
        "id": "ig-builtin-behind-scenes",
        "name": "Behind the Scenes", "icon": "🎬", "tone": "Behind-the-scenes",
        "prompt": "Write a casual, authentic behind-the-scenes caption. First-person voice, warm and personal. Share a process, struggle, or real moment. Conversational tone with emojis.",
        "sample_image": "", "builtin": 1,
    },
    {
        "id": "ig-builtin-product",
        "name": "Product Spotlight", "icon": "🛍", "tone": "Promotional",
        "prompt": "Write a product spotlight caption. Lead with the top benefit, add 1-2 supporting points, end with a soft call-to-action. Enthusiastic but not salesy.",
        "sample_image": "", "builtin": 1,
    },
    {
        "id": "ig-builtin-educational",
        "name": "Educational Tip", "icon": "📚", "tone": "Educational",
        "prompt": "Write an educational tip caption. Use a numbered or bullet-point structure (3-5 tips max). Start with a hook. Value-first, no fluff. End with a question to drive engagement.",
        "sample_image": "", "builtin": 1,
    },
    {
        "id": "ig-builtin-personal",
        "name": "Personal Story", "icon": "💬", "tone": "Personal",
        "prompt": "Write a personal story caption. First-person, vulnerable and authentic. Share a lesson learned or turning point. 3-4 short paragraphs. Relatable and emotionally engaging.",
        "sample_image": "", "builtin": 1,
    },
    {
        "id": "ig-builtin-community",
        "name": "Community Question", "icon": "🙋", "tone": "Inspiring",
        "prompt": "Write a community engagement caption. Share a quick take or observation, then end with a direct question to the audience. Keep it short (2-3 lines). Friendly and inclusive tone.",
        "sample_image": "", "builtin": 1,
    },
]


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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS instagram_templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                icon TEXT DEFAULT '📸',
                tone TEXT DEFAULT 'Inspiring',
                prompt TEXT NOT NULL,
                sample_image TEXT DEFAULT '',
                builtin INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS instagram_autopilot (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topics TEXT DEFAULT '[]',
                tone TEXT DEFAULT 'Inspiring',
                hashtag_count INTEGER DEFAULT 15,
                content_type TEXT DEFAULT 'image+text',
                interval_days INTEGER DEFAULT 3,
                post_time TEXT DEFAULT '09:00',
                enabled INTEGER DEFAULT 1,
                topic_index INTEGER DEFAULT 0,
                last_post_at TEXT,
                next_post_at TEXT
            )
        """)


def _get_instagram_settings() -> dict:
    cfg = load_app_config()
    ig = cfg.get("instagram", {}) or {}
    raw_key = ig.get("openai_key", "")
    return {
        "app_id": ig.get("app_id", ""),
        "app_secret": ig.get("app_secret", ""),
        "ig_login_app_id": ig.get("ig_login_app_id", ""),
        "ig_login_app_secret": ig.get("ig_login_app_secret", ""),
        "access_token": ig.get("access_token", ""),
        "ig_user_id": ig.get("ig_user_id", ""),
        "image_model": ig.get("image_model", "dall-e-3"),
        "username": ig.get("username", ""),
        "ftp_host": ig.get("ftp_host", ""),
        "ftp_user": ig.get("ftp_user", ""),
        "ftp_pass": ig.get("ftp_pass", ""),
        "ftp_path": ig.get("ftp_path", ""),
        "ftp_public_url": ig.get("ftp_public_url", ""),
        "openai_key_preview": (raw_key[:8] + "…") if raw_key else "",
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
    if not public_url.startswith("http://") and not public_url.startswith("https://"):
        public_url = "https://" + public_url

    if "," in data_uri:
        b64 = data_uri.split(",", 1)[1]
    else:
        b64 = data_uri

    img_bytes = base64.b64decode(b64)
    filename = f"{uuid.uuid4().hex}.png"

    def _ftp_upload():
        ftp = ftplib.FTP(host)
        ftp.login(user, passwd)
        if path and path != "/":
            ftp.cwd(path.rstrip("/"))
        ftp.storbinary(f"STOR {filename}", io.BytesIO(img_bytes))
        ftp.quit()

    import asyncio
    await asyncio.to_thread(_ftp_upload)
    return f"{public_url}/{filename}"


def _add_text_overlay_sync(img_bytes: bytes, text: str) -> bytes:
    """Burn a short message into the bottom of the image with a gradient bar. Returns JPEG bytes."""
    import io, os, textwrap
    from PIL import Image, ImageDraw, ImageFont

    img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
    W, H = img.size

    short = len(text) < 60
    font_size = max(36, W // 20) if short else max(26, W // 30)
    font = None
    for fp in [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()

    def text_width(t: str) -> int:
        try:
            bbox = font.getbbox(t)
            return bbox[2] - bbox[0]
        except Exception:
            return len(t) * font_size // 2

    wrap_w = 28 if short else 40
    lines = textwrap.wrap(text[:200], width=wrap_w)[:3]
    line_h = int(font_size * 1.4)
    pad = 24
    overlay_h = len(lines) * line_h + pad * 2

    # Gradient: transparent → opaque-black
    gradient = Image.new("RGBA", (W, overlay_h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gradient)
    for i in range(overlay_h):
        alpha = int(210 * (i / overlay_h))
        gd.line([(0, i), (W, i)], fill=(0, 0, 0, alpha))
    img.alpha_composite(gradient, (0, H - overlay_h))

    draw = ImageDraw.Draw(img)
    y = H - overlay_h + pad
    for line in lines:
        tw = text_width(line)
        x = max(10, (W - tw) // 2)
        # Drop shadow
        draw.text((x + 2, y + 2), line, fill=(0, 0, 0, 200), font=font)
        # White text
        draw.text((x, y), line, fill=(255, 255, 255, 255), font=font)
        y += line_h

    out = io.BytesIO()
    img.convert("RGB").save(out, format="JPEG", quality=93)
    return out.getvalue()


@router.post("/apply-overlay")
async def apply_overlay(body: dict, request: Request):
    """Burn overlay_text onto an existing image_url. Returns {url} with data URI."""
    import base64 as _b64, asyncio as _aio
    overlay_text = (body.get("overlay_text") or "").strip()
    image_url = (body.get("image_url") or "").strip()
    if not overlay_text:
        return {"error": "overlay_text is required"}
    if not image_url:
        return {"error": "image_url is required"}
    try:
        if image_url.startswith("data:"):
            img_bytes = _b64.b64decode(image_url.split(",", 1)[1])
        else:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.get(image_url)
                r.raise_for_status()
                img_bytes = r.content
        modified = await _aio.to_thread(_add_text_overlay_sync, img_bytes, overlay_text)
        result_url = "data:image/jpeg;base64," + _b64.b64encode(modified).decode()
        # Try FTP upload if configured
        ig_settings = _get_instagram_settings()
        if ig_settings.get("ftp_host"):
            try:
                ftp_url = await _upload_to_ftp(result_url, ig_settings)
                if ftp_url:
                    result_url = ftp_url
            except Exception:
                pass
        return {"url": result_url}
    except Exception as e:
        return {"error": str(e)}


_BILLING_KW = ("billing hard limit", "insufficient_quota", "you exceeded", "credit balance", "quota exceeded", "rate limit", "billing limit")

def _billing_msg(raw: str, provider: str, fix_url: str) -> str:
    """Wrap a raw API error with a clear provider label when it's a billing/quota issue."""
    if any(k in raw.lower() for k in _BILLING_KW):
        return (
            f"{provider} billing/quota limit reached.\n"
            f"⚠️ This is an ACCOUNT-level limit — changing your API key will not fix it.\n"
            f"→ Fix at: {fix_url}\n"
            f"   (raise your spending limit or add credits to your account)\n"
            f"Raw error: {raw}"
        )
    return raw


def _get_openai_key() -> str:
    cfg = load_app_config()
    # 1. Dedicated Instagram OpenAI key (set directly in Instagram settings — most specific)
    ig_key = cfg.get("instagram", {}).get("openai_key", "")
    if ig_key:
        return ig_key
    # 2. Active AI providers list
    for p in cfg.get("ai_providers", []):
        if p.get("type") == "openai" and p.get("key"):
            return p["key"]
    # 3. Legacy top-level field
    return cfg.get("openai_api_key", "")


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
    for key in ("app_id", "app_secret", "ig_login_app_id", "ig_login_app_secret",
                "access_token", "ig_user_id", "image_model", "username",
                "ftp_host", "ftp_user", "ftp_pass", "ftp_path", "ftp_public_url",
                "openai_key"):
        if key in body and body[key] is not None:
            ig[key] = body[key]
    cfg["instagram"] = ig
    save_app_config(cfg)
    return {"status": "saved"}


@router.post("/search-news")
async def search_news(body: dict):
    query = (body.get("query") or "").strip()
    if not query:
        return {"results": [], "context": "", "error": "query required"}
    try:
        from ddgs import DDGS
        results = []
        with DDGS() as ddgs:
            items = list(ddgs.news(query, max_results=6))
            if not items:
                items = [
                    {"title": r.get("title", ""), "body": r.get("body", ""), "url": r.get("href", ""), "date": "", "source": ""}
                    for r in ddgs.text(query, max_results=6)
                ]
        for item in items[:6]:
            results.append({
                "title": item.get("title", ""),
                "snippet": (item.get("body") or "")[:300],
                "url": item.get("url", "") or item.get("href", ""),
                "date": (item.get("date", "") or "")[:10],
                "source": item.get("source", ""),
            })
        context = "\n\n".join(
            f"• {r['title']} ({r['date'] or 'recent'}): {r['snippet']}"
            for r in results if r["title"]
        )
        return {"results": results, "context": context}
    except Exception as e:
        return {"results": [], "context": "", "error": str(e)}


_OPENING_STYLES = [
    "Start with a bold, direct statement of fact or urgency.",
    "Open with a rhetorical question that makes the reader stop and think.",
    "Begin with a short, punchy single sentence (5 words max), then expand.",
    "Lead with a specific name, place, or date to ground the reader immediately.",
    "Start with a call to action — invite the reader to do something first.",
    "Open with an unexpected or surprising contrast (e.g. 'While the world watches…').",
    "Begin with raw, first-person emotion — write as if speaking directly from the heart.",
    "Start with a statistic or number that makes the scale real.",
    "Open with a brief scene or moment the reader can picture.",
    "Lead with a short quote or paraphrase of something said by someone affected.",
]


@router.post("/generate-caption")
async def generate_caption(body: dict, request: Request):
    import random
    topic = (body.get("topic") or "").strip()
    tone = (body.get("tone") or "Engaging").strip()
    hashtag_count = int(body.get("hashtag_count") or 8)
    template_prompt = (body.get("template_prompt") or "").strip()
    search_context = (body.get("search_context") or "").strip()
    if not topic:
        return {"caption": "", "hashtags": [], "error": "topic is required"}

    opening_style = random.choice(_OPENING_STYLES)

    caption_system = (
        "You are a creative Instagram caption writer. Every caption you write must be UNIQUE and DIFFERENT "
        "from any previous version — vary the structure, opening, and phrasing every time. "
        "Output ONLY the caption text — nothing else. "
        "No JSON, no code blocks, no labels, no hashtags in the body."
    )
    news_block = (
        f"\n\nIncorporate these real news facts into the caption:\n{search_context[:1500]}"
        if search_context else ""
    )
    variation_line = f"\nOpening style this time: {opening_style}"
    if template_prompt:
        caption_prompt = (
            f"{template_prompt}\n"
            f"Topic: {topic}.{news_block}{variation_line}\n"
            f"Tone: {tone}. Use line breaks and emojis where natural. "
            "Do NOT include hashtags. Output ONLY the caption text — start immediately."
        )
    else:
        caption_prompt = (
            f"Write an Instagram caption about: {topic}.{news_block}{variation_line}\n"
            f"Tone: {tone}. Use line breaks and emojis where natural. "
            "Do NOT include hashtags in the caption body. "
            "Output ONLY the caption text — start immediately."
        )
    try:
        caption = (await _ai_complete(request, caption_prompt, max_tokens=600, system=caption_system)).strip()
    except Exception as e:
        msg = _billing_msg(str(e), "Anthropic (Claude)", "console.anthropic.com/settings/billing")
        return {"caption": "", "hashtags": [], "error": msg}

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
    add_text_overlay = bool(body.get("add_text_overlay", False))
    overlay_text = (body.get("overlay_text") or "").strip()

    openai_key = _get_openai_key()
    if not openai_key:
        return {"url": "", "prompt": "", "error": "OpenAI API key not configured — add it in Settings → AI Providers (type: openai)"}
    if not openai_key.startswith("sk-"):
        return {"url": "", "prompt": "", "error": f"OpenAI key looks invalid (should start with 'sk-'). Current key starts with: {openai_key[:8]}…"}

    base = custom_prompt.strip() if custom_prompt else ""
    full_caption = caption or topic
    template_visual = (body.get("template_prompt") or "").strip()

    if base:
        # User supplied a custom style prompt — honour it, add caption + template for context
        topic_line = f"Topic: {topic}." if topic else ""
        caption_line = f" Caption context: {full_caption[:400]}" if full_caption else ""
        template_block = f" Visual style: {template_visual}." if template_visual else ""
        full_prompt = f"{base}.{template_block} {topic_line}{caption_line}".strip(". ").strip()

    elif full_caption:
        # Build the DALL-E prompt DIRECTLY from the caption — no Claude middleman.
        # Claude distils captions into generic imagery; DALL-E reads the raw text better.
        scene_hint = (
            "Photorealistic, cinematic, high-detail scene. "
            "Render a visual image that faithfully represents the following post:\n\n"
        )
        # Inject template's visual instructions (e.g. "use lion and sun flag") so they
        # appear in the image, not just in the caption.
        template_block = (
            f"\n\nMandatory visual elements from style template (MUST appear in the image):\n{template_visual}"
            if template_visual else ""
        )
        style_hint = (
            "\n\nVisual style requirements:\n"
            "- Match the emotional tone EXACTLY (somber/dark if the text is serious, joyful if celebratory)\n"
            "- Include specific objects, people, settings, symbols mentioned in the text\n"
            "- Include text elements naturally where appropriate: inscriptions on monuments, protest signs, banners, written slogans\n"
            "- Cinematic composition, square format (1:1), dramatic lighting\n"
            "- NO generic stock-photo aesthetics — render what the text actually describes"
        )
        full_prompt = scene_hint + full_caption[:2800] + template_block + style_hint

    else:
        # No caption — use Claude to generate a prompt from the topic
        img_system = "Return ONLY the image prompt text — no JSON, no labels, no extra text."
        img_prompt = (
            f"Write a detailed, cinematic DALL-E image prompt for an Instagram post about: {topic}.\n"
            "Square format (1:1). Include composition, lighting, mood, and specific visual elements."
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
                    import base64 as _b64
                    import asyncio as _aio
                    ig_settings = _get_instagram_settings()

                    # Apply text overlay if requested — use overlay_text (short message) over full caption
                    msg_to_burn = overlay_text or caption
                    if add_text_overlay and msg_to_burn:
                        try:
                            if result_url.startswith("data:"):
                                img_bytes = _b64.b64decode(result_url.split(",", 1)[1])
                            else:
                                dl = await client.get(result_url, timeout=30.0)
                                img_bytes = dl.content
                            modified = await _aio.to_thread(_add_text_overlay_sync, img_bytes, msg_to_burn)
                            result_url = "data:image/jpeg;base64," + _b64.b64encode(modified).decode()
                        except Exception:
                            pass  # keep original on overlay failure

                    # Upload data URIs to FTP for a public URL
                    if result_url.startswith("data:") and ig_settings.get("ftp_host"):
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
            raw_err = eb.get("error", {}).get("message", r.text[:300])
            last_error = _billing_msg(raw_err, f"OpenAI ({mdl})", "platform.openai.com/account/billing")
            if not any(p in last_error.lower() for p in _SKIP):
                break  # real error, not a model-access issue

    return {"url": "", "prompt": full_prompt, "error": last_error or "Image generation failed"}


@router.post("/test-image-key")
async def test_image_key(body: dict):
    """Quick smoke-test of the OpenAI key for image generation. Tries each model and reports which work."""
    key = (body.get("key") or "").strip() or _get_openai_key()
    if not key:
        return {"ok": False, "error": "No OpenAI key configured"}
    results = []
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = json.dumps({"model": "dall-e-3", "prompt": "A plain white square", "n": 1, "size": "1024x1024"}).encode()
    async with httpx.AsyncClient(timeout=60.0) as client:
        for mdl in ("dall-e-3", "gpt-image-1", "gpt-image-1-mini"):
            pl = json.dumps({"model": mdl, "prompt": "A plain white square", "n": 1, "size": "1024x1024"}).encode()
            try:
                r = await client.post("https://api.openai.com/v1/images/generations",
                                      headers=headers, content=pl)
                if r.status_code == 200:
                    results.append({"model": mdl, "ok": True})
                else:
                    eb = r.json() if "application/json" in r.headers.get("content-type", "") else {}
                    raw = eb.get("error", {}).get("message", r.text[:200])
                    results.append({"model": mdl, "ok": False,
                                    "error": _billing_msg(raw, f"OpenAI ({mdl})", "platform.openai.com/account/billing")})
            except Exception as e:
                results.append({"model": mdl, "ok": False, "error": str(e)})
    working = [r for r in results if r["ok"]]
    return {
        "ok": bool(working),
        "working_models": [r["model"] for r in working],
        "results": results,
        "key_prefix": key[:12] + "…",
    }


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
        # Try graph.instagram.com first (required for Instagram business login tokens),
        # fall back to graph.facebook.com (Facebook login tokens)
        for base in (IG_GRAPH_BASE, GRAPH_BASE):
            container = await http.post(
                f"{base}/{ig_user_id}/media",
                data={"image_url": image_url, "caption": full_caption, "access_token": access_token},
            )
            if container.status_code == 400:
                err = (container.json() or {}).get("error", {})
                # If it's a host mismatch error, try the other base
                if err.get("code") in (10, 100) and base == IG_GRAPH_BASE:
                    continue
            if container.status_code >= 400:
                return {"error": f"Container creation failed {container.status_code}: {container.text[:300]}"}
            creation_id = (container.json() or {}).get("id", "")
            if not creation_id:
                return {"error": "Instagram did not return a creation_id"}

            # Poll container status until FINISHED (Instagram processes the image asynchronously)
            import asyncio
            for _ in range(15):
                status_r = await http.get(f"{base}/{creation_id}",
                    params={"fields": "status_code", "access_token": access_token})
                status_code = (status_r.json() or {}).get("status_code", "")
                if status_code == "FINISHED":
                    break
                if status_code == "ERROR":
                    return {"error": "Instagram rejected the image during processing"}
                if status_code == "EXPIRED":
                    return {"error": "Media container expired before publishing"}
                await asyncio.sleep(2)

            publish = await http.post(
                f"{base}/{ig_user_id}/media_publish",
                data={"creation_id": creation_id, "access_token": access_token},
            )
            if publish.status_code >= 400:
                return {"error": f"Publish failed {publish.status_code}: {publish.text[:300]}"}
            ig_media_id = (publish.json() or {}).get("id", "")
            return {"ig_media_id": ig_media_id}

    return {"error": "Publishing failed on all endpoints"}


async def _publish_as_story(settings: dict, image_url: str) -> dict:
    """Publish image as an Instagram Story (STORIES media type)."""
    access_token = settings.get("access_token", "")
    ig_user_id = settings.get("ig_user_id", "")
    if not access_token or not ig_user_id:
        return {"error": "not configured"}
    if not image_url or image_url.startswith("data:"):
        return {"error": "public URL required"}

    import asyncio
    async with httpx.AsyncClient(timeout=60.0) as http:
        for base in (IG_GRAPH_BASE, GRAPH_BASE):
            container = await http.post(
                f"{base}/{ig_user_id}/media",
                data={"image_url": image_url, "media_type": "STORIES", "access_token": access_token},
            )
            if container.status_code == 400:
                err = (container.json() or {}).get("error", {})
                if err.get("code") in (10, 100) and base == IG_GRAPH_BASE:
                    continue
            if container.status_code >= 400:
                return {"error": f"Story container failed {container.status_code}: {container.text[:200]}"}
            creation_id = (container.json() or {}).get("id", "")
            if not creation_id:
                return {"error": "No creation_id for story"}
            for _ in range(15):
                s = await http.get(f"{base}/{creation_id}",
                    params={"fields": "status_code", "access_token": access_token})
                sc = (s.json() or {}).get("status_code", "")
                if sc == "FINISHED":
                    break
                if sc in ("ERROR", "EXPIRED"):
                    return {"error": f"Story container {sc.lower()}"}
                await asyncio.sleep(2)
            pub = await http.post(f"{base}/{ig_user_id}/media_publish",
                data={"creation_id": creation_id, "access_token": access_token})
            if pub.status_code >= 400:
                return {"error": f"Story publish failed: {pub.text[:200]}"}
            return {"story_media_id": (pub.json() or {}).get("id", "")}
    return {"error": "Story publishing failed on all endpoints"}


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

    add_to_story = bool(body.get("add_to_story", False))
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

    story_result = {}
    if add_to_story and image_url and not image_url.startswith("data:"):
        story_result = await _publish_as_story(settings, image_url)

    return {
        "status": "published",
        "ig_media_id": ig_media_id,
        "story": story_result if add_to_story else None,
    }


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
            # Try graph.instagram.com first (Instagram Login tokens), fall back to graph.facebook.com
            for base in (IG_GRAPH_BASE, GRAPH_BASE):
                r = await http.get(f"{base}/{ig_user_id}",
                    params={"fields": "id,username", "access_token": access_token})
                if r.status_code == 200:
                    data = r.json()
                    username = data.get("username", "")
                    return {"instagram": {"ok": True, "message": f"Connected as @{username}" if username else "Connected"}}
                if r.status_code != 400:
                    break
        eb = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        msg = eb.get("error", {}).get("message", r.text[:200])
        return {"instagram": {"ok": False, "message": f"HTTP {r.status_code}: {msg}"}}
    except Exception as e:
        return {"instagram": {"ok": False, "message": str(e)}}


@router.post("/detect-account")
async def detect_account(request: Request):
    """Re-detect Instagram Business Account ID from stored access token."""
    s = _get_instagram_settings()
    token = s.get("access_token", "")
    if not token:
        return {"ok": False, "message": "No access token — connect with Instagram first"}

    async with httpx.AsyncClient(timeout=15.0) as http:

        async def _save_and_return(ig_id: str, username: str = "") -> dict:
            cfg = load_app_config()
            ig = cfg.get("instagram", {}) or {}
            ig["ig_user_id"] = ig_id
            if username:
                ig["username"] = username
            cfg["instagram"] = ig
            save_app_config(cfg)
            label = f"@{username}" if username else f"ID {ig_id}"
            return {"ok": True, "ig_user_id": ig_id, "username": username,
                    "message": f"Found Instagram account {label} (ID: {ig_id})"}

        async def _get_username(ig_id: str) -> str:
            r = await http.get(f"{GRAPH_BASE}/{ig_id}",
                               params={"fields": "id,username", "access_token": token})
            return r.json().get("username", "") if r.status_code == 200 else ""

        # Step 1: try me/accounts with both field names + page access_token
        pages_r = await http.get(
            f"{GRAPH_BASE}/me/accounts",
            params={"fields": "id,name,access_token,instagram_business_account,connected_instagram_account", "access_token": token},
        )
        page_names = []
        if pages_r.status_code == 200:
            pages = pages_r.json().get("data", [])
            page_names = [p.get("name", p.get("id", "?")) for p in pages]
            for page in pages:
                for field in ("instagram_business_account", "connected_instagram_account"):
                    iba = page.get(field, {}) or {}
                    ig_id = iba.get("id", "")
                    if ig_id:
                        return await _save_and_return(ig_id, await _get_username(ig_id))

            # Step 2: fetch each page individually with its own page access token
            for page in pages:
                page_id = page.get("id", "")
                page_token = page.get("access_token") or token
                for field in ("instagram_business_account", "connected_instagram_account"):
                    pr = await http.get(
                        f"{GRAPH_BASE}/{page_id}",
                        params={"fields": f"id,name,{field}", "access_token": page_token},
                    )
                    if pr.status_code == 200:
                        iba = (pr.json().get(field) or {})
                        ig_id = iba.get("id", "")
                        if ig_id:
                            return await _save_and_return(ig_id, await _get_username(ig_id))

            # Step 3: try /me/instagram_accounts (some token types expose this)
            ia_r = await http.get(f"{GRAPH_BASE}/me/instagram_accounts",
                                   params={"fields": "id,username,ig_id", "access_token": token})
            if ia_r.status_code == 200:
                for acct in ia_r.json().get("data", []):
                    ig_id = acct.get("id") or acct.get("ig_id", "")
                    if ig_id:
                        username = acct.get("username", "")
                        return await _save_and_return(ig_id, username)

        # Step 3: try me directly (for some token types)
        me_r = await http.get(
            f"{GRAPH_BASE}/me",
            params={"fields": "instagram_business_account,connected_instagram_account", "access_token": token},
        )
        if me_r.status_code == 200:
            me_data = me_r.json()
            for field in ("instagram_business_account", "connected_instagram_account"):
                ig_id = (me_data.get(field) or {}).get("id", "")
                if ig_id:
                    return await _save_and_return(ig_id, await _get_username(ig_id))

        pages_info = f" Found {len(page_names)} page(s): {', '.join(page_names)}." if page_names else " No Facebook Pages found on this token."
        return {
            "ok": False,
            "message": (
                f"No linked Instagram account found.{pages_info} "
                "To fix: on Instagram go to Settings → Account → Switch to Professional Account (Business or Creator), "
                "then link it to your Facebook Page via Settings → Linked Accounts."
            ),
        }


@router.post("/test-post")
async def test_post(request: Request):
    """Post a simple test image to Instagram to diagnose publishing issues."""
    s = _get_instagram_settings()
    access_token = s.get("access_token", "")
    ig_user_id = s.get("ig_user_id", "")

    if not access_token:
        return {"step": "check", "ok": False, "error": "No access token — connect Instagram first"}
    if not ig_user_id:
        return {"step": "check", "ok": False, "error": "No Instagram Account ID — enter it in Settings"}

    # Use a guaranteed public image from picsum
    test_image = "https://picsum.photos/1080/1080.jpg"
    test_caption = "Test post from Director Assistant"

    async with httpx.AsyncClient(timeout=30.0) as http:
        last_err = {}
        for base in (IG_GRAPH_BASE, GRAPH_BASE):
            r1 = await http.post(
                f"{base}/{ig_user_id}/media",
                data={"image_url": test_image, "caption": test_caption, "access_token": access_token},
            )
            r1_json = r1.json() if r1.headers.get("content-type", "").startswith("application/json") else {"raw": r1.text[:300]}
            if r1.status_code >= 400:
                last_err = {"step": "create_container", "ok": False, "status": r1.status_code,
                            "base_used": base, "ig_user_id": ig_user_id,
                            "token_prefix": access_token[:20] + "…", "error": r1_json}
                continue

            creation_id = r1_json.get("id", "")
            if not creation_id:
                return {"step": "create_container", "ok": False, "base_used": base,
                        "error": "No creation_id returned", "response": r1_json}

            r2 = await http.post(
                f"{base}/{ig_user_id}/media_publish",
                data={"creation_id": creation_id, "access_token": access_token},
            )
            r2_json = r2.json() if r2.headers.get("content-type", "").startswith("application/json") else {"raw": r2.text[:300]}
            if r2.status_code >= 400:
                return {"step": "publish", "ok": False, "base_used": base, "status": r2.status_code, "error": r2_json}

            return {"step": "done", "ok": True, "base_used": base,
                    "ig_media_id": r2_json.get("id", ""), "message": "Test post published!"}

        return last_err


@router.get("/debug-token")
async def debug_token(request: Request):
    """Check what permissions and accounts the stored token has."""
    s = _get_instagram_settings()
    token = s.get("access_token", "")
    if not token:
        return {"error": "No token stored"}
    results = {}
    async with httpx.AsyncClient(timeout=15.0) as http:
        # Token info
        ti = await http.get(f"https://graph.facebook.com/debug_token",
                            params={"input_token": token, "access_token": token})
        results["token_info"] = ti.json() if ti.status_code == 200 else {"error": ti.text[:200]}
        # Pages
        pr = await http.get(f"{GRAPH_BASE}/me/accounts",
                            params={"fields": "id,name,access_token,instagram_business_account,connected_instagram_account", "access_token": token})
        results["pages"] = pr.json() if pr.status_code == 200 else {"error": pr.text[:200]}
        # Me
        me = await http.get(f"{GRAPH_BASE}/me", params={"fields": "id,name,instagram_business_account", "access_token": token})
        results["me"] = me.json() if me.status_code == 200 else {"error": me.text[:200]}
    return results


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
    if not public_url.startswith("http://") and not public_url.startswith("https://"):
        public_url = "https://" + public_url

    probe = f"da_probe_{uuid.uuid4().hex[:8]}.txt"

    def _test():
        ftp = ftplib.FTP()
        ftp.connect(host, timeout=10)
        ftp.login(user, passwd)
        import io
        if path and path.rstrip("/"):
            ftp.cwd(path.rstrip("/"))
        ftp.storbinary(f"STOR {probe}", io.BytesIO(b"ok"))
        ftp.delete(probe)
        ftp.quit()

    try:
        await asyncio.to_thread(_test)
        return {"ok": True, "message": f"FTP connected. Files will be served at {public_url}/"}
    except ftplib.all_errors as e:
        return {"ok": False, "message": f"FTP error: {e}"}
    except Exception as e:
        return {"ok": False, "message": str(e)}


# ── Instagram Autopilot ────────────────────────────────────────────────────────

@router.get("/autopilot")
async def get_autopilot(request: Request):
    import json as _json
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        row = conn.execute("SELECT * FROM instagram_autopilot ORDER BY id LIMIT 1").fetchone()
    if not row:
        return {"config": None}
    d = dict(row)
    d["topics"] = _json.loads(d.get("topics") or "[]")
    return {"config": d}


@router.post("/autopilot")
async def save_autopilot(body: dict, request: Request):
    import json as _json
    cache = request.app.state.cache
    _ensure_tables(cache)
    topics = body.get("topics") or []
    tone = body.get("tone") or "Inspiring"
    hashtag_count = int(body.get("hashtag_count") or 15)
    content_type = body.get("content_type", "image+text")
    interval_days = int(body.get("interval_days") or 3)
    post_time = body.get("post_time") or "09:00"
    enabled = 1 if body.get("enabled", True) else 0
    next_post_at = body.get("next_post_at") or None
    topic_index = int(body.get("topic_index") or 0)
    topics_json = _json.dumps(topics)
    with cache._conn() as conn:
        existing = conn.execute("SELECT id FROM instagram_autopilot LIMIT 1").fetchone()
        if existing:
            conn.execute(
                """UPDATE instagram_autopilot SET topics=?, tone=?, hashtag_count=?,
                   content_type=?, interval_days=?, post_time=?, enabled=?, next_post_at=?,
                   topic_index=? WHERE id=?""",
                (topics_json, tone, hashtag_count, content_type, interval_days,
                 post_time, enabled, next_post_at, topic_index, existing["id"]),
            )
        else:
            conn.execute(
                """INSERT INTO instagram_autopilot
                   (topics, tone, hashtag_count, content_type, interval_days,
                    post_time, enabled, next_post_at, topic_index)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (topics_json, tone, hashtag_count, content_type, interval_days,
                 post_time, enabled, next_post_at, topic_index),
            )
    return {"status": "saved"}


@router.delete("/autopilot")
async def delete_autopilot(request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        conn.execute("DELETE FROM instagram_autopilot")
    return {"status": "deleted"}


# ── Instagram Templates ────────────────────────────────────────────────────────

@router.get("/templates")
async def get_templates(request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT id, name, icon, tone, prompt, sample_image, builtin FROM instagram_templates WHERE builtin=0 ORDER BY created_at ASC"
        ).fetchall()
    user_templates = [dict(r) for r in rows]
    return {"templates": IG_BUILTIN_TEMPLATES + user_templates}


@router.post("/templates")
async def save_template(body: dict, request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    name = (body.get("name") or "").strip()
    prompt = (body.get("prompt") or "").strip()
    if not name or not prompt:
        return {"error": "Name and prompt are required"}
    icon = body.get("icon") or "📸"
    tone = body.get("tone") or "Inspiring"
    sample_image = body.get("sample_image") or ""
    template_id = str(uuid.uuid4())
    with cache._conn() as conn:
        conn.execute(
            "INSERT INTO instagram_templates (id, name, icon, tone, prompt, sample_image, builtin) VALUES (?, ?, ?, ?, ?, ?, 0)",
            (template_id, name, icon, tone, prompt, sample_image),
        )
    return {"id": template_id, "status": "saved"}


@router.put("/templates/{template_id}")
async def update_template(template_id: str, body: dict, request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    name = (body.get("name") or "").strip()
    prompt = (body.get("prompt") or "").strip()
    icon = body.get("icon") or "📸"
    tone = body.get("tone") or "Inspiring"
    sample_image = body.get("sample_image")
    with cache._conn() as conn:
        if sample_image is not None:
            conn.execute(
                "UPDATE instagram_templates SET name=?, icon=?, tone=?, prompt=?, sample_image=? WHERE id=? AND builtin=0",
                (name, icon, tone, prompt, sample_image, template_id),
            )
        else:
            conn.execute(
                "UPDATE instagram_templates SET name=?, icon=?, tone=?, prompt=? WHERE id=? AND builtin=0",
                (name, icon, tone, prompt, template_id),
            )
    return {"status": "updated"}


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        conn.execute("DELETE FROM instagram_templates WHERE id=? AND builtin=0", (template_id,))
    return {"status": "deleted"}
