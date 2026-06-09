"""Export action items to Notion, Jira, and Todoist."""

import base64
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/tasks/export", tags=["tasks-export"])


class NotionExportRequest(BaseModel):
    action_id: int
    title: str
    notes: str = ""


class JiraExportRequest(BaseModel):
    action_id: int
    summary: str
    description: str = ""


class TodoistExportRequest(BaseModel):
    action_id: int
    content: str
    due_string: str = ""


class IntegrationConfig(BaseModel):
    notion_api_key: Optional[str] = None
    notion_database_id: Optional[str] = None
    jira_url: Optional[str] = None
    jira_email: Optional[str] = None
    jira_api_token: Optional[str] = None
    jira_project_key: Optional[str] = None
    todoist_api_token: Optional[str] = None


@router.post("/config")
async def save_integration_config(body: IntegrationConfig):
    """Persist task-export integration credentials."""
    from routers.config import load_app_config, save_app_config
    cfg = load_app_config()
    if body.notion_api_key is not None:
        cfg["notion_api_key"] = body.notion_api_key.strip()
    if body.notion_database_id is not None:
        cfg["notion_database_id"] = body.notion_database_id.strip()
    if body.jira_url is not None:
        cfg["jira_url"] = body.jira_url.strip().rstrip("/")
    if body.jira_email is not None:
        cfg["jira_email"] = body.jira_email.strip()
    if body.jira_api_token is not None:
        cfg["jira_api_token"] = body.jira_api_token.strip()
    if body.jira_project_key is not None:
        cfg["jira_project_key"] = body.jira_project_key.strip()
    if body.todoist_api_token is not None:
        cfg["todoist_api_token"] = body.todoist_api_token.strip()
    save_app_config(cfg)
    return {"saved": True}


@router.get("/config")
async def get_integration_config():
    """Return non-secret integration config fields (no tokens)."""
    from routers.config import load_app_config
    cfg = load_app_config()
    return {
        "jira_url": cfg.get("jira_url", ""),
        "jira_email": cfg.get("jira_email", ""),
        "jira_project_key": cfg.get("jira_project_key", ""),
        "notion_database_id": cfg.get("notion_database_id", ""),
    }


def _load_action(cache, action_id: int) -> Optional[dict]:
    with cache._conn() as conn:
        row = conn.execute(
            "SELECT id, text, email_subject FROM action_items WHERE id = ?",
            (action_id,),
        ).fetchone()
    return dict(row) if row else None


@router.get("/status")
async def export_status(request: Request):
    """Return which task integrations are configured."""
    from routers.config import load_app_config
    cfg = load_app_config()
    return {
        "notion": bool(cfg.get("notion_api_key") and cfg.get("notion_database_id")),
        "jira": bool(
            cfg.get("jira_url") and cfg.get("jira_email")
            and cfg.get("jira_api_token") and cfg.get("jira_project_key")
        ),
        "todoist": bool(cfg.get("todoist_api_token")),
    }


@router.post("/notion")
async def export_to_notion(req: NotionExportRequest, request: Request):
    """Create a page in the configured Notion database."""
    from routers.config import load_app_config
    cfg = load_app_config()
    api_key = cfg.get("notion_api_key", "").strip()
    db_id = cfg.get("notion_database_id", "").strip()
    if not api_key or not db_id:
        raise HTTPException(400, "Notion not configured — add API key and database ID in Settings → Integrations")

    action = _load_action(request.app.state.cache, req.action_id)
    if not action:
        raise HTTPException(404, "Action item not found")

    body = {
        "parent": {"database_id": db_id},
        "properties": {
            "Name": {"title": [{"text": {"content": req.title[:2000]}}]},
        },
    }
    if req.notes:
        body["properties"]["Notes"] = {"rich_text": [{"text": {"content": req.notes[:2000]}}]}

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(
                "https://api.notion.com/v1/pages",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Notion-Version": "2022-06-28",
                    "Content-Type": "application/json",
                },
                json=body,
            )
        if r.status_code not in (200, 201):
            raise HTTPException(502, f"Notion API error {r.status_code}: {r.text[:300]}")
        data = r.json()
        return {"ok": True, "notion_page_id": data.get("id", "")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))


@router.post("/jira")
async def export_to_jira(req: JiraExportRequest, request: Request):
    """Create a Jira issue."""
    from routers.config import load_app_config
    cfg = load_app_config()
    jira_url = cfg.get("jira_url", "").strip().rstrip("/")
    email = cfg.get("jira_email", "").strip()
    token = cfg.get("jira_api_token", "").strip()
    project = cfg.get("jira_project_key", "").strip()
    if not all([jira_url, email, token, project]):
        raise HTTPException(400, "Jira not configured — add all Jira fields in Settings → Integrations")

    action = _load_action(request.app.state.cache, req.action_id)
    if not action:
        raise HTTPException(404, "Action item not found")

    creds = base64.b64encode(f"{email}:{token}".encode()).decode()
    body = {
        "fields": {
            "project": {"key": project},
            "summary": req.summary[:255],
            "issuetype": {"name": "Task"},
        }
    }
    if req.description:
        body["fields"]["description"] = {
            "type": "doc", "version": 1,
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": req.description[:5000]}]}],
        }

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(
                f"{jira_url}/rest/api/3/issue",
                headers={
                    "Authorization": f"Basic {creds}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json=body,
            )
        if r.status_code not in (200, 201):
            raise HTTPException(502, f"Jira API error {r.status_code}: {r.text[:300]}")
        data = r.json()
        return {"ok": True, "jira_issue_key": data.get("key", "")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))


@router.post("/todoist")
async def export_to_todoist(req: TodoistExportRequest, request: Request):
    """Create a Todoist task."""
    from routers.config import load_app_config
    cfg = load_app_config()
    token = cfg.get("todoist_api_token", "").strip()
    if not token:
        raise HTTPException(400, "Todoist not configured — add API token in Settings → Integrations")

    action = _load_action(request.app.state.cache, req.action_id)
    if not action:
        raise HTTPException(404, "Action item not found")

    body: dict = {"content": req.content[:500]}
    if req.due_string:
        body["due_string"] = req.due_string

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(
                "https://api.todoist.com/rest/v2/tasks",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
        if r.status_code not in (200, 204):
            raise HTTPException(502, f"Todoist API error {r.status_code}: {r.text[:300]}")
        data = r.json() if r.content else {}
        return {"ok": True, "todoist_task_id": data.get("id", "")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))
