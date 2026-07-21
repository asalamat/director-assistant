"""
Pattern detection and DB-fact builders for the Ask router.
Handles aggregation queries (top senders, email counts, relationships)
that should bypass or augment semantic RAG search.
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Search query helpers
# ---------------------------------------------------------------------------

_QUESTION_PREAMBLES = re.compile(
    r"^(?:who\s+is|who\s+are|what\s+is|what\s+are|where\s+is|when\s+is|"
    r"what\s+do\s+(?:you\s+)?know\s+(?:about\s+)?|"
    r"what\s+can\s+you\s+tell\s+me\s+(?:about\s+)?|"
    r"can\s+you\s+(?:please\s+)?(?:tell\s+me\s+|show\s+me\s+)?(?:about\s+)?|"
    r"do\s+you\s+(?:have\s+(?:any\s+)?(?:emails?\s+)?(?:(?:about|from|on)\s+)?|know\s+(?:about\s+)?)|"
    r"how\s+(?:many\s+|much\s+)?(?:emails?\s+|messages?\s+)?(?:(?:from|about|by|to)\s+)?|"
    r"how\s+is|tell\s+me\s+(?:about\s+|more\s+about\s+)?|"
    r"show\s+me\s+(?:emails?\s+(?:from|about)\s+)?|"
    r"find\s+(?:emails?\s+(?:from|about)\s+)?|"
    r"(?:list|count|get)\s+(?:all\s+)?(?:emails?\s+)?(?:(?:from|about|by)\s+)?|"
    r"emails?\s+(?:from|about|by)\s+|"
    r"i\s+(?:want|need|would\s+like)\s+to\s+(?:know|find|see)\s+(?:about\s+|more\s+about\s+)?|"
    r"(?:search|look)\s+(?:for\s+)?(?:emails?\s+(?:about|from)\s+)?)\s*",
    re.IGNORECASE,
)

_ABOUT_EXTRACTOR = re.compile(
    r"\b(?:about|regarding|concerning|on\s+the\s+topic\s+of|related\s+to)\s+(.+?)(?:\s*[?.]?\s*$)",
    re.IGNORECASE,
)

_META_WORDS = frozenset({
    "how", "many", "much", "count", "number", "total", "list",
    "email", "emails", "message", "messages", "mail",
    "from", "about", "by", "in", "for",
})

_SENDER_EXTRACT = re.compile(
    r"\b(?:from|by|sent\s+by)\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?:\s*[?,.]|\s*$)",
    re.IGNORECASE,
)


def search_query(question: str) -> str:
    stripped = _QUESTION_PREAMBLES.sub("", question).strip()
    words = stripped.split()
    filtered = [w for w in words if w.lower() not in _META_WORDS]
    result = " ".join(filtered).strip() or stripped or question
    if len(result.split()) > 4:
        m = _ABOUT_EXTRACTOR.search(question)
        if m:
            candidate = m.group(1).strip()
            cwords = [w for w in candidate.split() if w.lower() not in _META_WORDS]
            if cwords:
                result = " ".join(cwords)
    return result


def extract_sender_name(question: str) -> str | None:
    m = _SENDER_EXTRACT.search(question)
    if m:
        return m.group(1).strip()
    q = search_query(question)
    if q and len(q.split()) <= 3 and q[0].isupper():
        return q
    return None


# ---------------------------------------------------------------------------
# Intent detection patterns
# ---------------------------------------------------------------------------

COUNT_QUESTION = re.compile(
    r"\b(?:how\s+many|count|total\s+(?:number\s+of)?)\b.*\b(?:email|message)s?\b",
    re.IGNORECASE,
)

TOP_SENDER_QUESTION = re.compile(
    r"\b(?:who\s+(?:sent|emails?|email[e]?d|writes?|wrote)\s+(?:me\s+)?(?:the\s+)?most"
    r"|top\s+senders?"
    r"|most\s+frequent\s+senders?"
    r"|who\s+(?:contacts?|emails?)\s+me\s+(?:the\s+)?most"
    r"|(?:most|highest)\s+emails?\s+from"
    r"|who\s+sends?\s+(?:me\s+)?(?:the\s+)?most)\b",
    re.IGNORECASE,
)

RELATION_QUESTION = re.compile(
    r"\b(?:what\s+is\s+|how\s+(?:do|does|are|did)\s+|describe\s+|tell\s+me\s+(?:about\s+)?)"
    r"(?:the\s+)?(?:relation(?:ship)?|connection|history|interaction)\s+(?:between\s+)?"
    r"|\b(?:relation(?:ship)?|connection)\s+between\b"
    r"|\bhow\s+(?:do|does|are)\s+\w[\w\s]{1,30}?\s+and\s+\w[\w\s]{1,30}?\s+(?:know|relate|connected)\b"
    r"|\bwhat\s+is\s+\w[\w\s]{1,30}?\s+and\s+\w[\w\s]{1,30}?\s+relation\b",
    re.IGNORECASE,
)

RECOMMENDATION_QUESTION = re.compile(
    r"\b(?:what\s+should\s+i\s+(?:do|say|reply|respond|write)"
    r"|(?:recommend|suggest|advice|advise)\s+"
    r"|how\s+(?:should|do)\s+i\s+(?:handle|respond|reply|deal|approach)"
    r"|what\s+(?:is\s+the\s+best|would\s+you\s+recommend)"
    r"|(?:help\s+me|draft|write)\s+(?:a\s+)?(?:reply|response|email|message))\b",
    re.IGNORECASE,
)

_PERIOD_EXTRACT = re.compile(
    r"\b(this\s+(?:month|week|year)|last\s+(?:month|week|year)|today|this\s+quarter)\b",
    re.IGNORECASE,
)

_TWO_NAMES_EXTRACT = re.compile(
    r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+and\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b",
)

_TWO_NAMES_LOOSE = re.compile(
    r"\b([A-Za-z][a-z]{1,20}(?:\s+[A-Za-z][a-z]{1,20})?)\s+and\s+([A-Za-z][a-z]{1,20}(?:\s+[A-Za-z][a-z]{1,20})?)\b",
    re.IGNORECASE,
)

_STOPWORDS = frozenset({
    "how", "what", "who", "when", "where", "why", "which", "tell", "me",
    "is", "are", "do", "does", "did", "the", "a", "an", "their", "his",
    "her", "its", "you", "they", "we", "i", "my", "your", "our",
    "relation", "relationship", "connection", "history", "interaction",
    "email", "emails", "know", "relate", "connected",
})


# ---------------------------------------------------------------------------
# DB fact builders
# ---------------------------------------------------------------------------

def extract_period(question: str) -> str:
    m = _PERIOD_EXTRACT.search(question)
    return m.group(1).lower() if m else "this month"


def build_top_sender_fact(cache, question: str) -> str:
    period = extract_period(question)
    rows = cache.top_senders_period(period=period, limit=10)
    if not rows:
        return f"\n\nDB FACT: No emails found for the period '{period}'."
    lines = "\n".join(
        f"  {i+1}. {r['sender']} — {r['count']} email{'s' if r['count'] != 1 else ''}"
        for i, r in enumerate(rows)
    )
    return (
        f"\n\nDB FACTS (aggregated directly from database, 100% accurate):\n"
        f"Top email senders for {period}:\n{lines}\n"
        f"Use these exact numbers and names in your answer."
    )


def build_volume_fact(cache, question: str) -> str:
    period = extract_period(question)
    vol = cache.email_volume_period(period=period)
    return (
        f"\n\nDB FACT (aggregated directly from database, 100% accurate):\n"
        f"For {period}: {vol['total']} total emails "
        f"({vol['received']} received, {vol['sent']} sent).\n"
        f"Use these exact numbers."
    )


def extract_two_names(question: str) -> tuple[str, str] | None:
    m = _TWO_NAMES_EXTRACT.search(question)
    if m:
        a, b = m.group(1).strip(), m.group(2).strip()
        if a.lower() not in _STOPWORDS and b.lower() not in _STOPWORDS:
            return a, b
    for m in _TWO_NAMES_LOOSE.finditer(question):
        a, b = m.group(1).strip(), m.group(2).strip()
        if a.lower() not in _STOPWORDS and b.lower() not in _STOPWORDS:
            return a, b
    return None


def build_relation_fact(cache, name_a: str, name_b: str) -> tuple[str, list[dict]]:
    """Returns (db_fact_string, email_samples_list)."""
    data = cache.people_relationship_summary(name_a, name_b)
    a_to_b = data["a_to_b"]
    b_to_a = data["b_to_a"]
    both = data["both_mentioned"]

    seen: set[str] = set()
    unique: list[dict] = []
    for e in a_to_b + b_to_a + both:
        if e["id"] not in seen:
            seen.add(e["id"])
            unique.append(e)

    if not unique:
        return (
            f"\n\nDB FACT: No emails found directly between '{name_a}' and '{name_b}'. "
            f"They may have had no direct email exchange, or names may be spelled differently.",
            [],
        )

    lines = []
    if a_to_b:
        lines.append(f"  • {name_a} → {name_b}: {len(a_to_b)} email(s)")
        for e in a_to_b[:3]:
            lines.append(f"      [{e['date'][:10]}] {e['subject']}")
    if b_to_a:
        lines.append(f"  • {name_b} → {name_a}: {len(b_to_a)} email(s)")
        for e in b_to_a[:3]:
            lines.append(f"      [{e['date'][:10]}] {e['subject']}")
    if both and not (a_to_b or b_to_a):
        lines.append(f"  • Both mentioned in {len(both)} email(s)")
        for e in both[:3]:
            lines.append(f"      [{e['date'][:10]}] {e['subject']} (from {e['sender']})")

    fact = (
        f"\n\nDB FACTS — Email interactions between '{name_a}' and '{name_b}':\n"
        + "\n".join(lines)
        + "\n\nUse the email content below to describe their relationship and shared topics."
    )
    samples = [
        {
            "email_id": e["id"],
            "subject": e.get("subject", ""),
            "sender": e.get("sender", ""),
            "date": (e.get("date") or "")[:10],
            "text": (e.get("body") or "")[:600],
            "source_type": "email",
            "_distance": 0.1,
        }
        for e in unique[:8]
    ]
    return fact, samples
