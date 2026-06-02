"""CRUD endpoints for user-defined natural-language triage rules."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/triage-rules", tags=["triage-rules"])


class RuleBody(BaseModel):
    rule: str


@router.get("")
async def list_rules(request: Request):
    return request.app.state.cache.list_triage_rules()


@router.post("")
async def add_rule(body: RuleBody, request: Request):
    if not body.rule.strip():
        raise HTTPException(400, "Rule text cannot be empty")
    rid = request.app.state.cache.add_triage_rule(body.rule)
    return {"id": rid, "rule": body.rule.strip()}


@router.delete("/{rule_id}")
async def delete_rule(rule_id: int, request: Request):
    if not request.app.state.cache.delete_triage_rule(rule_id):
        raise HTTPException(404, "Rule not found")
    return {"ok": True}
