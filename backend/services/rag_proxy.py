"""
ChromaDB subprocess proxy — prevents hnswlib SIGSEGV on Python 3.13.

Runs all vector queries and writes in a dedicated spawned subprocess so a
crash in the worker never kills uvicorn. Falls back to FTS5-only search
while the worker loads or if it dies.
"""
import logging
import multiprocessing
from typing import Optional

logger = logging.getLogger(__name__)


class _RAGQueryProxy:
    """
    Runs ChromaDB vector queries in a dedicated spawned subprocess.
    Prevents the SIGSEGV from hnswlib/loky on Python 3.13 from killing uvicorn.
    Falls back gracefully (FTS5-only) while the worker loads, or if it crashes.
    Worker initializes in a background thread so server startup is not blocked.
    """
    _STARTUP_TIMEOUT = 300  # seconds — first run downloads/loads the 1.3 GB model
    _QUERY_TIMEOUT   = 8    # seconds per query — fall back to FTS5 quickly if worker is slow
    _UPSERT_TIMEOUT  = 300  # seconds — large batch embedding can take several minutes

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
            try:
                msg = resp_q.get(timeout=self._STARTUP_TIMEOUT)
                if msg.get("ready"):
                    self._req_q = req_q
                    self._resp_q = resp_q
                    self._proc = proc
                    self._available = True
                    logger.info("[RAG proxy] worker ready — dense search active")
                else:
                    logger.warning(f"[RAG proxy] worker init failed: {msg.get('error')}")
            except Exception:
                # Timed out — worker may still be loading (large HNSW index).
                # Keep refs so _wait_available can poll for the delayed ready message.
                if proc.is_alive():
                    self._req_q = req_q
                    self._resp_q = resp_q
                    self._proc = proc
                    logger.warning(
                        "[RAG proxy] worker slow to start — will poll for delayed ready"
                    )
                else:
                    logger.warning("[RAG proxy] worker died during startup")
        except Exception as e:
            logger.warning(f"[RAG proxy] worker spawn error: {e}")
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
            return
        # Worker running but startup timed out — drain the delayed ready message.
        if self._proc and not self._available and self._resp_q is not None:
            try:
                msg = self._resp_q.get_nowait()
                if msg.get("ready"):
                    self._available = True
                    logger.info("[RAG proxy] worker ready (delayed) — dense search active")
                else:
                    self._resp_q.put_nowait(msg)  # put back non-ready messages
            except Exception:
                pass

    def query(self, query_text: str, n_results: int,
              include: list, where: Optional[dict] = None) -> Optional[dict]:
        self._ensure_alive()
        if not self._available:
            return None
        req: dict = {"cmd": "query", "query": query_text,
                     "n_results": n_results, "include": include}
        if where:
            req["where"] = where
        self._req_q.put(req)
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

    def _wait_available(self, timeout: float = 120.0) -> bool:
        """Block until the worker is ready, up to timeout seconds."""
        import time
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._available:
                return True
            if self._proc and self._proc.is_alive() and self._resp_q:
                try:
                    msg = self._resp_q.get(timeout=1.0)
                    if msg.get("ready"):
                        self._available = True
                        logger.info("[RAG proxy] worker ready (delayed) — dense search active")
                        return True
                    else:
                        logger.warning(f"[RAG proxy] worker init failed: {msg.get('error')}")
                        return False
                except Exception:
                    pass
            else:
                time.sleep(0.5)
        return False

    def upsert(self, ids: list, documents: list, metadatas: list) -> bool:
        """Send an upsert command to the worker. Blocks until the worker is ready."""
        if not self._wait_available(self._STARTUP_TIMEOUT):
            logger.warning("[RAG proxy] upsert: worker not available — skipping")
            return False
        self._req_q.put({"cmd": "upsert", "ids": ids,
                         "documents": documents, "metadatas": metadatas})
        try:
            resp = self._resp_q.get(timeout=self._UPSERT_TIMEOUT)
            if resp.get("ok"):
                return True
            logger.warning(f"[RAG proxy] upsert error: {resp.get('error')}")
        except Exception as e:
            logger.warning(f"[RAG proxy] upsert timeout/error: {e}")
        return False

    def delete(self, ids: list) -> bool:
        if not self._wait_available(self._STARTUP_TIMEOUT):
            logger.warning("[RAG proxy] delete: worker not available — skipping")
            return False
        self._req_q.put({"cmd": "delete", "ids": ids})
        try:
            resp = self._resp_q.get(timeout=30)
            return bool(resp.get("ok"))
        except Exception as e:
            logger.warning(f"[RAG proxy] delete error: {e}")
        return False

    def delete_where(self, where: dict) -> bool:
        if not self._wait_available(self._STARTUP_TIMEOUT):
            logger.warning("[RAG proxy] delete_where: worker not available — skipping")
            return False
        self._req_q.put({"cmd": "delete_where", "where": where})
        try:
            resp = self._resp_q.get(timeout=60)
            return bool(resp.get("ok"))
        except Exception as e:
            logger.warning(f"[RAG proxy] delete_where error: {e}")
        return False

    def get(self, where: Optional[dict] = None, include: Optional[list] = None) -> Optional[dict]:
        """Fetch metadata/documents from the collection via the worker."""
        self._ensure_alive()
        if not self._available:
            return None
        req: dict = {"cmd": "get"}
        if where:
            req["where"] = where
        if include is not None:
            req["include"] = include
        self._req_q.put(req)
        try:
            resp = self._resp_q.get(timeout=30)
            if resp.get("ok"):
                return resp["result"]
            logger.warning(f"[RAG proxy] get error: {resp.get('error')}")
        except Exception as e:
            logger.warning(f"[RAG proxy] get timeout/error: {e}")
        return None

    def reset_collection(self) -> bool:
        if not self._wait_available(self._STARTUP_TIMEOUT):
            logger.warning("[RAG proxy] reset_collection: worker not available — skipping")
            return False
        self._req_q.put({"cmd": "reset_collection"})
        try:
            resp = self._resp_q.get(timeout=120)
            return bool(resp.get("ok"))
        except Exception as e:
            logger.warning(f"[RAG proxy] reset_collection error: {e}")
        return False

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
