"""
RAG retrieval mixin — RRF fusion, hybrid search, reranking, and similarity.

Mixed into RAGEngine via inheritance. Depends on self.ai, self._cache, self._proxy,
self._indexed_email_ids, self._indexed_doc_ids, and class constants RRF_K /
CHUNK_SIZE / SIMILARITY_THRESHOLD.
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from models import EmailMessage

logger = logging.getLogger(__name__)


class RAGRetrieval:
    # Time-weighted scoring: emails newer than RECENCY_WINDOW_DAYS get a flat
    # RRF-score bonus so recent context outranks equally-relevant stale email.
    RECENCY_WINDOW_DAYS = 30
    RECENCY_BOOST = 0.3

    # Cosine distance threshold: 0 = identical, 1 = orthogonal.
    SIMILARITY_THRESHOLD = 0.50

    def _rrf(
        self,
        *ranked_lists: List[str],
        email_dates: Optional[dict] = None,
        time_weighted: bool = True,
    ) -> List[str]:
        """RRF fusion with optional time-weighted boost for recent emails."""
        scores: dict[str, float] = {}
        for ranked in ranked_lists:
            for rank, id_ in enumerate(ranked):
                scores[id_] = scores.get(id_, 0.0) + 1.0 / (self.RRF_K + rank + 1)
        if time_weighted and email_dates:
            cutoff = datetime.now(tz=timezone.utc) - timedelta(days=self.RECENCY_WINDOW_DAYS)
            for id_, date_str in email_dates.items():
                if not date_str or id_ not in scores:
                    continue
                try:
                    s = str(date_str).strip()
                    for fmt, trunc in (
                        ("%Y-%m-%d %H:%M:%S", 19),
                        ("%Y-%m-%d", 10),
                        ("%a, %d %b %Y %H:%M:%S %z", None),
                        ("%a, %d %b %Y %H:%M:%S", 25),
                    ):
                        candidate = s if trunc is None else s[:trunc]
                        try:
                            dt = datetime.strptime(candidate, fmt)
                            if dt.tzinfo is None:
                                dt = dt.replace(tzinfo=timezone.utc)
                            if dt >= cutoff:
                                scores[id_] = scores[id_] + self.RECENCY_BOOST
                            break
                        except ValueError:
                            continue
                except Exception:
                    pass
        return sorted(scores, key=lambda x: scores[x], reverse=True)

    def hybrid_search(
        self, query: str, n_results: int = 20, time_weighted: bool = True
    ) -> List[dict]:
        """Dense (ChromaDB) + Sparse (SQLite FTS5), fused with RRF."""
        count = self._proxy.count()
        has_data = count > 0 or len(self._indexed_email_ids) > 0
        if not has_data:
            return []

        n = min(n_results, max(count, n_results))

        # 1. Dense semantic search via isolated subprocess (avoids SIGSEGV)
        dense = self._proxy.query(query, n, ["documents", "metadatas", "distances"])
        if dense is None:
            logger.warning("[RAG] dense search unavailable, falling back to FTS5-only")
            dense = {"ids": [[]], "distances": [[]], "metadatas": [[]], "documents": [[]]}

        # 1b. Supplemental document-only query so documents always surface
        if len(self._indexed_doc_ids) > 0:
            doc_count = min(n_results, len(self._indexed_doc_ids) * 2)
            doc_dense = self._proxy.query(
                query, doc_count,
                ["documents", "metadatas", "distances"],
                where={"source_type": "document"},
            )
            if doc_dense and doc_dense["ids"][0]:
                existing_ids = set(dense["ids"][0])
                for chunk_id, meta, doc, dist in zip(
                    doc_dense["ids"][0], doc_dense["metadatas"][0],
                    doc_dense["documents"][0], doc_dense["distances"][0],
                ):
                    if chunk_id not in existing_ids:
                        dense["ids"][0].append(chunk_id)
                        dense["metadatas"][0].append(meta)
                        dense["documents"][0].append(doc)
                        dense["distances"][0].append(dist)
                        existing_ids.add(chunk_id)

        dense_ids = dense["ids"][0]
        dense_distances = dense["distances"][0]
        id_to_meta = {i: m for i, m in zip(dense_ids, dense["metadatas"][0])}
        id_to_doc = {i: d for i, d in zip(dense_ids, dense["documents"][0])}
        id_to_dist = {i: d for i, d in zip(dense_ids, dense_distances)}

        email_to_dist: dict[str, float] = {}
        for chunk_id, dist in zip(dense_ids, dense_distances):
            eid = id_to_meta.get(chunk_id, {}).get("email_id", "")
            if eid:
                email_to_dist[eid] = min(email_to_dist.get(eid, 999.0), dist)

        # 2. Sparse full-text search via SQLite FTS5
        fts_summaries = self._cache.fts_search(query, limit=n)
        fts_email_ids = [s.id for s in fts_summaries]

        # 3. Separate dense results by source type (docs excluded from FTS5 RRF leg)
        dense_email_ids: List[str] = []
        dense_doc_ids: List[str] = []
        seen_dense: set[str] = set()
        for chunk_id in dense_ids:
            meta = id_to_meta.get(chunk_id, {})
            eid = meta.get("email_id", "")
            if not eid or eid in seen_dense:
                continue
            seen_dense.add(eid)
            if meta.get("source_type") == "document":
                dense_doc_ids.append(eid)
            else:
                dense_email_ids.append(eid)

        # 4. RRF emails, then interleave with docs at 2:1 ratio
        email_dates = {}
        for chunk_id in dense_ids:
            meta = id_to_meta.get(chunk_id, {})
            eid = meta.get("email_id", "")
            if eid and eid not in email_dates and meta.get("source_type") != "document":
                email_dates[eid] = meta.get("date", "")
        for s in fts_summaries:
            if s.id not in email_dates:
                email_dates[s.id] = getattr(s, "date", "") or ""
        merged_email_ids = self._rrf(
            dense_email_ids, fts_email_ids,
            email_dates=email_dates, time_weighted=time_weighted,
        )
        merged_ids: List[str] = []
        ei = di = 0
        while ei < len(merged_email_ids) or di < len(dense_doc_ids):
            for _ in range(2):
                if ei < len(merged_email_ids):
                    merged_ids.append(merged_email_ids[ei])
                    ei += 1
            if di < len(dense_doc_ids):
                merged_ids.append(dense_doc_ids[di])
                di += 1

        # 5. Build result objects (best chunk per email for preview)
        email_to_chunk: dict[str, tuple[str, dict]] = {}
        for chunk_id in dense_ids:
            meta = id_to_meta.get(chunk_id, {})
            eid = meta.get("email_id", "")
            if eid and eid not in email_to_chunk:
                email_to_chunk[eid] = (id_to_doc.get(chunk_id, ""), meta)

        fts_by_id = {s.id: s for s in fts_summaries}
        results: List[dict] = []
        seen: set[str] = set()
        for email_id in merged_ids:
            if email_id in seen:
                continue
            seen.add(email_id)
            if email_id in email_to_chunk:
                text, meta = email_to_chunk[email_id]
                is_doc = meta.get("source_type") == "document"
                if is_doc:
                    full_body = self._cache.get_document_body(email_id)
                    if full_body:
                        text = full_body
                entry = {
                    "email_id": email_id,
                    "source_type": meta.get("source_type", "email"),
                    "subject": meta.get("subject", ""),
                    "sender": meta.get("sender", ""),
                    "date": meta.get("date", ""),
                    "folder": meta.get("folder", ""),
                    "text": text,
                    "_distance": email_to_dist.get(email_id, 1.0),
                }
                if is_doc:
                    entry["filename"] = meta.get("filename", "")
                    entry["file_type"] = meta.get("file_type", "")
                    entry["file_path"] = meta.get("file_path", "")
                results.append(entry)
            elif email_id in fts_by_id:
                s = fts_by_id[email_id]
                results.append({
                    "email_id": email_id,
                    "source_type": "email",
                    "subject": s.subject,
                    "sender": s.sender,
                    "date": s.date or "",
                    "folder": "",
                    "text": s.preview,
                    "_distance": 0.45,
                })
            if len(results) >= n_results:
                break

        # Always append document FTS5 results (cap at 5 to avoid context bloat)
        query_words = query.strip().split()
        include_doc_fallback = (
            len(query_words) >= 2 or len(query_words[0]) > 5
        ) if query_words else False
        if include_doc_fallback:
            doc_fts = self._cache.fts_search_documents(query, limit=5)
            for d in doc_fts:
                if d["doc_id"] in seen:
                    continue
                seen.add(d["doc_id"])
                results.append({
                    "email_id": d["doc_id"],
                    "source_type": "document",
                    "subject": d["filename"],
                    "sender": "",
                    "date": "",
                    "folder": "",
                    "text": d["snippet"],
                    "filename": d["filename"],
                    "file_type": d["file_type"],
                    "file_path": d["file_path"],
                    "_distance": 0.5,
                })

        return results

    async def rerank_with_claude(
        self, target: EmailMessage, candidates: List[dict], top_n: int = 5
    ) -> List[dict]:
        """Cross-encoder re-ranking via Claude Haiku. May return fewer than top_n."""
        if not candidates:
            return []
        if len(candidates) <= top_n:
            return candidates

        pool = candidates[:15]
        listed = "\n".join(
            f"{i+1}. Subject: {c['subject']} | From: {c['sender']} | Date: {c['date']}\n"
            f"   Preview: {c['text'][:200]}"
            for i, c in enumerate(pool)
        )
        prompt = (
            f"TARGET EMAIL:\nSubject: {target.subject}\nFrom: {target.sender}\n"
            f"Preview: {(target.body or '')[:300]}\n\n"
            f"CANDIDATE EMAILS:\n{listed}\n\n"
            f"Return a JSON array of candidate numbers (1-indexed) that are GENUINELY "
            f"relevant to the target email, ordered best-first. Include at most {top_n}. "
            f"If a candidate is unrelated, do NOT include it. Return [] if none relevant. "
            f"Example: [3,1,2]"
        )
        try:
            resp = await self.ai.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=80,
                messages=[{"role": "user", "content": prompt}],
            )
            indices = json.loads(resp.content[0].text.strip())
            reranked = [
                pool[i - 1] for i in indices
                if isinstance(i, int) and 1 <= i <= len(pool)
            ]
            return reranked[:top_n]
        except Exception as e:
            logger.warning(f"[rerank] failed ({type(e).__name__}: {e}), using unranked")

        return candidates[:top_n]

    async def get_similar_emails(self, email: EmailMessage, n: int = 5) -> List[dict]:
        """Full pipeline: hybrid search → distance filter → Claude re-rank."""
        query = f"{email.subject} {(email.body or '')[:500]}"
        candidates = self.hybrid_search(query, n_results=25)
        candidates = [
            c for c in candidates
            if c["email_id"] != email.id
            and c.get("_distance", 1.0) <= self.SIMILARITY_THRESHOLD
        ]
        reranked = await self.rerank_with_claude(email, candidates, top_n=n)
        for r in reranked:
            r.pop("_distance", None)
        return reranked

    def semantic_search(self, query: str, n: int = 10) -> List[dict]:
        results = self.hybrid_search(query, n_results=n)
        for r in results:
            r.pop("_distance", None)
        return results
