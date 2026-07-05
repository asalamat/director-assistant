"""News feed — fetches from DuckDuckGo, scores relevance with AI."""

import asyncio
import json
import logging
import re
import time
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Request

from routers.config import load_app_config

router = APIRouter(prefix="/api/news", tags=["news"])
_log = logging.getLogger(__name__)

# In-memory cache: {cache_key: {"articles": [...], "fetched_at": float}}
_cache: dict[str, dict] = {}
CACHE_TTL = 600  # 10 minutes


def _fetch_topic(topic: str, max_results: int) -> list[dict]:
    from ddgs import DDGS
    with DDGS() as ddgs:
        return list(ddgs.news(topic, max_results=max_results))


def _is_within_24h(date_str: str) -> bool:
    """Return True if date_str parses to within the last 24 hours."""
    if not date_str:
        return True  # keep articles with unknown dates
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z"):
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt >= cutoff
        except ValueError:
            continue
    # Try fromisoformat as fallback (Python 3.11+ handles most ISO strings)
    try:
        dt = datetime.fromisoformat(date_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt >= cutoff
    except Exception:
        return True  # keep if we can't parse


async def _fetch_news(topics: list[str], max_per_topic: int = 12) -> list[dict]:
    """Fetch news from DuckDuckGo for each topic, deduplicate by URL, keep last 24h only."""
    seen_urls: set[str] = set()
    articles = []
    for topic in topics[:6]:
        try:
            results = await asyncio.to_thread(_fetch_topic, topic, max_per_topic)
        except Exception as e:
            _log.warning("News fetch failed for topic %s: %s", topic, type(e).__name__)
            continue
        for r in results:
            url = r.get("url", "") or r.get("href", "")
            if not url or url in seen_urls:
                continue
            date_str = r.get("date", "")
            if not _is_within_24h(date_str):
                continue
            seen_urls.add(url)
            articles.append({
                "title": r.get("title", ""),
                "url": url,
                "source": r.get("source", ""),
                "published": date_str,
                "body": (r.get("body") or "")[:300],
                "topic": topic,
                "relevance": 5,  # default; AI will score
                "summary": "",
            })
    return articles


async def _ai_score(articles: list[dict], topics: list[str], request: Request) -> list[dict]:
    """Batch-score relevance (1-10) and add a short summary for each article."""
    if not articles:
        return articles
    ai = getattr(getattr(request.app.state, "advisor", None), "ai", None)
    if ai is None:
        return articles
    batch = "\n".join(
        f"{i+1}. {a['title']} — {a['body'][:120]}"
        for i, a in enumerate(articles[:30])
    )
    prompt = (
        f"User interests: {', '.join(topics)}\n\n"
        f"Rate each news headline 1-10 for relevance to those interests "
        f"and give a 10-word summary. Reply ONLY as JSON array: "
        f'[{{"i":1,"score":8,"summary":"brief summary"}}, ...]\n\n{batch}'
    )
    try:
        resp = await ai.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if match:
            scores = json.loads(match.group())
            score_map = {item.get("i"): item for item in scores if isinstance(item, dict)}
            for idx, art in enumerate(articles[:30]):
                info = score_map.get(idx + 1, {})
                art["relevance"] = max(1, min(10, int(info.get("score", 5))))
                art["summary"] = str(info.get("summary", ""))[:120]
    except Exception as e:
        _log.warning("AI news scoring failed: %s", type(e).__name__)
    return articles


@router.get("")
async def get_news(request: Request, force: bool = False):
    """Return cached news; refresh if stale or force=true."""
    cfg = load_app_config()
    if not cfg.get("news_enabled", False):
        return {"enabled": False, "articles": [], "fetched_at": None}
    topics = cfg.get("news_topics", [])
    if not topics:
        return {"enabled": True, "articles": [], "fetched_at": None,
                "hint": "Add topics in Settings → News"}

    cache_key = "|".join(sorted(topics))
    cached = _cache.get(cache_key)
    now = time.time()
    if not force and cached and (now - cached["fetched_at"]) < CACHE_TTL:
        return {"enabled": True, "articles": cached["articles"],
                "fetched_at": cached["fetched_at"]}

    articles = await _fetch_news(topics)
    articles = await _ai_score(articles, topics, request)
    articles.sort(key=lambda a: -a["relevance"])
    _cache[cache_key] = {"articles": articles, "fetched_at": now}
    return {"enabled": True, "articles": articles, "fetched_at": now}


@router.post("/refresh")
async def refresh_news(request: Request):
    """Force a fresh fetch regardless of cache age."""
    return await get_news(request, force=True)


@router.post("/summarize")
async def summarize_articles(request: Request):
    """Generate structured, educational summaries for selected articles."""
    body = await request.json()
    articles = body.get("articles", [])
    if not articles:
        return {"summaries": []}

    ai = getattr(getattr(request.app.state, "advisor", None), "ai", None)
    if ai is None:
        return {"summaries": [{"url": a.get("url", ""), "what": "AI not configured.", "why": "", "takeaway": ""} for a in articles]}

    batch = "\n".join(
        f'{i+1}. Title: {a.get("title", "")}\n   Body: {(a.get("body") or "")[:300]}'
        for i, a in enumerate(articles[:20])
    )
    prompt = (
        "For each article below, provide a structured educational breakdown. "
        "Reply ONLY as a JSON array with exactly this shape — no extra keys:\n"
        '[{"i":1,"what":"1 sentence: what actually happened","why":"1 sentence: why this matters or what changed","takeaway":"1 sentence: the practical lesson or action to remember"}, ...]\n\n'
        "Keep each field to one clear, plain-English sentence. No jargon. No filler.\n\n"
        + batch
    )
    try:
        resp = await ai.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=2500,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if match:
            results = json.loads(match.group())
            idx_map = {item.get("i"): item for item in results if isinstance(item, dict)}
            return {
                "summaries": [
                    {
                        "url": a.get("url", ""),
                        "what": str(idx_map.get(i + 1, {}).get("what", "")),
                        "why": str(idx_map.get(i + 1, {}).get("why", "")),
                        "takeaway": str(idx_map.get(i + 1, {}).get("takeaway", "")),
                    }
                    for i, a in enumerate(articles[:20])
                ]
            }
    except Exception as e:
        _log.warning("AI news summarize failed: %s", type(e).__name__)

    return {"summaries": [{"url": a.get("url", ""), "what": "Summary unavailable.", "why": "", "takeaway": ""} for a in articles]}
