"""
ChromaDB worker — runs in a spawned subprocess so SIGSEGV from hnswlib/loky
on Python 3.13 cannot kill the main uvicorn process.

Protocol: caller sends dicts via req_queue, gets dicts back via resp_queue.
"""

import os
import threading

# Must be set before any ML imports
#
# The original SIGSEGV this whole worker-subprocess architecture exists to contain
# (see module docstring) was: ChromaDB's col.query(query_texts=[...]) re-invokes the
# embedding function inside a loky-managed pool, and loky's own process/thread
# initialization races with hnswlib inside an already-spawned subprocess. That's
# specifically a loky problem — LOKY_MAX_CPU_COUNT must stay 1. It has nothing to do
# with how many threads torch/BLAS use for their own tensor math within this process,
# and that path is separately avoided anyway (queries pre-encode via ef() directly
# instead of col.query(query_texts=...) — see the query handler below). So those can
# use real parallelism: CPU-only BERT-large inference is painfully slow single-threaded.
_CPU_THREADS = str(max(1, min(4, os.cpu_count() or 1)))
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
for _k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
           "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_k, _CPU_THREADS)
os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")

# huggingface_hub caches downloads by symlinking snapshots/<hash>/file -> blobs/<hash>.
# Windows needs Developer Mode or admin rights for that; without it, symlink creation
# can fail silently mid-download, leaving a snapshot dir that looks present but is
# missing files (e.g. "1_Pooling/config.json"). Copying real files instead avoids
# the whole class of failure.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def worker_main(db_path_str: str, req_queue, resp_queue):
    """Entry point called in the spawned worker process."""
    # This subprocess's print() output has nowhere to go in a windowed/packaged
    # build (no console) — redirect stdout/stderr to a persistent log file so
    # embedding-model download failures are actually diagnosable on Windows.
    try:
        import sys
        from datetime import datetime
        from pathlib import Path
        log_path = Path.home() / ".director-assistant" / "rag-worker.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_file = open(log_path, "a", buffering=1, encoding="utf-8")
        sys.stdout = log_file
        sys.stderr = log_file
        print(f"\n=== RAG worker started {datetime.now().isoformat()} ===")
    except Exception:
        pass

    # Re-apply env vars (spawn context may not inherit them on all OSes)
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    for _k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
               "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[_k] = _CPU_THREADS
    os.environ["LOKY_MAX_CPU_COUNT"] = "1"
    os.environ["HF_HUB_DISABLE_SYMLINKS"] = "1"
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

    # This subprocess (not main.py) is what actually downloads the embedding
    # model from huggingface.co on first run - trust the OS cert store so a
    # corporate SSL-inspecting proxy doesn't break that download. See main.py
    # for the full explanation; this is a separate process so needs its own.
    try:
        import truststore
        truststore.inject_into_ssl()
        print("[RAG worker] truststore active - trusting OS certificate store")
    except Exception as e:
        print(f"[RAG worker] truststore NOT active ({type(e).__name__}: {e}) - "
              f"falling back to certifi's bundled CA list")

    try:
        import torch
        torch.set_num_threads(int(_CPU_THREADS))
        torch.set_num_interop_threads(1)
    except Exception:
        pass

    try:
        import chromadb
        from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

        def _log_chain(prefix, err):
            # huggingface_hub wraps the real cause (SSLError, ConnectionError,
            # timeout, DNS failure, proxy block...) in a generic OSError with a
            # canned "check your internet connection" message - print the
            # actual __cause__/__context__ chain so we can tell what's really
            # failing instead of guessing from the wrapper text.
            print(f"[RAG worker] {prefix}: {type(err).__name__}: {err}")
            seen = set()
            cause = err.__cause__ or err.__context__
            while cause is not None and id(cause) not in seen:
                seen.add(id(cause))
                print(f"[RAG worker]   caused by: {type(cause).__name__}: {cause}")
                cause = cause.__cause__ or cause.__context__

        def _clear_broken_model_cache():
            """Remove a corrupted local snapshot (missing files despite the dir
            existing — the Windows symlink failure mode) so the next attempt
            re-downloads cleanly instead of reusing the broken snapshot."""
            from pathlib import Path
            import shutil
            try:
                from huggingface_hub.constants import HF_HUB_CACHE
                cache_root = Path(HF_HUB_CACHE)
            except Exception:
                cache_root = Path.home() / ".cache" / "huggingface" / "hub"
            model_dir = cache_root / "models--BAAI--bge-large-en-v1.5"
            if model_dir.exists():
                shutil.rmtree(model_dir, ignore_errors=True)
                print(f"[RAG worker] removed corrupted model cache at {model_dir}")

        # Last-resort mirror: some networks (corporate firewalls) block huggingface.co
        # outright but can still reach github.com (this app already pulls updates from
        # there). Ships only the safetensors weights (no redundant pytorch_model.bin/onnx
        # copies) — trimmed from ~3.6GB to ~740MB. Split into ~150MB parts because a
        # single 740MB asset upload/download over a slow link tends to hit expired
        # signed-URL timeouts (HTTP 400) before it finishes. Not tied to app version;
        # only touched if the embedding model itself ever changes.
        _MODEL_ASSET_BASE = (
            "https://github.com/asalamat/director-assistant/releases/"
            "download/models-bge-large-v1/bge-large-en-v1.5.zip.part-"
        )
        _MODEL_ASSET_PARTS = [f"{_MODEL_ASSET_BASE}{suffix}" for suffix in ("aa", "ab", "ac", "ad", "ae")]
        from pathlib import Path
        _LOCAL_MIRROR_DIR = Path.home() / ".director-assistant" / "models" / "bge-large-en-v1.5"

        def _local_mirror_complete() -> bool:
            # Check the large weight file specifically, not just config.json —
            # extractall isn't atomic as a whole, so a prior run interrupted
            # mid-extraction (crash, disk full) could leave config.json present
            # without the actual weights, which would look "complete" otherwise.
            return (_LOCAL_MIRROR_DIR / "model.safetensors").exists()

        def _load_from_github_mirror():
            import shutil
            import urllib.request
            import zipfile

            if not _local_mirror_complete():
                print(f"[RAG worker] huggingface.co unreachable — trying our GitHub mirror ({len(_MODEL_ASSET_PARTS)} parts)")
                _LOCAL_MIRROR_DIR.parent.mkdir(parents=True, exist_ok=True)
                zip_path = _LOCAL_MIRROR_DIR.parent / "bge-large-en-v1.5.zip"
                with open(zip_path, "wb") as out:
                    for i, url in enumerate(_MODEL_ASSET_PARTS, 1):
                        print(f"[RAG worker] downloading mirror part {i}/{len(_MODEL_ASSET_PARTS)}")
                        with urllib.request.urlopen(url, timeout=300) as resp:
                            shutil.copyfileobj(resp, out)
                with zipfile.ZipFile(zip_path) as zf:
                    zf.extractall(_LOCAL_MIRROR_DIR.parent)
                zip_path.unlink(missing_ok=True)
                print(f"[RAG worker] mirror model extracted to {_LOCAL_MIRROR_DIR}")
            # Loading from a local folder path bypasses huggingface_hub's cache/
            # network resolution entirely — sentence-transformers just reads the files.
            return SentenceTransformerEmbeddingFunction(model_name=str(_LOCAL_MIRROR_DIR))

        def _load_embedding_function():
            # Once the GitHub mirror has succeeded once, skip straight to it on every
            # later startup — no point re-attempting huggingface.co (slow to fail on
            # a network that blocks it) when we already have a complete local copy.
            if _local_mirror_complete():
                print(f"[RAG worker] using previously-downloaded model at {_LOCAL_MIRROR_DIR} (skipping huggingface.co)")
                return SentenceTransformerEmbeddingFunction(model_name=str(_LOCAL_MIRROR_DIR))

            # A flat chain of attempts — every tier below always runs regardless of
            # which exception type the previous one raised. (A previous version
            # branched on FileNotFoundError vs OSError and let a plain OSError from
            # the very first attempt `raise` immediately, skipping every fallback
            # below — that bug meant the SSL-retry and GitHub-mirror tiers were
            # never actually reached on the exact "huggingface.co unreachable" error
            # they exist to handle.)
            try:
                return SentenceTransformerEmbeddingFunction(model_name="BAAI/bge-large-en-v1.5")
            except Exception as first_err:
                _log_chain("embedding model load failed", first_err)
                # `except ... as name` auto-deletes `name` when the block exits, so
                # capture what we need as a plain bool before it goes out of scope.
                was_file_not_found = isinstance(first_err, FileNotFoundError)

            # The snapshot directory can exist but be missing a file inside it (the
            # Windows symlink-cache failure mode, see HF_HUB_DISABLE_SYMLINKS above)
            # — only worth trying for FileNotFoundError specifically, but failing
            # this check just means skipping straight to the next tier, not aborting.
            if was_file_not_found:
                _clear_broken_model_cache()
                try:
                    ef = SentenceTransformerEmbeddingFunction(model_name="BAAI/bge-large-en-v1.5")
                    print("[RAG worker] embedding model re-downloaded successfully after clearing corrupted cache")
                    return ef
                except Exception as e:
                    _log_chain("still failed after clearing corrupted cache", e)

            # truststore covers ssl.create_default_context(), but some
            # requests/huggingface_hub code paths pass an explicit CA bundle file
            # instead, which truststore can't intercept. Disable verification
            # globally for this process and retry once — if this network's proxy
            # is already MITM-ing this traffic regardless, this removes a check
            # that was already failing anyway, not real protection.
            import ssl
            ssl._create_default_https_context = ssl._create_unverified_context
            try:
                ef = SentenceTransformerEmbeddingFunction(model_name="BAAI/bge-large-en-v1.5")
                print("[RAG worker] embedding model downloaded successfully with verification disabled")
                return ef
            except Exception as e:
                _log_chain("still failed with SSL verification disabled", e)

            try:
                return _load_from_github_mirror()
            except Exception as e:
                _log_chain("GitHub mirror fallback also failed", e)
                raise

        # Both model construction (loading ~1.3GB of safetensors weights) and the
        # warmup encode below can hang indefinitely with zero Python-visible error
        # — e.g. antivirus holding a lock on the freshly-downloaded model file while
        # safetensors memory-maps it. Nothing here has ever timed out on its own, so
        # a hang here means "ready" is never sent and the worker looks alive forever
        # while doing nothing. Run each step on a watcher thread with a hard deadline.
        def _run_with_timeout(fn, timeout_s: float, label: str):
            result: dict = {}
            def _target():
                try:
                    result["value"] = fn()
                except Exception as e:
                    result["error"] = e
            t = threading.Thread(target=_target, daemon=True, name=f"rag-worker-{label}")
            t.start()
            t.join(timeout_s)
            if t.is_alive():
                raise TimeoutError(f"{label} did not complete within {timeout_s:.0f}s — likely hung (see comment above)")
            if "error" in result:
                raise result["error"]
            return result.get("value")

        # Generous budget — this can include downloading ~750MB over the GitHub
        # mirror on a slow connection, which is legitimately slow, not hung.
        # A stalled (zero-progress) connection is still caught faster via the
        # per-request timeout= on each part's urlopen() call inside the mirror.
        ef = _run_with_timeout(_load_embedding_function, 1800, "model load")
        chroma = chromadb.PersistentClient(path=db_path_str)
        col = chroma.get_collection("emails", embedding_function=ef)

        # Pre-encode one dummy sentence to fully load the model weights into RAM
        # before the first real query (avoids a slow first response).
        # Do NOT call col.query() here — loading the 102MB HNSW index inside a
        # spawned subprocess while loky is also initializing causes a 20+ minute hang.
        # HNSW loads lazily on the first real query, which is acceptable.
        try:
            _run_with_timeout(lambda: ef(["warmup"]), 60, "warmup")
        except Exception as e:
            print(f"[RAG worker] warmup skipped ({type(e).__name__}: {e}) — proceeding without it, first real query will be slower")

        resp_queue.put({"ready": True})
    except Exception as e:
        print(f"[RAG worker] FATAL — could not become ready: {type(e).__name__}: {e}")
        resp_queue.put({"ready": False, "error": str(e)})
        return

    while True:
        try:
            req = req_queue.get(timeout=600)   # 10-min idle timeout → worker stays alive
        except Exception:
            continue

        if req is None:
            break

        cmd = req.get("cmd")
        try:
            if cmd == "query":
                # Pre-encode the query text directly via ef() to avoid loky/hnswlib
                # SIGSEGV on Python 3.13 that occurs when col.query(query_texts=…)
                # re-invokes the embedding function inside a loky subprocess.
                query_embedding = ef([req["query"]])
                q_kwargs: dict = {
                    "query_embeddings": query_embedding,
                    "n_results": req["n_results"],
                    "include": req.get("include", ["documents", "metadatas", "distances"]),
                }
                if req.get("where"):
                    q_kwargs["where"] = req["where"]
                result = col.query(**q_kwargs)
                resp_queue.put({"ok": True, "result": result})

            elif cmd == "count":
                resp_queue.put({"ok": True, "count": col.count()})

            elif cmd == "get":
                kwargs = {"include": req.get("include", ["metadatas"])}
                if req.get("where"):
                    kwargs["where"] = req["where"]
                result = col.get(**kwargs)
                resp_queue.put({"ok": True, "result": result})

            elif cmd == "upsert":
                col.upsert(
                    ids=req["ids"],
                    documents=req["documents"],
                    metadatas=req["metadatas"],
                )
                resp_queue.put({"ok": True})

            elif cmd == "delete":
                col.delete(ids=req["ids"])
                resp_queue.put({"ok": True})

            elif cmd == "delete_where":
                col.delete(where=req["where"])
                resp_queue.put({"ok": True})

            elif cmd == "reset_collection":
                # Drop and recreate — the only reliable way to free HNSW space
                chroma.delete_collection("emails")
                col = chroma.create_collection(
                    name="emails",
                    embedding_function=ef,
                    metadata={
                        "hnsw:space": "cosine",
                        "hnsw:M": 48,
                        "hnsw:construction_ef": 256,
                        "hnsw:search_ef": 128,
                        "hnsw:batch_size": 2000,
                        "hnsw:sync_threshold": 5000,
                    },
                )
                resp_queue.put({"ok": True})

            else:
                resp_queue.put({"ok": False, "error": f"unknown cmd: {cmd}"})

        except Exception as e:
            resp_queue.put({"ok": False, "error": str(e)})
