"""LinkedIn social posting endpoints — settings, AI trends/post/image generation, publish, history."""

import json
import uuid

import httpx
from fastapi import APIRouter, Request

from routers.config import load_app_config, save_app_config

router = APIRouter(prefix="/api/social", tags=["social"])

LINKEDIN_SETTING_KEYS = ("client_id", "client_secret", "access_token", "user_id", "custom_prompts")


def _ensure_tables(cache):
    with cache._conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS linkedin_posts (
                id TEXT PRIMARY KEY,
                subject TEXT,
                topic TEXT,
                post_text TEXT,
                audience TEXT,
                tone TEXT,
                image_url TEXT,
                image_prompt TEXT,
                content_type TEXT,
                scheduled_at TEXT,
                published_at TEXT,
                linkedin_post_id TEXT,
                status TEXT DEFAULT 'draft',
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)


def _get_linkedin_settings() -> dict:
    cfg = load_app_config()
    ln = cfg.get("linkedin", {}) or {}
    return {
        "client_id": ln.get("client_id", ""),
        "client_secret": ln.get("client_secret", ""),
        "access_token": ln.get("access_token", ""),
        "user_id": ln.get("user_id", ""),
        "custom_prompts": ln.get("custom_prompts", []),
    }


def _get_openai_key() -> str:
    cfg = load_app_config()
    key = cfg.get("openai_api_key", "")
    if key:
        return key
    for p in cfg.get("ai_providers", []):
        if p.get("type") == "openai" and p.get("key"):
            return p["key"]
    return ""


async def _ai_complete(request: Request, prompt: str, max_tokens: int = 800) -> str:
    advisor = getattr(request.app.state, "advisor", None)
    if not advisor:
        raise RuntimeError("AI advisor not available")
    messages = [{"role": "user", "content": prompt}]
    ant = getattr(advisor.ai, "_anthropic", None)
    if ant:
        resp = await ant.messages.create(model="claude-opus-4-8", max_tokens=max_tokens, messages=messages)
    else:
        resp = await advisor.ai.messages.create(model="claude-opus-4-8", max_tokens=max_tokens, messages=messages)
    return resp.content[0].text


def _extract_json(text: str):
    """Pull a JSON array/object out of an AI response that may wrap it in prose or code fences."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1] if "```" in text[3:] else text
        text = text.lstrip("json").strip("`").strip()
    for open_ch, close_ch in (("[", "]"), ("{", "}")):
        start = text.find(open_ch)
        end = text.rfind(close_ch)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                continue
    return None


@router.get("/linkedin/settings")
async def get_settings(request: Request):
    return _get_linkedin_settings()


@router.post("/linkedin/settings")
async def save_settings(body: dict, request: Request):
    cfg = load_app_config()
    ln = cfg.get("linkedin", {}) or {}
    for key in LINKEDIN_SETTING_KEYS:
        if key in body and body[key] is not None:
            ln[key] = body[key]
    cfg["linkedin"] = ln
    save_app_config(cfg)
    return {"status": "saved"}


@router.post("/linkedin/trends")
async def get_trends(body: dict, request: Request):
    subject = (body.get("subject") or "").strip()
    if not subject:
        return {"trends": [], "error": "subject is required"}
    prompt = (
        f"Generate 5 current trending LinkedIn post topics related to: {subject}. "
        "Return as JSON array: "
        "[{'title': '...', 'description': '...', 'engagement': 'High/Medium', 'hashtags': ['...']}]"
    )
    try:
        content = await _ai_complete(request, prompt, max_tokens=800)
    except Exception as e:
        return {"trends": [], "error": str(e)}
    trends = _extract_json(content)
    if not isinstance(trends, list):
        return {"trends": [], "error": "Could not parse AI response"}
    return {"trends": trends}


@router.post("/linkedin/generate-post")
async def generate_post(body: dict, request: Request):
    topic = (body.get("topic") or "").strip()
    audience = (body.get("audience") or "General").strip()
    tone = (body.get("tone") or "Professional").strip()
    subject = (body.get("subject") or "").strip()
    if not topic:
        return {"post": "", "hashtags": [], "char_count": 0, "error": "topic is required"}
    prompt = (
        f"Write a professional LinkedIn post about: {topic}.\n"
        f"Subject area: {subject or topic}.\n"
        f"Target audience: {audience}.\n"
        f"Tone: {tone}.\n"
        "Make it engaging, well-structured with line breaks, and suitable for LinkedIn. "
        "Include relevant emojis sparingly. Do NOT include hashtags in the post body.\n\n"
        "Return ONLY a JSON object: "
        "{'post': 'the full post text', 'hashtags': ['Hashtag1', 'Hashtag2']}"
    )
    try:
        content = await _ai_complete(request, prompt, max_tokens=1200)
    except Exception as e:
        return {"post": "", "hashtags": [], "char_count": 0, "error": str(e)}
    parsed = _extract_json(content)
    if isinstance(parsed, dict) and "post" in parsed:
        post = parsed.get("post", "")
        hashtags = parsed.get("hashtags", []) or []
    else:
        post = content.strip()
        hashtags = []
    return {"post": post, "hashtags": hashtags, "char_count": len(post)}


@router.post("/linkedin/generate-images")
async def generate_images(body: dict, request: Request):
    topic = (body.get("topic") or "").strip()
    post_text = (body.get("post_text") or "").strip()
    custom_prompt = body.get("custom_prompt")

    openai_key = _get_openai_key()
    if not openai_key:
        return {"images": [], "error": "OpenAI API key not configured"}

    base = custom_prompt.strip() if custom_prompt else ""
    prompt = (
        "Generate 3 distinct DALL-E image prompts for a LinkedIn post.\n"
        f"Topic: {topic}\n"
        f"Post content: {post_text[:600]}\n"
        + (f"Style guidance: {base}\n" if base else "")
        + "Each prompt should describe a professional, clean, modern visual suitable for LinkedIn. "
        "Return ONLY a JSON array of 3 strings: ['prompt 1', 'prompt 2', 'prompt 3']"
    )
    try:
        content = await _ai_complete(request, prompt, max_tokens=600)
    except Exception as e:
        return {"images": [], "error": str(e)}

    prompts = _extract_json(content)
    if not isinstance(prompts, list) or not prompts:
        return {"images": [], "error": "Could not generate image prompts"}
    prompts = [str(p) for p in prompts[:3]]

    images = []
    headers = {"Authorization": f"Bearer {openai_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=120.0) as http:
        for p in prompts:
            try:
                resp = await http.post(
                    "https://api.openai.com/v1/images/generations",
                    headers=headers,
                    json={"model": "dall-e-3", "prompt": p, "size": "1024x1024", "n": 1},
                )
                resp.raise_for_status()
                data = resp.json()
                url = data.get("data", [{}])[0].get("url", "")
                if url:
                    images.append({"url": url, "prompt": p})
            except Exception:
                continue

    if not images:
        return {"images": [], "error": "Image generation failed"}
    return {"images": images}


@router.post("/linkedin/save-draft")
async def save_draft(body: dict, request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    post_id = str(uuid.uuid4())
    with cache._conn() as conn:
        conn.execute(
            """
            INSERT INTO linkedin_posts
                (id, subject, topic, post_text, audience, tone, image_url, image_prompt,
                 content_type, scheduled_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
            """,
            (
                post_id,
                body.get("subject"),
                body.get("topic"),
                body.get("post_text"),
                body.get("audience"),
                body.get("tone"),
                body.get("image_url"),
                body.get("image_prompt"),
                body.get("content_type"),
                body.get("scheduled_at"),
            ),
        )
    return {"id": post_id}


async def _publish_to_linkedin(post_text: str, settings: dict) -> dict:
    access_token = settings.get("access_token", "")
    user_id = settings.get("user_id", "")
    if not access_token or not user_id:
        return {"error": "LinkedIn not connected"}

    author = user_id if user_id.startswith("urn:") else f"urn:li:person:{user_id}"
    payload = {
        "author": author,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": post_text},
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
    }
    async with httpx.AsyncClient(timeout=30.0) as http:
        resp = await http.post(
            "https://api.linkedin.com/v2/ugcPosts", headers=headers, json=payload
        )
    if resp.status_code >= 400:
        return {"error": f"LinkedIn API error {resp.status_code}: {resp.text[:200]}"}
    data = resp.json()
    return {"linkedin_post_id": data.get("id") or resp.headers.get("x-restli-id", "")}


@router.post("/linkedin/publish")
async def publish(body: dict, request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    post_id = body.get("id")
    post_text = body.get("post_text") or ""
    scheduled_at = body.get("scheduled_at")

    if scheduled_at:
        with cache._conn() as conn:
            conn.execute(
                "UPDATE linkedin_posts SET status='scheduled', scheduled_at=? WHERE id=?",
                (scheduled_at, post_id),
            )
        return {"status": "scheduled", "linkedin_post_id": None}

    settings = _get_linkedin_settings()
    result = await _publish_to_linkedin(post_text, settings)
    if "error" in result:
        return {"error": result["error"]}

    linkedin_post_id = result.get("linkedin_post_id", "")
    with cache._conn() as conn:
        conn.execute(
            """
            UPDATE linkedin_posts
            SET status='published', published_at=datetime('now'), linkedin_post_id=?
            WHERE id=?
            """,
            (linkedin_post_id, post_id),
        )
    return {"status": "published", "linkedin_post_id": linkedin_post_id}


@router.get("/linkedin/history")
async def get_history(request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT * FROM linkedin_posts ORDER BY created_at DESC"
        ).fetchall()
    return {"posts": [dict(r) for r in rows]}


@router.delete("/linkedin/history/{post_id}")
async def delete_history(post_id: str, request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        conn.execute("DELETE FROM linkedin_posts WHERE id=?", (post_id,))
    return {"status": "deleted"}
