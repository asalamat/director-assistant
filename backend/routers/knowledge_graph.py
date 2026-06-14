"""Knowledge graph endpoint — people, topics, and project relationship graph."""

import re
from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])

_STOP_WORDS = frozenset({
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "has", "have", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "re", "fwd", "fw", "hello", "hi", "hey",
    "dear", "thanks", "thank", "regards", "please", "your", "our", "my",
    "you", "we", "i", "it", "this", "that", "not", "no", "yes", "up",
    "can", "all", "more", "also", "just", "one", "new", "its", "about",
})

_WORD_RE = re.compile(r"[A-Za-z]{3,}")
_NAME_RE = re.compile(r'^"?([^"<]+)"?\s*<')


def _tokenize(subject: str) -> list[str]:
    return [
        w.lower() for w in _WORD_RE.findall(subject)
        if w.lower() not in _STOP_WORDS
    ]


def _row_val(row, key: str, idx: int):
    """Safely read sqlite3.Row by key or by index."""
    try:
        return row[key]
    except (IndexError, KeyError):
        return row[idx]


@router.get("/knowledge-graph")
async def get_knowledge_graph(request: Request):
    """Return nodes + edges for a force-directed knowledge graph."""
    cache = getattr(request.app.state, "cache", None)
    if not cache:
        return {"nodes": [], "edges": [], "error": "Cache not available"}

    nodes: list[dict] = []
    edges: list[dict] = []
    node_index: dict[str, int] = {}

    def _add_node(node_id: str, label: str, node_type: str, count: int) -> None:
        if node_id not in node_index:
            node_index[node_id] = len(nodes)
            nodes.append({"id": node_id, "label": label, "type": node_type, "count": count})
        else:
            nodes[node_index[node_id]]["count"] = max(
                nodes[node_index[node_id]]["count"], count
            )

    def _add_edge(source: str, target: str, weight: float = 1.0) -> None:
        for e in edges:
            if (e["source"] == source and e["target"] == target) or \
               (e["source"] == target and e["target"] == source):
                e["weight"] = min(e["weight"] + 0.2, 5.0)
                return
        edges.append({"source": source, "target": target, "weight": weight})

    try:
        with cache._conn() as conn:
            # --- People: top 30 senders ---
            for row in conn.execute(
                "SELECT sender, COUNT(*) AS cnt FROM emails"
                " WHERE sender != '' AND sender IS NOT NULL"
                " GROUP BY LOWER(sender) ORDER BY cnt DESC LIMIT 30"
            ).fetchall():
                raw = _row_val(row, "sender", 0)
                cnt = _row_val(row, "cnt", 1)
                m = _NAME_RE.match(raw)
                label = m.group(1).strip() if m else raw.split("@")[0][:30]
                _add_node(f"person:{raw.lower()[:60]}", label, "person", int(cnt))

            # --- Topics: top 20 keywords from subjects ---
            word_freq: dict[str, int] = {}
            for row in conn.execute(
                "SELECT subject FROM emails WHERE subject != '' LIMIT 2000"
            ).fetchall():
                for w in _tokenize(_row_val(row, "subject", 0) or ""):
                    word_freq[w] = word_freq.get(w, 0) + 1
            for word, freq in sorted(word_freq.items(), key=lambda x: -x[1])[:20]:
                _add_node(f"topic:{word}", word.capitalize(), "topic", freq)

            # --- Projects ---
            try:
                for row in conn.execute(
                    "SELECT id, name FROM projects WHERE status='active' LIMIT 10"
                ).fetchall():
                    _add_node(
                        f"project:{_row_val(row, 'id', 0)}",
                        _row_val(row, "name", 1),
                        "project", 1,
                    )
            except Exception:
                pass

            # --- Edges: person<->topic and person<->person (via threads) ---
            thread_senders: dict[str, list[str]] = {}
            for row in conn.execute(
                "SELECT sender, subject, thread_id FROM emails"
                " WHERE sender != '' AND subject != '' LIMIT 3000"
            ).fetchall():
                sender = _row_val(row, "sender", 0)
                subject = _row_val(row, "subject", 1)
                thread_id = _row_val(row, "thread_id", 2)
                person_id = f"person:{sender.lower()[:60]}"
                if person_id not in node_index:
                    continue
                for word in _tokenize(subject or ""):
                    topic_id = f"topic:{word}"
                    if topic_id in node_index and len(edges) < 100:
                        _add_edge(person_id, topic_id, 1.0)
                if thread_id:
                    lst = thread_senders.setdefault(thread_id, [])
                    if person_id not in lst:
                        lst.append(person_id)

            for participants in thread_senders.values():
                for i in range(len(participants)):
                    for j in range(i + 1, len(participants)):
                        if len(edges) < 100:
                            _add_edge(participants[i], participants[j], 0.5)

            # --- Project<->person via project_emails ---
            try:
                for row in conn.execute(
                    "SELECT p.id, e.sender FROM projects p"
                    " JOIN project_emails pe ON pe.project_id = p.id"
                    " JOIN emails e ON e.id = pe.email_id"
                    " WHERE e.sender != '' LIMIT 200"
                ).fetchall():
                    proj_id = f"project:{_row_val(row, 'id', 0)}"
                    person_id = f"person:{_row_val(row, 'sender', 1).lower()[:60]}"
                    if proj_id in node_index and person_id in node_index and len(edges) < 100:
                        _add_edge(proj_id, person_id, 1.5)
            except Exception:
                pass

    except Exception as exc:
        return {"nodes": [], "edges": [], "error": str(exc)}

    final_nodes = nodes[:50]
    valid_ids = {n["id"] for n in final_nodes}
    final_edges = [
        e for e in edges
        if e["source"] in valid_ids and e["target"] in valid_ids
    ][:100]

    return {"nodes": final_nodes, "edges": final_edges}
