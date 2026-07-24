"""
High-accuracy RAG engine — tuned for 100k emails / 300k vectors.

Dense search:  ChromaDB HNSW (BAAI/bge-large-en-v1.5, 1024-dim cosine)
Sparse search: SQLite FTS5 via EmailCache  ← replaces BM25 (no memory limit)
Fusion:        Reciprocal Rank Fusion (with time-weighted boost)
Re-ranking:    Claude Haiku cross-encoder

Why FTS5 instead of BM25:
  - BM25Okapi keeps the full tokenised corpus in RAM (≈2.2 GB at 300k docs)
  - SQLite FTS5 is disk-based, scales to millions of rows, already present
"""

import re
import logging
from pathlib import Path
from typing import TYPE_CHECKING, List

import chromadb
from models import EmailMessage
from services.rag_proxy import _RAGQueryProxy
from services.rag_retrieval import RAGRetrieval

if TYPE_CHECKING:
    from services.email_cache import EmailCache
    from services.ai_client import AIClient


logger = logging.getLogger(__name__)


class RAGEngine(RAGRetrieval):
    CHUNK_SIZE = 800
    CHUNK_OVERLAP = 150
    RRF_K = 60
    CHROMA_UPSERT_BATCH = 500

    def __init__(self, anthropic_client: "AIClient", cache: "EmailCache"):
        self.ai = anthropic_client
        self._cache = cache

        db_path = Path.home() / ".director-assistant" / "chromadb"
        db_path.mkdir(parents=True, exist_ok=True)

        class _NoOpEF:
            def __call__(self, input: list) -> list:
                return [[0.0] * 1024 for _ in input]

        self._chroma = chromadb.PersistentClient(path=str(db_path))
        self._col = self._chroma.get_or_create_collection(
            name="emails",
            embedding_function=_NoOpEF(),
            metadata={
                "hnsw:space": "cosine",
                "hnsw:M": 48,
                "hnsw:construction_ef": 256,
                "hnsw:search_ef": 128,
                "hnsw:batch_size": 2000,
                "hnsw:sync_threshold": 5000,
            },
        )

        self._indexed_email_ids: set[str] = set()
        self._indexed_doc_ids: dict[str, str] = {}
        self._load_indexed_ids()

        # Subprocess proxy: sole owner of HNSW index (avoids SIGSEGV + corruption)
        self._proxy = _RAGQueryProxy(str(db_path))

    # ── Startup ───────────────────────────────────────────────────────────────

    def _load_indexed_ids(self):
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
        text = re.sub(r'<(style|script)[^>]*>.*?</\1>', ' ', html, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
        text = re.sub(r'</?p[^>]*>', '\n', text, flags=re.IGNORECASE)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<') \
                   .replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'")
        text = re.sub(r'&[a-zA-Z]{2,6};', ' ', text)
        return re.sub(r'\s+', ' ', text).strip()

    @staticmethod
    def _is_garbage_body(text: str) -> bool:
        if not text or len(text) < 40:
            return False
        encoded_hits = len(re.findall(r'-[0-9A-F]{2}', text))
        return (encoded_hits * 3) / len(text) > 0.10

    def _clean_body(self, body: str) -> str:
        lines = []
        for line in body.splitlines():
            stripped = line.strip()
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
        return email_id in self._indexed_email_ids

    def ingest_email(self, email: EmailMessage, force: bool = False) -> bool:
        if not force and email.id in self._indexed_email_ids:
            return False

        chunks = self._make_chunks(email)
        ids, documents, metadatas = [], [], []
        for j, (text, chunk_meta) in enumerate(chunks):
            ids.append(f"{email.id}__c{j}")
            documents.append(text)
            metadatas.append({
                "email_id": email.id,
                "subject": email.subject or "",
                "sender": email.sender or "",
                "date": str(email.date) if email.date else "",
                "folder": email.folder or "INBOX",
                "thread_id": email.thread_id or "",
                "source_type": "email",
                **chunk_meta,
            })

        self._proxy.upsert(ids=ids, documents=documents, metadatas=metadatas)
        self._indexed_email_ids.add(email.id)
        return True

    def ingest_batch(self, emails: List[EmailMessage], _ignored_known_ids=None) -> int:
        """Batch upsert. _ignored_known_ids kept for call-site compatibility."""
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
                    "source_type": "email",
                    **chunk_meta,
                })

            self._indexed_email_ids.add(email.id)
            new_count += 1

            if len(all_ids) >= self.CHROMA_UPSERT_BATCH:
                self._proxy.upsert(ids=all_ids, documents=all_docs, metadatas=all_metas)
                all_ids, all_docs, all_metas = [], [], []

        if all_ids:
            self._proxy.upsert(ids=all_ids, documents=all_docs, metadatas=all_metas)

        return new_count

    def clear_email_vectors(self) -> int:
        """Drop and recreate the ChromaDB collection. Reclaims disk space."""
        count = len(self._indexed_email_ids)
        self._proxy.reset_collection()
        self._indexed_email_ids.clear()
        self._indexed_doc_ids.clear()
        return count

    def reindex_all_emails(self) -> int:
        self._indexed_email_ids.clear()
        total = 0
        for batch in self._cache.iter_all_emails(batch_size=200):
            total += self.ingest_batch(batch)
        return total

    def is_document_current(self, doc_id: str, mtime: str) -> bool:
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
        header = f"File: {filename}\nType: {file_type.upper()}"
        ids, documents, metadatas = [], [], []
        chunks = []
        i = 0
        while i < len(text):
            chunks.append(text[i: i + self.CHUNK_SIZE])
            i += self.CHUNK_SIZE - self.CHUNK_OVERLAP

        total = len(chunks)
        for j, segment in enumerate(chunks):
            ids.append(f"{doc_id}__c{j}")
            documents.append(f"{header}\n\n{segment}")
            metadatas.append({
                "doc_id": doc_id,
                "email_id": doc_id,
                "source_type": "document",
                "filename": filename,
                "file_path": file_path,
                "file_type": file_type,
                "modified_at": modified_at,
                "chunk_index": j,
                "chunk_total": total,
                "subject": filename,
                "sender": "",
                "date": "",
                "folder": "",
                "thread_id": "",
            })

        if ids:
            success = self._proxy.upsert(ids=ids, documents=documents, metadatas=metadatas)
            if success:
                self._indexed_doc_ids[doc_id] = modified_at
            self._cache.upsert_document_fts(
                doc_id=doc_id, filename=filename, file_type=file_type,
                file_path=file_path, modified_at=modified_at, body=text[:500_000],
            )
            return bool(success)
        return False

    def flush_bm25(self):
        """No-op — kept for call-site compatibility. BM25 replaced by FTS5."""
        pass

    def _known_ids(self) -> set[str]:
        return self._indexed_email_ids

    # ── Stats & contacts ──────────────────────────────────────────────────────

    def remove_email(self, email_id: str) -> bool:
        if email_id not in self._indexed_email_ids:
            return False
        existing = self._proxy.get(where={"email_id": email_id}, include=["metadatas"])
        if existing and existing.get("ids"):
            self._proxy.delete(ids=existing["ids"])
        self._indexed_email_ids.discard(email_id)
        return True

    def count_unique_emails(self) -> int:
        return len(self._indexed_email_ids)

    def count_unique_docs(self) -> int:
        return len(self._indexed_doc_ids)

    def list_indexed_docs(self) -> list[dict]:
        result = self._proxy.get(
            where={"source_type": "document"},
            include=["metadatas"],
        )
        if result is None:
            return []
        seen: dict[str, dict] = {}
        for m in (result.get("metadatas") or []):
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
            "total_chunks": self._proxy.count(),
            "unique_emails_indexed": len(self._indexed_email_ids),
            "unique_docs_indexed": len(self._indexed_doc_ids),
        }

    def ingest_contacts(self, cache) -> int:
        docs, ids, metas = [], [], []
        with cache._conn() as conn:
            for tbl, src_label in [("vip_contacts", "vip"), ("imported_contacts", "imported")]:
                try:
                    rows = conn.execute(
                        f"SELECT email_addr, name, note FROM {tbl} WHERE note IS NOT NULL AND trim(note) != ''"
                    ).fetchall()
                    for r in rows:
                        email = (r["email_addr"] or "").lower()
                        name = r["name"] or ""
                        note = r["note"] or ""
                        cid = f"contact__{email}"
                        text = f"Contact: {name} <{email}>\nSource: {src_label}\nNotes: {note}"
                        docs.append(text)
                        ids.append(cid)
                        metas.append({
                            "email_id": cid,
                            "source_type": "contact",
                            "contact_email": email,
                            "contact_name": name,
                            "contact_source": src_label,
                            "subject": f"Contact: {name}",
                            "sender": email,
                            "date": "",
                        })
                except Exception:
                    pass
        if docs:
            self._proxy.upsert(ids=ids, documents=docs, metadatas=metas)
        return len(docs)

    def ingest_contact(self, email_addr: str, name: str, note: str, source: str = "imported") -> None:
        if not note or not note.strip():
            return
        email = email_addr.lower()
        cid = f"contact__{email}"
        text = f"Contact: {name} <{email}>\nSource: {source}\nNotes: {note}"
        self._proxy.upsert(
            ids=[cid],
            documents=[text],
            metadatas=[{
                "email_id": cid,
                "source_type": "contact",
                "contact_email": email,
                "contact_name": name,
                "contact_source": source,
                "subject": f"Contact: {name}",
                "sender": email,
                "date": "",
            }],
        )
