"""Victim photo search for the Free Iran Instagram template."""

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/instagram", tags=["instagram"])

FREE_IRAN_TEMPLATE_ID = "3b1801f1-1511-4a96-8b93-284368f5e5a5"


@router.post("/search-victim-photos")
async def search_victim_photos(body: dict):
    """Search the web for photos and info about a specific victim of the Iranian regime."""
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")

    try:
        from ddgs import DDGS
    except ImportError:
        raise HTTPException(503, "ddgs not installed")

    images = []
    articles = []

    try:
        with DDGS() as ddgs:
            # Image search
            img_results = list(ddgs.images(
                f"{name} Iran victim killed",
                max_results=12,
                safesearch="off",
            ))
            for r in img_results:
                url = r.get("image") or r.get("url", "")
                if url and url.startswith("http"):
                    images.append({
                        "url": url,
                        "thumbnail": r.get("thumbnail", url),
                        "title": r.get("title", ""),
                        "source": r.get("source", ""),
                    })

            # News/article search for context
            news_results = list(ddgs.text(
                f'"{name}" Iran killed murdered executed',
                max_results=5,
            ))
            for r in news_results:
                articles.append({
                    "title": r.get("title", ""),
                    "snippet": (r.get("body") or "")[:300],
                    "url": r.get("href", "") or r.get("url", ""),
                })
    except Exception as exc:
        raise HTTPException(502, f"Search failed: {exc}")

    return {"images": images[:10], "articles": articles, "name": name}
