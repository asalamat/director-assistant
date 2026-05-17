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
import multiprocessing
from pathlib import Path
from typing import TYPE_CHECKING, List, Optional

import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
from models import EmailMessage

if TYPE_CHECKING:
    from services.email_cache import EmailCache
    from services.ai_client import AIClient

logger = logging.getLogger(__name__)


class _RAGQueryProxy:
    """
    Runs ChromaDB vector queries in a dedicated spawned subprocess.
    Prevents the SIGSEGV from hnswlib/loky on Python 3.13 from killing uvicorn.
    Falls back gracefully (FTS5-only) while the worker loads, or if it crashes.
    Worker initializes in a background thread so server startup is not blocked.
    """
    _STARTUP_TIMEOUT = 120  # seconds — first run downloads/loads the 1.3 GB model
    _QUERY_TIMEOUT   = 8    # seconds per query — fall back to FTS5 quickly if worker is slow

    def __init__(self, db_path: str):
        self._db_path = db_path
        self._proc: Optional[multiprocessing.Process] = None
        self._req_q = None
        self._resp_q = None
        self._available = False
        self._starting = False   # prevents concurrent restarts
        import threading
        self._lock = threading.Lock()
        # Start in background — server startup is not blocked
        threading.Thread(target=self._start, daemon=True, name="rag-proxy-init").start()

    def _start(self):
        with self._lock:
            if self._starting:
                return
            self._starting = True
        try:
            from services.rag_worker import worker_main
            ctx = multiprocessing.get_context("spawn")
            req_q = ctx.Queue()
            resp_q = ctx.Queue()
            proc = ctx.Process(
                target=worker_main,
                args=(self._db_path, req_q, resp_q),
                daemon=True,
            )
            proc.start()
            msg = resp_q.get(timeout=self._STARTUP_TIMEOUT)
            if msg.get("ready"):
                self._req_q = req_q
                self._resp_q = resp_q
                self._proc = proc
                self._available = True
                logger.info("[RAG proxy] worker ready — dense search active")
            else:
                logger.warning(f"[RAG proxy] worker init failed: {msg.get('error')}")
        except Exception as e:
            self._available = False
            logger.warning(f"[RAG proxy] worker init error: {e}")
        finally:
            with self._lock:
                self._starting = False

    def _ensure_alive(self):
        if self._proc and not self._proc.is_alive():
            self._available = False
            with self._lock:
                restarting = self._starting
            if not restarting:
                logger.warning("[RAG proxy] worker died — restarting in background")
                import threading
                threading.Thread(target=self._start, daemon=True, name="rag-proxy-restart").start()

    def query(self, query_text: str, n_results: int,
              include: list) -> Optional[dict]:
        self._ensure_alive()
        if not self._available:
            return None
        self._req_q.put({"cmd": "query", "query": query_text,
                         "n_results": n_results, "include": include})
        try:
            resp = self._resp_q.get(timeout=self._QUERY_TIMEOUT)
            if resp.get("ok"):
                return resp["result"]
            logger.warning(f"[RAG proxy] query error: {resp.get('error')}")
        except Exception as e:
            logger.warning(f"[RAG proxy] query timeout/error: {e}")
        return None

    def count(self) -> int:
        self._ensure_alive()
        if not self._available:
            return 0
        self._req_q.put({"cmd": "count"})
        try:
            resp = self._resp_q.get(timeout=10)
            if resp.get("ok"):
                return resp["count"]
        except Exception:
            pass
        return 0

    def shutdown(self):
        if self._req_q:
            try:
                self._req_q.put(None)
            except Exception:
                pass
        if self._proc and self._proc.is_alive():
            self._proc.join(timeout=3)
            if self._proc.is_alive():
                self._proc.kill()


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
        self._col = self._chroma.get_or_create_collection(  # noqa: E501 (used for upsert/delete/get — not queries)
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

        # O(1) membership checks — built once at startup, maintained incrementally.
        self._indexed_email_ids: set[str] = set()
        self._indexed_doc_ids: dict[str, str] = {}   # doc_id -> mtime
        self._load_indexed_ids()

        # Subprocess proxy for vector queries — avoids SIGSEGV on Python 3.13 + hnswlib
        self._proxy = _RAGQueryProxy(str(db_path))

    # ── Startup ───────────────────────────────────────────────────────────────

    def _load_indexed_ids(self):
        """Build in-memory ID sets from ChromaDB metadata. Called once at startup."""
        result = self._col.get(include=["metadatas"])
        for m in (result["metadatas"] or []):
            src = m.get("source_type", "email")
            if src == "document":
                doc_id = m.get("doc_id", "")
                if doc_id:
                    self._indexed_doc_ids[doc_id] = m.get("modified_at", "")
            else:
                eid = m.get("email_id", "")
                if eid:
                    self._indexed_email_ids.add(eid)
        self._indexed_email_ids.discard("")
        logger.info(
            f"[RAG] loaded {len(self._indexed_email_ids)} emails, "
            f"{len(self._indexed_doc_ids)} documents"
        )

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

    def is_document_current(self, doc_id: str, mtime: str) -> bool:
        """True if this exact doc version is already indexed."""
        return self._indexed_doc_ids.get(doc_id) == mtime

    def ingest_document(
        self,
        doc_id: str,
        text: str,
        filename: str,
        file_path: str,
        file_type: str,
        modified_at: str,
    ) -> bool:
        """Chunk and index a document. Returns True if newly added/updated."""
        # Delete stale chunks if file was updated
        if doc_id in self._indexed_doc_ids:
            existing = self._col.get(where={"doc_id": doc_id})
            if existing and existing.get("ids"):
                self._col.delete(ids=existing["ids"])

        header = f"File: {filename}\nType: {file_type.upper()}"
        chunks, ids, documents, metadatas = [], [], [], []

        i = 0
        while i < len(text):
            segment = text[i: i + self.CHUNK_SIZE]
            chunks.append(segment)
            i += self.CHUNK_SIZE - self.CHUNK_OVERLAP

        total = len(chunks)
        for j, segment in enumerate(chunks):
            chunk_id = f"{doc_id}__c{j}"
            ids.append(chunk_id)
            documents.append(f"{header}\n\n{segment}")
            metadatas.append({
                "doc_id": doc_id,
                "email_id": doc_id,   # reuse field so search pipeline works unchanged
                "source_type": "document",
                "filename": filename,
                "file_path": file_path,
                "file_type": file_type,
                "modified_at": modified_at,
                "chunk_index": j,
                "chunk_total": total,
                # stub email fields so result-building code doesn't key-error
                "subject": filename,
                "sender": "",
                "date": "",
                "folder": "",
                "thread_id": "",
            })

        if ids:
            self._col.upsert(ids=ids, documents=documents, metadatas=metadatas)
            self._indexed_doc_ids[doc_id] = modified_at
        return True

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

        # 1. Dense semantic search — runs in isolated subprocess to prevent SIGSEGV
        dense = self._proxy.query(query, n, ["documents", "metadatas", "distances"])
        if dense is None:
            # Proxy unavailable or crashed — use empty dense results, FTS5 still runs
            logger.warning("[RAG] dense search unavailable, falling back to FTS5-only")
            dense = {"ids": [[]], "distances": [[]], "metadatas": [[]], "documents": [[]]}

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
                if meta.get("source_type") == "document":
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

    def count_unique_docs(self) -> int:
        return len(self._indexed_doc_ids)

    def list_indexed_docs(self) -> list[dict]:
        """Return metadata for all indexed documents."""
        result = self._col.get(
            where={"source_type": "document"},
            include=["metadatas"],
        )
        seen: dict[str, dict] = {}
        for m in (result["metadatas"] or []):
            doc_id = m.get("doc_id", "")
            if doc_id and doc_id not in seen:
                seen[doc_id] = {
                    "doc_id": doc_id,
                    "filename": m.get("filename", ""),
                    "file_type": m.get("file_type", ""),
                    "file_path": m.get("file_path", ""),
                    "modified_at": m.get("modified_at", ""),
                    "chunk_total": m.get("chunk_total", 1),
                }
        return list(seen.values())

    def stats(self) -> dict:
        return {
            "total_chunks": self._col.count(),
            "unique_emails_indexed": len(self._indexed_email_ids),
            "unique_docs_indexed": len(self._indexed_doc_ids),
        }
