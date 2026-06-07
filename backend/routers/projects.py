"""Email-to-Project Tracker — link emails to named projects."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectIn(BaseModel):
    name: str
    description: str = ""
    status: str = "active"


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None


@router.get("")
async def list_projects(request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT p.*, COUNT(pe.email_id) as email_count FROM projects p "
            "LEFT JOIN project_emails pe ON pe.project_id = p.id "
            "GROUP BY p.id ORDER BY p.created_at DESC"
        ).fetchall()
    return {"projects": [dict(r) for r in rows]}


@router.post("")
async def create_project(body: ProjectIn, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        cur = conn.execute(
            "INSERT INTO projects (name, description, status) VALUES (?,?,?)",
            (body.name.strip(), body.description.strip(), body.status)
        )
        pid = cur.lastrowid
    return {"id": pid, "name": body.name}


@router.patch("/{project_id}")
async def update_project(project_id: int, body: ProjectPatch, request: Request):
    cache = request.app.state.cache
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        return {"ok": True}
    set_clause = ", ".join(f"{k}=?" for k in updates)
    with cache._conn() as conn:
        conn.execute(
            f"UPDATE projects SET {set_clause} WHERE id=?",
            list(updates.values()) + [project_id]
        )
    return {"ok": True}


@router.delete("/{project_id}")
async def delete_project(project_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM project_emails WHERE project_id=?", (project_id,))
        conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
    return {"deleted": project_id}


@router.get("/{project_id}/emails")
async def get_project_emails(project_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT e.id, e.subject, e.sender, e.date, e.folder, e.is_read,
                      pe.linked_at,
                      SUBSTR(e.body, 1, 160) as preview
               FROM emails e
               JOIN project_emails pe ON pe.email_id = e.id
               WHERE pe.project_id = ?
               ORDER BY e.date DESC""",
            (project_id,)
        ).fetchall()
    return {"emails": [dict(r) for r in rows]}


@router.post("/{project_id}/emails/{email_id}")
async def link_email(project_id: int, email_id: str, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        proj = conn.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(404, "Project not found")
        try:
            conn.execute(
                "INSERT OR IGNORE INTO project_emails (project_id, email_id) VALUES (?,?)",
                (project_id, email_id)
            )
        except Exception as ex:
            raise HTTPException(500, str(ex))
    return {"linked": True}


@router.delete("/{project_id}/emails/{email_id}")
async def unlink_email(project_id: int, email_id: str, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute(
            "DELETE FROM project_emails WHERE project_id=? AND email_id=?",
            (project_id, email_id)
        )
    return {"unlinked": True}


@router.get("/for-email/{email_id}")
async def get_projects_for_email(email_id: str, request: Request):
    """Return which projects this email is linked to."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT p.id, p.name, p.status FROM projects p
               JOIN project_emails pe ON pe.project_id = p.id
               WHERE pe.email_id = ?""",
            (email_id,)
        ).fetchall()
    return {"projects": [dict(r) for r in rows]}
