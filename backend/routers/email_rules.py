"""Email rules — auto-label and auto-action incoming emails."""

import json
import logging
import re
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/email-rules", tags=["email-rules"])

VALID_FIELDS = {"sender", "subject", "body"}
VALID_CONDITIONS = {"contains", "equals", "starts_with", "ends_with"}
VALID_ACTIONS = {"label", "archive", "mark_read", "delete", "forward"}

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _valid_email(addr: str) -> bool:
    return bool(_EMAIL_RE.match((addr or "").strip()))


class RuleCreate(BaseModel):
    name: str
    field: str
    condition: str
    value: str
    action: str
    label: str = ""
    forward_to: str = ""
    priority: int = 0

    def validate_fields(self):
        if self.field not in VALID_FIELDS:
            raise ValueError(f"field must be one of {VALID_FIELDS}")
        if self.condition not in VALID_CONDITIONS:
            raise ValueError(f"condition must be one of {VALID_CONDITIONS}")
        if self.action not in VALID_ACTIONS:
            raise ValueError(f"action must be one of {VALID_ACTIONS}")
        if self.action == "forward" and not _valid_email(self.forward_to):
            raise ValueError("forward_to must be a valid email address")


class RulePreview(BaseModel):
    field: str
    condition: str
    value: str

    def validate_fields(self):
        if self.field not in VALID_FIELDS:
            raise ValueError(f"field must be one of {VALID_FIELDS}")
        if self.condition not in VALID_CONDITIONS:
            raise ValueError(f"condition must be one of {VALID_CONDITIONS}")


def _rule_matches(field: str, condition: str, check: str, row) -> bool:
    val = ""
    if field == "sender":
        val = (row["sender"] or "").lower()
    elif field == "subject":
        val = (row["subject"] or "").lower()
    elif field == "body":
        val = ((row["body"] or "")[:1000]).lower()
    return (
        (condition == "contains" and check in val) or
        (condition == "equals" and val == check) or
        (condition == "starts_with" and val.startswith(check)) or
        (condition == "ends_with" and val.endswith(check))
    )


def _forward_email(cache, forward_to: str, sender: str, subject: str, body: str) -> bool:
    """Compose and send a forwarded copy via SMTP. Returns True on success."""
    if not _valid_email(forward_to):
        return False
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from routers.email_send import _resolve_account, _smtp_send
    try:
        acc = _resolve_account(cache, 0)
        msg = MIMEMultipart()
        msg["From"] = acc.username
        msg["To"] = forward_to.strip()
        msg["Subject"] = f"Fwd: {subject or '(no subject)'}"
        fwd_body = (
            f"---------- Forwarded message ----------\n"
            f"From: {sender or ''}\n"
            f"Subject: {subject or ''}\n\n"
            f"{body or ''}"
        )
        msg.attach(MIMEText(fwd_body, "plain", "utf-8"))
        _smtp_send(acc, msg)
        return True
    except Exception as e:
        _log.warning("Rule forward failed: %s", type(e).__name__)
        return False


def log_rules_run(cache, labeled, archived, marked, deleted) -> None:
    """Record a rules auto-run summary into rules_run_log."""
    with cache._conn() as conn:
        conn.execute(
            "INSERT INTO rules_run_log (labeled, archived, marked, deleted) VALUES (?,?,?,?)",
            (labeled, archived, marked, deleted),
        )


@router.get("/last-run")
async def last_run(request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        row = conn.execute(
            "SELECT ran_at, labeled, archived, marked, deleted FROM rules_run_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


@router.get("")
async def list_rules(request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute("SELECT * FROM email_rules ORDER BY priority DESC, id").fetchall()
    return {"rules": [dict(r) for r in rows]}


@router.post("")
async def create_rule(req: RuleCreate, request: Request):
    try:
        req.validate_fields()
    except ValueError as e:
        raise HTTPException(400, str(e))
    cache = request.app.state.cache
    with cache._conn() as conn:
        cur = conn.execute(
            "INSERT INTO email_rules (name, field, condition, value, action, label, forward_to, priority) VALUES (?,?,?,?,?,?,?,?)",
            (req.name, req.field, req.condition, req.value, req.action, req.label,
             req.forward_to.strip() if req.action == "forward" else "", req.priority),
        )
    return {"id": cur.lastrowid, "status": "created"}


class NLRuleRequest(BaseModel):
    description: str


@router.post("/from-nl")
async def rules_from_natural_language(req: NLRuleRequest, request: Request):
    """Parse a plain-English description into one or more structured rule proposals."""
    if not req.description.strip():
        raise HTTPException(400, "Description cannot be empty")

    ai = getattr(getattr(request.app.state, "advisor", None), "ai", None)
    if ai is None:
        raise HTTPException(503, "AI not configured")

    prompt = (
        "Convert this email rule description into structured rules. "
        "Valid fields: sender, subject, body. "
        "Valid conditions: contains, equals, starts_with, ends_with. "
        "Valid actions: label, archive, mark_read, delete. "
        "Valid labels: proposal, newsletter, urgent, meeting, finance, update, personal, spam, other. "
        "Reply ONLY as a JSON array (no explanation):\n"
        '[{"name":"...","field":"sender","condition":"contains","value":"...","action":"archive","label":""}]\n\n'
        f'Description: {req.description.strip()}'
    )
    try:
        resp = await ai.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if not match:
            raise HTTPException(422, "Could not parse rules from description")
        proposals = json.loads(match.group())
        # Validate and sanitize each proposal
        valid = []
        for p in proposals:
            if not isinstance(p, dict):
                continue
            field = p.get("field", "sender")
            condition = p.get("condition", "contains")
            action = p.get("action", "archive")
            if field not in VALID_FIELDS:
                field = "sender"
            if condition not in VALID_CONDITIONS:
                condition = "contains"
            if action not in VALID_ACTIONS:
                action = "archive"
            valid.append({
                "name": str(p.get("name", "Auto rule"))[:80],
                "field": field,
                "condition": condition,
                "value": str(p.get("value", ""))[:200],
                "action": action,
                "label": str(p.get("label", ""))[:40] if action == "label" else "",
                "priority": 0,
            })
        return {"rules": valid}
    except HTTPException:
        raise
    except Exception as e:
        _log.warning("NL rule parsing failed: %s", type(e).__name__)
        raise HTTPException(500, "Failed to generate rules")


@router.post("/preview")
async def preview_rule(req: RulePreview, request: Request):
    """Count how many emails a rule would match, without applying any action."""
    try:
        req.validate_fields()
    except ValueError as e:
        raise HTTPException(400, str(e))
    cache = request.app.state.cache
    with cache._conn() as conn:
        emails = conn.execute(
            "SELECT id, sender, subject, body FROM emails ORDER BY date DESC LIMIT 2000"
        ).fetchall()

    check = req.value.lower()
    count = 0
    sample = []
    for row in emails:
        if _rule_matches(req.field, req.condition, check, row):
            count += 1
            if len(sample) < 5:
                sample.append({
                    "id": row["id"],
                    "subject": row["subject"] or "(no subject)",
                    "sender": row["sender"] or "",
                })
    return {"count": count, "sample": sample}


@router.patch("/{rule_id}/toggle")
async def toggle_rule(rule_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        cur = conn.execute(
            "UPDATE email_rules SET enabled = 1 - enabled WHERE id=?", (rule_id,)
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "Rule not found")
    return {"status": "toggled"}


@router.delete("/{rule_id}")
async def delete_rule(rule_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM email_rules WHERE id=?", (rule_id,))
    return {"deleted": rule_id}


@router.post("/run")
async def run_all_rules(request: Request):
    """Apply all enabled rules to every email in the inbox."""
    cache = request.app.state.cache
    rag = getattr(request.app.state, "rag", None)
    with cache._conn() as conn:
        emails = conn.execute(
            "SELECT id, sender, subject, body FROM emails ORDER BY date DESC LIMIT 2000"
        ).fetchall()
        rules = conn.execute(
            "SELECT * FROM email_rules WHERE enabled=1 ORDER BY priority DESC"
        ).fetchall()

    deleted = 0
    labeled = 0
    archived = 0
    marked = 0

    for row in emails:
        email_id = row["id"]
        for rule in rules:
            field = rule["field"]
            val = ""
            if field == "sender":
                val = (row["sender"] or "").lower()
            elif field == "subject":
                val = (row["subject"] or "").lower()
            elif field == "body":
                val = ((row["body"] or "")[:1000]).lower()

            check = rule["value"].lower()
            cond = rule["condition"]
            matched = (
                (cond == "contains" and check in val) or
                (cond == "equals" and val == check) or
                (cond == "starts_with" and val.startswith(check)) or
                (cond == "ends_with" and val.endswith(check))
            )
            if not matched:
                continue

            action = rule["action"]
            if action == "label" and rule["label"]:
                cache.set_category(email_id, rule["label"])
                labeled += 1
            elif action == "mark_read":
                with cache._conn() as conn:
                    conn.execute("UPDATE emails SET is_read=1 WHERE id=?", (email_id,))
                marked += 1
            elif action == "archive":
                with cache._conn() as conn:
                    conn.execute("UPDATE emails SET folder='Archive' WHERE id=?", (email_id,))
                archived += 1
            elif action == "forward" and rule["forward_to"]:
                _forward_email(cache, rule["forward_to"], row["sender"], row["subject"], row["body"])
            elif action == "delete":
                with cache._conn() as conn:
                    conn.execute("DELETE FROM emails WHERE id=?", (email_id,))
                if rag:
                    try:
                        rag.remove_email(email_id)
                    except Exception:
                        pass
                deleted += 1
            if action == "delete":
                break  # email gone, skip remaining rules

    log_rules_run(cache, labeled, archived, marked, deleted)
    return {"status": "done", "deleted": deleted, "labeled": labeled, "archived": archived, "marked": marked}


def apply_rules(email, cache) -> None:
    """Apply all enabled rules to an email. Called during poll."""
    with cache._conn() as conn:
        rules = conn.execute(
            "SELECT * FROM email_rules WHERE enabled=1 ORDER BY priority DESC"
        ).fetchall()

    for rule in rules:
        field = rule["field"]
        val = ""
        if field == "sender":
            val = (getattr(email, "sender", "") or "").lower()
        elif field == "subject":
            val = (getattr(email, "subject", "") or "").lower()
        elif field == "body":
            val = ((getattr(email, "body", "") or "")[:1000]).lower()

        check = rule["value"].lower()
        cond = rule["condition"]
        matched = (
            (cond == "contains" and check in val) or
            (cond == "equals" and val == check) or
            (cond == "starts_with" and val.startswith(check)) or
            (cond == "ends_with" and val.endswith(check))
        )
        if not matched:
            continue

        action = rule["action"]
        if action == "label" and rule["label"]:
            cache.set_category(email.id, rule["label"])
        elif action == "mark_read":
            with cache._conn() as conn:
                conn.execute("UPDATE emails SET is_read=1 WHERE id=?", (email.id,))
        elif action == "archive":
            with cache._conn() as conn:
                conn.execute("UPDATE emails SET folder='Archive' WHERE id=?", (email.id,))
        elif action == "forward" and rule["forward_to"]:
            _forward_email(
                cache, rule["forward_to"],
                getattr(email, "sender", ""), getattr(email, "subject", ""),
                getattr(email, "body", ""),
            )
        elif action == "delete":
            with cache._conn() as conn:
                conn.execute("DELETE FROM emails WHERE id=?", (email.id,))
            return  # stop processing rules for deleted email
