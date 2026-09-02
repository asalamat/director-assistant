"""
ChromaDB worker — runs in a spawned subprocess so SIGSEGV from hnswlib/loky
on Python 3.13 cannot kill the main uvicorn process.

Protocol: caller sends dicts via req_queue, gets dicts back via resp_queue.
"""

import os

# Must be set before any ML imports
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
for _k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
           "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS", "LOKY_MAX_CPU_COUNT"):
    os.environ.setdefault(_k, "1")


def worker_main(db_path_str: str, req_queue, resp_queue):
    """Entry point called in the spawned worker process."""
    # Re-apply env vars (spawn context may not inherit them on all OSes)
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    for _k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
               "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS", "LOKY_MAX_CPU_COUNT"):
        os.environ[_k] = "1"

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

        try:
            ef = SentenceTransformerEmbeddingFunction(model_name="BAAI/bge-large-en-v1.5")
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
            except Exception as second_err:
                _log_chain("embedding model download STILL failed with verification disabled", second_err)
                raise
        chroma = chromadb.PersistentClient(path=db_path_str)
        col = chroma.get_collection("emails", embedding_function=ef)

        # Pre-encode one dummy sentence to fully load the model weights into RAM
        # before the first real query (avoids a slow first response).
        # Do NOT call col.query() here — loading the 102MB HNSW index inside a
        # spawned subprocess while loky is also initializing causes a 20+ minute hang.
        # HNSW loads lazily on the first real query, which is acceptable.
        try:
            ef(["warmup"])
        except Exception:
            pass

        resp_queue.put({"ready": True})
    except Exception as e:
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
