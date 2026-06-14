"""RAG statistics and embeddings endpoints."""

import asyncio
import logging
from pathlib import Path
from fastapi import APIRouter, Request

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rag", tags=["rag"])

EMBEDDING_MODEL = "all-MiniLM-L6-v2"


@router.get("/stats")
async def get_rag_stats(request: Request):
    """Return RAG index statistics for display in the Settings panel."""
    rag = getattr(request.app.state, "rag", None)

    if rag is None:
        return {
            "count": 0,
            "collection_size_mb": 0.0,
            "last_indexed": "",
            "embedding_model": EMBEDDING_MODEL,
            "status": "unavailable",
        }

    loop = asyncio.get_event_loop()

    def _collect():
        unique_count = rag.count_unique_emails() + rag.count_unique_docs()

        # Estimate size from ChromaDB data directory
        db_path = Path.home() / ".director-assistant" / "chromadb"
        size_bytes = 0
        if db_path.exists():
            try:
                size_bytes = sum(
                    f.stat().st_size for f in db_path.rglob("*") if f.is_file()
                )
            except Exception:
                size_bytes = 0
        size_mb = round(size_bytes / 1024 / 1024, 2)

        # Derive last_indexed from the most recent date metadata in the ID sets
        last_indexed = ""
        try:
            result = rag._col.get(include=["metadatas"])
            dates = [
                m.get("date", "") or m.get("modified_at", "")
                for m in (result.get("metadatas") or [])
                if m.get("date") or m.get("modified_at")
            ]
            if dates:
                last_indexed = max(d for d in dates if d)[:10]
        except Exception:
            pass

        proxy_count = rag._proxy.count()
        status = "ready" if proxy_count > 0 else ("empty" if unique_count == 0 else "indexing")

        return {
            "count": unique_count,
            "collection_size_mb": size_mb,
            "last_indexed": last_indexed,
            "embedding_model": EMBEDDING_MODEL,
            "status": status,
        }

    return await loop.run_in_executor(None, _collect)


MAX_POINTS = 500


@router.get("/embeddings-2d")
async def get_embeddings_2d(request: Request):
    """
    Return all indexed email embeddings projected to 2D via PCA.
    Capped at MAX_POINTS for performance. Used by the Email Map scatter plot.
    Response: [{id, x, y, subject, sender, category, date}]
    """
    rag = getattr(request.app.state, "rag", None)
    cache = getattr(request.app.state, "cache", None)
    if rag is None:
        return {"points": [], "error": "RAG not available"}

    loop = asyncio.get_event_loop()

    def _get_categories(email_ids: list) -> dict:
        """Fetch AI-assigned categories from SQLite for a list of email IDs."""
        if not cache or not email_ids:
            return {}
        try:
            placeholders = ",".join("?" * len(email_ids))
            with cache._conn() as conn:
                rows = conn.execute(
                    f"SELECT e.id, ec.category FROM emails e "
                    f"LEFT JOIN email_categories ec ON ec.email_id = e.id "
                    f"WHERE e.id IN ({placeholders})",
                    email_ids,
                ).fetchall()
            return {r["id"]: (r["category"] or "other") for r in rows}
        except Exception:
            return {}

    def _project():
        try:
            # Fetch only chunk_index==0 to get one vector per email (the first chunk)
            result = rag._proxy.get(
                where={"chunk_index": 0},
                include=["embeddings", "metadatas"],
            )
        except Exception as exc:
            logger.warning(f"[embeddings-2d] proxy.get failed: {exc}")
            result = None

        embeddings = (result or {}).get("embeddings")
        metadatas = (result or {}).get("metadatas") or []

        # embeddings may be a numpy array — check with len() not bool()
        if embeddings is None or len(embeddings) == 0:
            return {"points": [], "error": "Embeddings not available (worker may still be loading)"}

        if len(embeddings) < 2:
            return {"points": [], "error": "Not enough indexed emails for projection"}

        # Cap at MAX_POINTS — take the first N (already stable ordering from ChromaDB)
        if len(embeddings) > MAX_POINTS:
            embeddings = embeddings[:MAX_POINTS]
            metadatas = metadatas[:MAX_POINTS]

        try:
            import numpy as np
            from sklearn.decomposition import PCA

            arr = np.array(embeddings, dtype=np.float32)
            n_components = min(2, arr.shape[0], arr.shape[1])
            pca = PCA(n_components=n_components)
            coords = pca.fit_transform(arr)
        except Exception as exc:
            logger.warning(f"[embeddings-2d] PCA failed: {exc}")
            return {"points": [], "error": f"PCA error: {exc}"}

        # Build points list and collect email IDs for category lookup
        raw_points = []
        for i, meta in enumerate(metadatas):
            if meta.get("source_type", "email") != "email":
                continue
            x = float(coords[i][0]) if coords.shape[1] > 0 else 0.0
            y = float(coords[i][1]) if coords.shape[1] > 1 else 0.0
            raw_points.append({
                "id": meta.get("email_id", ""),
                "x": x,
                "y": y,
                "subject": meta.get("subject", ""),
                "sender": meta.get("sender", ""),
                "date": meta.get("date", ""),
            })

        # Fetch AI-assigned categories from SQLite
        email_ids = [p["id"] for p in raw_points if p["id"]]
        cat_map = _get_categories(email_ids)

        points = [{**p, "category": cat_map.get(p["id"], "other")} for p in raw_points]

        return {"points": points}

    return await loop.run_in_executor(None, _project)
