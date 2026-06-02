"""
Document FTS search mixin — extracted from EmailCache to keep file size under 500 lines.
Provides upsert/delete/search over the documents_fts / documents_fts_store tables.
"""
import logging
import re

logger = logging.getLogger(__name__)


class DocumentCacheMixin:
    """Mixin for EmailCache: document FTS5 indexing and search."""

    def upsert_document_fts(self, doc_id: str, filename: str, file_type: str,
                            file_path: str, modified_at: str, body: str) -> None:
        """Index document text into the FTS5 table for keyword search."""
        with self._conn() as conn:
            existing = conn.execute(
                "SELECT rowid FROM documents_fts_store WHERE doc_id = ?", (doc_id,)
            ).fetchone()
            if existing:
                rowid = existing[0]
                # Properly delete old FTS entry before updating (preserves rowid)
                conn.execute(
                    "INSERT INTO documents_fts(documents_fts, rowid, doc_id, filename, body) "
                    "VALUES('delete', ?, ?, ?, ?)",
                    (rowid, doc_id, filename, body),
                )
                conn.execute(
                    "UPDATE documents_fts_store SET filename=?, file_type=?, file_path=?, "
                    "modified_at=?, body=? WHERE doc_id=?",
                    (filename, file_type, file_path, modified_at, body, doc_id),
                )
                conn.execute(
                    "INSERT INTO documents_fts(rowid, doc_id, filename, body) VALUES(?, ?, ?, ?)",
                    (rowid, doc_id, filename, body),
                )
            else:
                conn.execute("""
                    INSERT INTO documents_fts_store
                        (doc_id, filename, file_type, file_path, modified_at, body)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (doc_id, filename, file_type, file_path, modified_at, body))
                rowid = conn.execute(
                    "SELECT rowid FROM documents_fts_store WHERE doc_id = ?", (doc_id,)
                ).fetchone()[0]
                conn.execute(
                    "INSERT INTO documents_fts(rowid, doc_id, filename, body) VALUES(?, ?, ?, ?)",
                    (rowid, doc_id, filename, body),
                )

    def delete_document_fts(self, doc_id: str) -> None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT rowid FROM documents_fts_store WHERE doc_id = ?", (doc_id,)
            ).fetchone()
            if row:
                conn.execute(
                    "INSERT INTO documents_fts(documents_fts, rowid, doc_id, filename, body) "
                    "SELECT 'delete', rowid, doc_id, filename, body "
                    "FROM documents_fts_store WHERE doc_id = ?", (doc_id,)
                )
                conn.execute("DELETE FROM documents_fts_store WHERE doc_id = ?", (doc_id,))

    def fts_search_documents(self, query: str, limit: int = 10) -> list[dict]:
        """Keyword search over indexed document content. Returns list of dicts."""
        safe = re.sub(r'[^\w\s]', ' ', query)
        safe = ' '.join(safe.split()[:20])
        if not safe:
            return []

        def _run_query(conn):
            return conn.execute(
                """SELECT s.doc_id, s.filename, s.file_type, s.file_path,
                          s.modified_at, s.body
                   FROM documents_fts_store s
                   JOIN documents_fts ON documents_fts.doc_id = s.doc_id
                   WHERE documents_fts MATCH ?
                   ORDER BY rank LIMIT ?""",
                (safe, limit),
            ).fetchall()

        try:
            with self._conn() as conn:
                try:
                    rows = _run_query(conn)
                except Exception:
                    # FTS5 index out of sync — rebuild and retry once
                    conn.execute("INSERT INTO documents_fts(documents_fts) VALUES('rebuild')")
                    rows = _run_query(conn)
            return [
                {"doc_id": r[0], "filename": r[1], "file_type": r[2],
                 "file_path": r[3], "modified_at": r[4], "snippet": (r[5] or "")}
                for r in rows
            ]
        except Exception as e:
            logger.warning("[cache] search_documents failed: %s", e)
            return []

    def get_document_body(self, doc_id: str) -> str:
        """Return the full extracted body text for a document, or empty string."""
        try:
            with self._conn() as conn:
                row = conn.execute(
                    "SELECT body FROM documents_fts_store WHERE doc_id = ?", (doc_id,)
                ).fetchone()
                return row[0] if row else ""
        except Exception as e:
            logger.warning("[cache] get_document_body failed: %s", e)
            return ""
