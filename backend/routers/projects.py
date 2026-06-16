"""Email-to-Project Tracker — link emails to named projects."""
import json as _json
import re
import tempfile
import os
import xml.etree.ElementTree as ET
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _ensure_plan_column(conn) -> None:
    """Add plan_json column to projects table if it does not exist yet."""
    try:
        conn.execute("ALTER TABLE projects ADD COLUMN plan_json TEXT")
    except Exception:
        pass  # column already exists


def _strip_json_fences(text: str) -> str:
    """Remove markdown code fences that Claude sometimes wraps JSON in."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _build_msproject_xml(project_name: str, plan: dict) -> str:
    """Build a minimal MSPDI XML string from the plan dict."""
    root = ET.Element("Project", xmlns="http://schemas.microsoft.com/project")
    ET.SubElement(root, "Name").text = project_name
    tasks_el = ET.SubElement(root, "Tasks")

    uid = 0
    for phase in plan.get("phases", []):
        uid += 1
        phase_el = ET.SubElement(tasks_el, "Task")
        ET.SubElement(phase_el, "UID").text = str(uid)
        ET.SubElement(phase_el, "ID").text = str(uid)
        ET.SubElement(phase_el, "Name").text = phase.get("name", "Phase")
        ET.SubElement(phase_el, "Summary").text = "1"
        dur_h = phase.get("duration_weeks", 1) * 5 * 8
        ET.SubElement(phase_el, "Duration").text = f"PT{dur_h}H0M0S"

        for task in phase.get("tasks", []):
            uid += 1
            task_el = ET.SubElement(tasks_el, "Task")
            ET.SubElement(task_el, "UID").text = str(uid)
            ET.SubElement(task_el, "ID").text = str(uid)
            ET.SubElement(task_el, "Name").text = task.get("name", "Task")
            task_dur_h = task.get("duration_days", 1) * 8
            ET.SubElement(task_el, "Duration").text = f"PT{task_dur_h}H0M0S"
            ET.SubElement(task_el, "OutlineLevel").text = "1"

    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")


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


@router.post("/{project_id}/generate-plan")
async def generate_plan(project_id: int, request: Request):
    """Generate an AI project plan from linked emails and store it."""
    cache = request.app.state.cache
    advisor = request.app.state.advisor
    ai = advisor.ai

    with cache._conn() as conn:
        _ensure_plan_column(conn)
        proj = conn.execute(
            "SELECT name, description FROM projects WHERE id=?", (project_id,)
        ).fetchone()
        if not proj:
            raise HTTPException(404, "Project not found")
        email_rows = conn.execute(
            """SELECT e.subject, e.sender, e.date, SUBSTR(e.body, 1, 500) as snippet
               FROM emails e
               JOIN project_emails pe ON pe.email_id = e.id
               WHERE pe.project_id = ?
               ORDER BY e.date DESC LIMIT 20""",
            (project_id,)
        ).fetchall()

    email_context = "\n".join(
        f"- [{r['date']}] From: {r['sender']} | Subject: {r['subject']}\n  {r['snippet']}"
        for r in email_rows
    ) or "(no linked emails)"

    prompt = (
        f"Project: {proj['name']}\n"
        f"Description: {proj['description']}\n\n"
        f"Linked emails:\n{email_context}\n\n"
        "Based on this project and its emails, create a detailed project plan in JSON with:\n"
        '{"summary": "str", "objectives": ["str"], '
        '"phases": [{"name": "str", "start_week": 1, "duration_weeks": 2, '
        '"tasks": [{"name": "str", "duration_days": 3, "assignee": "str", "priority": "high|medium|low"}], '
        '"milestone": "str"}], '
        '"risks": [{"description": "str", "impact": "high|medium|low", "mitigation": "str"}], '
        '"estimated_duration_weeks": 8}\n'
        "Return ONLY valid JSON."
    )

    try:
        ant = getattr(ai, "_anthropic", None)
        client = ant if ant else ai
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = _strip_json_fences(resp.content[0].text)
        s, e = raw.find("{"), raw.rfind("}") + 1
        if s < 0:
            raise ValueError("No JSON object found in AI response")
        plan = _json.loads(raw[s:e])
    except Exception as ex:
        raise HTTPException(502, f"AI plan generation failed: {ex}")

    with cache._conn() as conn:
        _ensure_plan_column(conn)
        conn.execute(
            "UPDATE projects SET plan_json=? WHERE id=?",
            (_json.dumps(plan), project_id)
        )

    return {"plan": plan, "project_id": project_id}


@router.get("/{project_id}/plan")
async def get_plan(project_id: int, request: Request):
    """Return the stored AI project plan, or {plan: null} if none exists."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_plan_column(conn)
        row = conn.execute(
            "SELECT plan_json FROM projects WHERE id=?", (project_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Project not found")
    plan_json = row["plan_json"]
    plan = _json.loads(plan_json) if plan_json else None
    return {"plan": plan}


@router.get("/{project_id}/export/msproject")
async def export_msproject(project_id: int, request: Request):
    """Export the stored project plan as a Microsoft Project XML (MSPDI) file."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_plan_column(conn)
        row = conn.execute(
            "SELECT name, plan_json FROM projects WHERE id=?", (project_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Project not found")
    if not row["plan_json"]:
        raise HTTPException(404, "No plan generated yet — call /generate-plan first")

    plan = _json.loads(row["plan_json"])
    xml_content = _build_msproject_xml(row["name"], plan)

    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".xml", delete=False, encoding="utf-8"
    )
    try:
        tmp.write(xml_content)
        tmp.flush()
        tmp.close()
        safe_name = re.sub(r"[^\w\-.]", "_", row["name"]) + ".xml"
        return FileResponse(
            path=tmp.name,
            media_type="application/xml",
            filename=safe_name,
            background=None,
        )
    except Exception as ex:
        os.unlink(tmp.name)
        raise HTTPException(500, f"XML export failed: {ex}")
