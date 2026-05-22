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

    try:
        import torch
        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
    except Exception:
        pass

    try:
        import chromadb
        from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

        ef = SentenceTransformerEmbeddingFunction(model_name="BAAI/bge-large-en-v1.5")
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

            else:
                resp_queue.put({"ok": False, "error": f"unknown cmd: {cmd}"})

        except Exception as e:
            resp_queue.put({"ok": False, "error": str(e)})
