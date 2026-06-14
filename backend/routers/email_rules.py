"""Email rules — auto-label and auto-action incoming emails."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/email-rules", tags=["email-rules"])

VALID_FIELDS = {"sender", "subject", "body"}
VALID_CONDITIONS = {"contains", "equals", "starts_with", "ends_with"}
VALID_ACTIONS = {"label", "archive", "mark_read", "delete"}


class RuleCreate(BaseModel):
    name: str
    field: str
    condition: str
    value: str
    action: str
    label: str = ""
    priority: int = 0

    def validate_fields(self):
        if self.field not in VALID_FIELDS:
            raise ValueError(f"field must be one of {VALID_FIELDS}")
        if self.condition not in VALID_CONDITIONS:
            raise ValueError(f"condition must be one of {VALID_CONDITIONS}")
        if self.action not in VALID_ACTIONS:
            raise ValueError(f"action must be one of {VALID_ACTIONS}")


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
            "INSERT INTO email_rules (name, field, condition, value, action, label, priority) VALUES (?,?,?,?,?,?,?)",
            (req.name, req.field, req.condition, req.value, req.action, req.label, req.priority),
        )
    return {"id": cur.lastrowid, "status": "created"}


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
            with cache._conn() as conn:
                if action == "label" and rule["label"]:
                    conn.execute("UPDATE emails SET category=? WHERE id=?", (rule["label"], email_id))
                    labeled += 1
                elif action == "mark_read":
                    conn.execute("UPDATE emails SET is_read=1 WHERE id=?", (email_id,))
                    marked += 1
                elif action == "archive":
                    conn.execute("UPDATE emails SET folder='Archive' WHERE id=?", (email_id,))
                    archived += 1
                elif action == "delete":
                    conn.execute("DELETE FROM emails WHERE id=?", (email_id,))
                    deleted += 1
            if action == "delete":
                break  # email gone, skip remaining rules

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
        elif action == "delete":
            with cache._conn() as conn:
                conn.execute("DELETE FROM emails WHERE id=?", (email.id,))
            return  # stop processing rules for deleted email
