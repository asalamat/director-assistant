"""
High-accuracy RAG engine — tuned for 100k emails / 300k vectors.

Dense search:  ChromaDB HNSW (BAAI/bge-large-en-v1.5, 1024-dim cosine)
Sparse search: SQLite FTS5 via EmailCache  ← replaces BM25 (no memory limit)
Fusion:        Reciprocal Rank Fusion
Re-ranking:    Claude Haiku cross-encoder

Why FTS5 instead of BM25:
  - BM25Okapi keeps the full tokenised corpus in RAM (≈2.2 GB at 300k docs)
  - SQLite FTS5 is disk-based, scales to millions of rows, already present
"""

import re
import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, List, Optional

import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
from models import EmailMessage

if TYPE_CHECKING:
    from services.email_cache import EmailCache
    from services.ai_client import AIClient

logger = logging.getLogger(__name__)


class RAGEngine:
    CHUNK_SIZE = 800
    CHUNK_OVERLAP = 150
    RRF_K = 60
    CHROMA_UPSERT_BATCH = 500   # vectors per ChromaDB upsert call

    def __init__(self, anthropic_client: "AIClient", cache: "EmailCache"):
        self.ai = anthropic_client
        self._cache = cache   # used for FTS5 sparse search

        db_path = Path.home() / ".director-assistant" / "chromadb"
        db_path.mkdir(parents=True, exist_ok=True)

        self._embedding_fn = SentenceTransformerEmbeddingFunction(
            model_name="BAAI/bge-large-en-v1.5"
        )
        self._chroma = chromadb.PersistentClient(path=str(db_path))
        self._col = self._chroma.get_or_create_collection(
            name="emails",
            embedding_function=self._embedding_fn,
            metadata={
                "hnsw:space": "cosine",
                # Tuned for 300k vectors (100k emails × ~3 chunks)
                "hnsw:M": 48,
                "hnsw:construction_ef": 256,
                "hnsw:search_ef": 128,
                "hnsw:batch_size": 2000,
                "hnsw:sync_threshold": 5000,
            },
        )

        # O(1) membership check — built once from ChromaDB at startup
        # then maintained incrementally. Never triggers a full collection scan.
        self._indexed_email_ids: set[str] = set()
        self._load_indexed_ids()

    # ── Startup ───────────────────────────────────────────────────────────────

    def _load_indexed_ids(self):
        """Build in-memory ID set from ChromaDB metadata. Called once at startup."""
        result = self._col.get(include=["metadatas"])
        self._indexed_email_ids = {
            m.get("email_id", "") for m in (result["metadatas"] or [])
        }
        self._indexed_email_ids.discard("")
        logger.info(f"[RAG] loaded {len(self._indexed_email_ids)} indexed email IDs")

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _html_to_text(self, html: str) -> str:
        # Drop entire style/script blocks
        text = re.sub(r'<(style|script)[^>]*>.*?</\1>', ' ', html, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
        text = re.sub(r'</?p[^>]*>', '\n', text, flags=re.IGNORECASE)
        text = re.sub(r'<[^>]+>', ' ', text)
        # Decode common HTML entities
        text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<') \
                   .replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'")
        text = re.sub(r'&[a-zA-Z]{2,6};', ' ', text)
        return re.sub(r'\s+', ' ', text).strip()

    @staticmethod
    def _is_garbage_body(text: str) -> bool:
        """Return True when the plain-text body is mostly URL-encoded tracking junk."""
        if not text or len(text) < 40:
            return False
        # Count URL-encoded sequences like -2B, -2F (Salesforce/ExactTarget links)
        encoded_hits = len(re.findall(r'-[0-9A-F]{2}', text))
        # If more than 10% of characters are part of these sequences it's garbage
        return (encoded_hits * 3) / len(text) > 0.10

    def _clean_body(self, body: str) -> str:
        """Strip URL-encoded garbage lines and normalize whitespace."""
        lines = []
        for line in body.splitlines():
            stripped = line.strip()
            # Skip lines that are mostly URL-encoded junk
            if stripped and not self._is_garbage_body(stripped):
                lines.append(stripped)
        return "\n".join(lines).strip()

    def _make_chunks(self, email: EmailMessage) -> List[tuple[str, dict]]:
        header = (
            f"Subject: {email.subject}\n"
            f"From: {email.sender}\n"
            f"Date: {email.date}"
        )
        body = email.body or ""

        # Fall back to HTML if plain body is missing or garbage
        if not body or self._is_garbage_body(body):
            if email.body_html:
                body = self._html_to_text(email.body_html)
            elif body:
                body = self._clean_body(body)

        if body:
            body = self._clean_body(body)

        if not body:
            return [(header, {"chunk_index": 0, "chunk_total": 1})]

        chunks = []
        i = 0
        while i < len(body):
            segment = body[i: i + self.CHUNK_SIZE]
            chunks.append((f"{header}\n\n{segment}", {}))
            i += self.CHUNK_SIZE - self.CHUNK_OVERLAP

        total = len(chunks)
        return [
            (text, {"chunk_index": j, "chunk_total": total})
            for j, (text, _) in enumerate(chunks)
        ]

    # ── Indexing ──────────────────────────────────────────────────────────────

    def is_ingested(self, email_id: str) -> bool:
        """O(1) set membership — no ChromaDB round-trip."""
        return email_id in self._indexed_email_ids

    def ingest_email(self, email: EmailMessage, force: bool = False) -> bool:
        """Ingest one email. Returns True if newly added."""
        if not force and email.id in self._indexed_email_ids:
            return False

        chunks = self._make_chunks(email)
        ids, documents, metadatas = [], [], []

        for j, (text, chunk_meta) in enumerate(chunks):
            doc_id = f"{email.id}__c{j}"
            ids.append(doc_id)
            documents.append(text)
            metadatas.append({
                "email_id": email.id,
                "subject": email.subject or "",
                "sender": email.sender or "",
                "date": str(email.date) if email.date else "",
                "folder": email.folder or "INBOX",
                "thread_id": email.thread_id or "",
                **chunk_meta,
            })

        self._col.upsert(ids=ids, documents=documents, metadatas=metadatas)
        self._indexed_email_ids.add(email.id)
        return True

    def ingest_batch(self, emails: List[EmailMessage], _ignored_known_ids=None) -> int:
        """Batch upsert — uses the in-memory ID set for skip detection.
        Returns count of newly added emails.
        _ignored_known_ids kept for call-site compatibility but is unused.
        """
        all_ids, all_docs, all_metas = [], [], []
        new_count = 0

        for email in emails:
            if email.id in self._indexed_email_ids:
                continue

            chunks = self._make_chunks(email)
            for j, (text, chunk_meta) in enumerate(chunks):
                all_ids.append(f"{email.id}__c{j}")
                all_docs.append(text)
                all_metas.append({
                    "email_id": email.id,
                    "subject": email.subject or "",
                    "sender": email.sender or "",
                    "date": str(email.date) if email.date else "",
                    "folder": email.folder or "INBOX",
                    "thread_id": email.thread_id or "",
                    **chunk_meta,
                })

            self._indexed_email_ids.add(email.id)
            new_count += 1

            # Flush to ChromaDB in batches to avoid memory spikes
            if len(all_ids) >= self.CHROMA_UPSERT_BATCH:
                self._col.upsert(ids=all_ids, documents=all_docs, metadatas=all_metas)
                all_ids, all_docs, all_metas = [], [], []

        if all_ids:
            self._col.upsert(ids=all_ids, documents=all_docs, metadatas=all_metas)

        return new_count

    def flush_bm25(self):
        """No-op — kept for call-site compatibility. BM25 replaced by FTS5."""
        pass

    def _known_ids(self) -> set[str]:
        """Return in-memory ID set — O(1), no ChromaDB scan."""
        return self._indexed_email_ids

    # ── Retrieval ─────────────────────────────────────────────────────────────

    def _rrf(self, *ranked_lists: List[str]) -> List[str]:
        scores: dict[str, float] = {}
        for ranked in ranked_lists:
            for rank, id_ in enumerate(ranked):
                scores[id_] = scores.get(id_, 0.0) + 1.0 / (self.RRF_K + rank + 1)
        return sorted(scores, key=lambda x: scores[x], reverse=True)

    # Cosine distance threshold: 0 = identical, 1 = orthogonal.
    # Candidates with distance > this value are excluded before reranking.
    SIMILARITY_THRESHOLD = 0.50

    def hybrid_search(self, query: str, n_results: int = 20) -> List[dict]:
        """Dense (ChromaDB) + Sparse (SQLite FTS5), fused with RRF."""
        count = self._col.count()
        if count == 0:
            return []

        n = min(n_results, count)

        # 1. Dense semantic search
        dense = self._col.query(
            query_texts=[query],
            n_results=n,
            include=["documents", "metadatas", "distances"],
        )
        dense_ids = dense["ids"][0]
        dense_distances = dense["distances"][0]
        id_to_meta = {i: m for i, m in zip(dense_ids, dense["metadatas"][0])}
        id_to_doc = {i: d for i, d in zip(dense_ids, dense["documents"][0])}
        id_to_dist = {i: d for i, d in zip(dense_ids, dense_distances)}

        # Track best (lowest) distance per email_id
        email_to_dist: dict[str, float] = {}
        for chunk_id, dist in zip(dense_ids, dense_distances):
            eid = id_to_meta.get(chunk_id, {}).get("email_id", "")
            if eid:
                email_to_dist[eid] = min(email_to_dist.get(eid, 999.0), dist)

        # 2. Sparse full-text search via SQLite FTS5 (disk-based, no memory limit)
        fts_summaries = self._cache.fts_search(query, limit=n)
        fts_email_ids = [s.id for s in fts_summaries]

        # 3. Collect dense email_ids in order
        dense_email_ids: List[str] = []
        seen_dense: set[str] = set()
        for chunk_id in dense_ids:
            eid = id_to_meta.get(chunk_id, {}).get("email_id", "")
            if eid and eid not in seen_dense:
                dense_email_ids.append(eid)
                seen_dense.add(eid)

        # 4. RRF on email_ids (not chunk_ids)
        merged_email_ids = self._rrf(dense_email_ids, fts_email_ids)

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
        for email_id in merged_email_ids:
            if email_id in seen:
                continue
            seen.add(email_id)

            if email_id in email_to_chunk:
                text, meta = email_to_chunk[email_id]
                results.append({
                    "email_id": email_id,
                    "subject": meta.get("subject", ""),
                    "sender": meta.get("sender", ""),
                    "date": meta.get("date", ""),
                    "folder": meta.get("folder", ""),
                    "text": text,
                    "_distance": email_to_dist.get(email_id, 1.0),
                })
            elif email_id in fts_by_id:
                s = fts_by_id[email_id]
                # FTS-only hits get a conservative distance so they aren't
                # promoted ahead of strong dense matches but still appear
                results.append({
                    "email_id": email_id,
                    "subject": s.subject,
                    "sender": s.sender,
                    "date": s.date or "",
                    "folder": "",
                    "text": s.preview,
                    "_distance": 0.45,  # treat as moderate relevance
                })

            if len(results) >= n_results:
                break

        return results

    async def rerank_with_claude(
        self, target: EmailMessage, candidates: List[dict], top_n: int = 5
    ) -> List[dict]:
        """Cross-encoder re-ranking via Claude Haiku.
        Returns only genuinely relevant results — may return fewer than top_n.
        """
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
            f"If a candidate is unrelated, do NOT include it — accuracy matters more than "
            f"filling the list. Return [] if none are relevant. Example: [3,1,2]"
        )
        try:
            resp = await self.ai.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=80,
                messages=[{"role": "user", "content": prompt}],
            )
            indices = json.loads(resp.content[0].text.strip())
            reranked = [pool[i - 1] for i in indices if isinstance(i, int) and 1 <= i <= len(pool)]
            return reranked[:top_n]
        except Exception as e:
            logger.warning(f"[rerank] Claude rerank failed ({type(e).__name__}: {e}), using unranked results")

        return candidates[:top_n]

    async def get_similar_emails(self, email: EmailMessage, n: int = 5) -> List[dict]:
        """Full pipeline: hybrid search → distance filter → Claude re-rank."""
        query = f"{email.subject} {(email.body or '')[:500]}"
        candidates = self.hybrid_search(query, n_results=25)

        # Exclude the email itself and those with too-low similarity
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

    # ── Stats ─────────────────────────────────────────────────────────────────

    def remove_email(self, email_id: str) -> bool:
        """Delete all chunks for an email from ChromaDB and the ID set."""
        if email_id not in self._indexed_email_ids:
            return False
        existing = self._col.get(where={"email_id": email_id})
        if existing and existing.get("ids"):
            self._col.delete(ids=existing["ids"])
        self._indexed_email_ids.discard(email_id)
        return True

    def count_unique_emails(self) -> int:
        return len(self._indexed_email_ids)

    def stats(self) -> dict:
        return {
            "total_chunks": self._col.count(),
            "unique_emails_indexed": len(self._indexed_email_ids),
        }
