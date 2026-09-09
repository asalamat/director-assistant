"""
ChromaDB worker — runs in a spawned subprocess so SIGSEGV from hnswlib/loky
on Python 3.13 cannot kill the main uvicorn process.

Protocol: caller sends dicts via req_queue, gets dicts back via resp_queue.
"""

import os
import threading

# Must be set before any ML imports
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
for _k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
           "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS", "LOKY_MAX_CPU_COUNT"):
    os.environ.setdefault(_k, "1")

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
               "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS", "LOKY_MAX_CPU_COUNT"):
        os.environ[_k] = "1"
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
        torch.set_num_threads(1)
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

        def _load_from_github_mirror():
            import shutil
            import urllib.request
            import zipfile
            from pathlib import Path

            local_dir = Path.home() / ".director-assistant" / "models" / "bge-large-en-v1.5"
            if not (local_dir / "config.json").exists():
                print(f"[RAG worker] huggingface.co unreachable — trying our GitHub mirror ({len(_MODEL_ASSET_PARTS)} parts)")
                local_dir.parent.mkdir(parents=True, exist_ok=True)
                zip_path = local_dir.parent / "bge-large-en-v1.5.zip"
                with open(zip_path, "wb") as out:
                    for i, url in enumerate(_MODEL_ASSET_PARTS, 1):
                        print(f"[RAG worker] downloading mirror part {i}/{len(_MODEL_ASSET_PARTS)}")
                        with urllib.request.urlopen(url, timeout=300) as resp:
                            shutil.copyfileobj(resp, out)
                with zipfile.ZipFile(zip_path) as zf:
                    zf.extractall(local_dir.parent)
                zip_path.unlink(missing_ok=True)
                print(f"[RAG worker] mirror model extracted to {local_dir}")
            # Loading from a local folder path bypasses huggingface_hub's cache/
            # network resolution entirely — sentence-transformers just reads the files.
            return SentenceTransformerEmbeddingFunction(model_name=str(local_dir))

        def _load_embedding_function():
            try:
                return SentenceTransformerEmbeddingFunction(model_name="BAAI/bge-large-en-v1.5")
            except (FileNotFoundError, OSError) as first_err:
                # The snapshot directory exists but a file inside it is missing —
                # not a network problem, so retrying with SSL disabled would just
                # fail the same way. This is the Windows symlink-cache failure mode
                # (see HF_HUB_DISABLE_SYMLINKS above): wipe the broken snapshot and
                # re-download clean, now with symlinks disabled for this attempt too.
                if isinstance(first_err, FileNotFoundError):
                    _log_chain("embedding model cache corrupted, clearing and re-downloading", first_err)
                    _clear_broken_model_cache()
                    try:
                        ef = SentenceTransformerEmbeddingFunction(model_name="BAAI/bge-large-en-v1.5")
                        print("[RAG worker] embedding model re-downloaded successfully after clearing corrupted cache")
                        return ef
                    except Exception as second_err:
                        _log_chain("embedding model download STILL failed after clearing cache", second_err)
                        return _load_from_github_mirror()
                raise
            except Exception as first_err:
                # truststore covers ssl.create_default_context(), but some
                # requests/huggingface_hub code paths pass an explicit CA bundle
                # file instead, which truststore can't intercept. Last resort:
                # disable verification globally for this process and retry once.
                # This network's corporate proxy is already MITM-ing this exact
                # traffic regardless, so this doesn't remove real protection here
                # - it only removes a check that was already failing anyway.
                _log_chain("embedding model download failed even with truststore, retrying with SSL verification disabled", first_err)
                import ssl
                ssl._create_default_https_context = ssl._create_unverified_context
                try:
                    ef = SentenceTransformerEmbeddingFunction(model_name="BAAI/bge-large-en-v1.5")
                    print("[RAG worker] embedding model downloaded successfully with verification disabled")
                    return ef
                except Exception as second_err:
                    _log_chain("embedding model download STILL failed with verification disabled", second_err)
                    try:
                        return _load_from_github_mirror()
                    except Exception as third_err:
                        _log_chain("GitHub mirror fallback also failed", third_err)
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

        ef = _run_with_timeout(_load_embedding_function, 240, "model load")
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
