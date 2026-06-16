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
    try:
        conn.execute("ALTER TABLE projects ADD COLUMN plan_json TEXT")
    except Exception:
        pass


def _ensure_notes_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS project_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        note TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""")


def _strip_json_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    return re.sub(r"\s*```$", "", text).strip()


def _build_msproject_xml(project_name: str, plan: dict) -> str:
    root = ET.Element("Project", xmlns="http://schemas.microsoft.com/project")
    ET.SubElement(root, "Name").text = project_name
    tasks_el = ET.SubElement(root, "Tasks")
    uid = 0
    for phase in plan.get("phases", []):
        uid += 1
        ph = ET.SubElement(tasks_el, "Task")
        ET.SubElement(ph, "UID").text = str(uid)
        ET.SubElement(ph, "ID").text = str(uid)
        ET.SubElement(ph, "Name").text = phase.get("name", "Phase")
        ET.SubElement(ph, "Summary").text = "1"
        ET.SubElement(ph, "Duration").text = f"PT{phase.get('duration_weeks',1)*40}H0M0S"
        for task in phase.get("tasks", []):
            uid += 1
            tk = ET.SubElement(tasks_el, "Task")
            ET.SubElement(tk, "UID").text = str(uid)
            ET.SubElement(tk, "ID").text = str(uid)
            ET.SubElement(tk, "Name").text = task.get("name", "Task")
            ET.SubElement(tk, "Duration").text = f"PT{task.get('duration_days',1)*8}H0M0S"
            ET.SubElement(tk, "OutlineLevel").text = "1"
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
                      pe.linked_at, SUBSTR(e.body, 1, 160) as preview
               FROM emails e
               JOIN project_emails pe ON pe.email_id = e.id
               WHERE pe.project_id = ? ORDER BY e.date DESC""",
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
    cache = request.app.state.cache
    rag = getattr(request.app.state, "rag", None)
    ai = request.app.state.advisor.ai
    with cache._conn() as conn:
        _ensure_plan_column(conn)
        proj = conn.execute(
            "SELECT name, description FROM projects WHERE id=?", (project_id,)
        ).fetchone()
        if not proj:
            raise HTTPException(404, "Project not found")
        email_rows = conn.execute(
            """SELECT e.subject, e.sender, e.date, SUBSTR(e.body, 1, 600) as snippet
               FROM emails e JOIN project_emails pe ON pe.email_id = e.id
               WHERE pe.project_id = ? ORDER BY e.date DESC LIMIT 20""",
            (project_id,)
        ).fetchall()

    email_ctx = "\n".join(
        f"- [{r['date']}] From: {r['sender']} | {r['subject']}\n  {r['snippet']}"
        for r in email_rows
    ) or "(no linked emails)"

    # Enrich with RAG: semantic search across ALL indexed emails + documents
    rag_ctx = ""
    if rag:
        query = f"{proj['name']} {proj['description'] or ''}"
        try:
            results = rag.hybrid_search(query, n=12)
            seen_ids = {r["email_id"] for r in email_rows} if email_rows else set()
            rag_snippets = []
            for r in results:
                src_type = r.get("source_type", "email")
                rid = r.get("email_id") or r.get("doc_id", "")
                if rid in seen_ids:
                    continue
                seen_ids.add(rid)
                if src_type == "document":
                    rag_snippets.append(f"[DOC] {r.get('filename','')}: {(r.get('text') or '')[:300]}")
                else:
                    rag_snippets.append(f"[EMAIL] {r.get('date','')} {r.get('sender','')} | {r.get('subject','')}: {(r.get('text') or '')[:200]}")
            if rag_snippets:
                rag_ctx = "\n\nAdditional relevant content from knowledge base:\n" + "\n".join(rag_snippets[:8])
        except Exception:
            pass

    prompt = (
        f"Project: {proj['name']}\nProject Brief:\n{proj['description'] or '(no description)'}\n\n"
        f"Directly linked emails:\n{email_ctx}"
        f"{rag_ctx}\n\n"
        "Using ALL the above context, create a comprehensive detailed project plan in JSON:\n"
        '{"summary":"str","objectives":["str"],'
        '"phases":[{"name":"str","start_week":1,"duration_weeks":2,'
        '"tasks":[{"name":"str","duration_days":3,"assignee":"str","priority":"high|medium|low"}],'
        '"milestone":"str"}],'
        '"risks":[{"description":"str","impact":"high|medium|low","mitigation":"str"}],'
        '"estimated_duration_weeks":8}\nReturn ONLY valid JSON.'
    )

    try:
        client = getattr(ai, "_anthropic", None) or ai
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = _strip_json_fences(resp.content[0].text)
        s, e = raw.find("{"), raw.rfind("}") + 1
        if s < 0:
            raise ValueError("No JSON object in AI response")
        plan = _json.loads(raw[s:e])
    except Exception as ex:
        raise HTTPException(502, f"AI plan generation failed: {ex}")

    with cache._conn() as conn:
        _ensure_plan_column(conn)
        conn.execute("UPDATE projects SET plan_json=? WHERE id=?",
                     (_json.dumps(plan), project_id))
    return {"plan": plan, "project_id": project_id}


@router.get("/{project_id}/plan")
async def get_plan(project_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_plan_column(conn)
        row = conn.execute(
            "SELECT plan_json FROM projects WHERE id=?", (project_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Project not found")
    plan = _json.loads(row["plan_json"]) if row["plan_json"] else None
    return {"plan": plan}


@router.get("/{project_id}/export/msproject")
async def export_msproject(project_id: int, request: Request):
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
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".xml", delete=False, encoding="utf-8")
    try:
        tmp.write(xml_content)
        tmp.flush()
        tmp.close()
        safe_name = re.sub(r"[^\w\-.]", "_", row["name"]) + ".xml"
        return FileResponse(path=tmp.name, media_type="application/xml", filename=safe_name)
    except Exception as ex:
        os.unlink(tmp.name)
        raise HTTPException(500, f"XML export failed: {ex}")


class NoteIn(BaseModel):
    note: str


@router.get("/{project_id}/notes")
async def get_notes(project_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_notes_table(conn)
        rows = conn.execute(
            "SELECT id, note, created_at FROM project_notes WHERE project_id=? ORDER BY created_at ASC",
            (project_id,)
        ).fetchall()
    return {"notes": [dict(r) for r in rows]}


@router.post("/{project_id}/notes")
async def add_note(project_id: int, body: NoteIn, request: Request):
    cache = request.app.state.cache
    if not body.note.strip():
        raise HTTPException(400, "Note cannot be empty")
    with cache._conn() as conn:
        _ensure_notes_table(conn)
        cur = conn.execute(
            "INSERT INTO project_notes (project_id, note) VALUES (?,?)",
            (project_id, body.note.strip())
        )
    return {"id": cur.lastrowid, "note": body.note.strip()}


@router.delete("/{project_id}/notes/{note_id}")
async def delete_note(project_id: int, note_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM project_notes WHERE id=? AND project_id=?", (note_id, project_id))
    return {"deleted": note_id}


@router.post("/{project_id}/recommendations")
async def get_recommendations(project_id: int, request: Request):
    """AI reviews progress notes against the current plan and gives recommendations."""
    cache = request.app.state.cache
    ai = request.app.state.advisor.ai
    with cache._conn() as conn:
        _ensure_plan_column(conn)
        _ensure_notes_table(conn)
        proj = conn.execute("SELECT name, plan_json FROM projects WHERE id=?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(404, "Project not found")
        notes = conn.execute(
            "SELECT note, created_at FROM project_notes WHERE project_id=? ORDER BY created_at ASC",
            (project_id,)
        ).fetchall()

    notes_text = "\n".join(f"[{r['created_at'][:10]}] {r['note']}" for r in notes) or "(no notes)"
    plan_summary = ""
    if proj["plan_json"]:
        try:
            p = _json.loads(proj["plan_json"])
            phases = ", ".join(ph.get("name","") for ph in p.get("phases", []))
            plan_summary = f"Plan summary: {p.get('summary','')}\nPhases: {phases}\nDuration: {p.get('estimated_duration_weeks')} weeks"
        except Exception:
            pass

    prompt = (
        f"Project: {proj['name']}\n{plan_summary}\n\n"
        f"Progress notes from the team:\n{notes_text}\n\n"
        "Based on these progress notes, provide:\n"
        "1. What is on track (2-3 bullet points)\n"
        "2. What needs attention or is at risk (2-3 bullets)\n"
        "3. Specific recommendations to update the plan (2-3 actionable bullets)\n"
        "4. Overall health: GREEN / AMBER / RED with a one-sentence reason\n\n"
        'Return ONLY JSON: {"on_track":["str"],"at_risk":["str"],"recommendations":["str"],"health":"GREEN|AMBER|RED","health_reason":"str"}'
    )

    try:
        client = getattr(ai, "_anthropic", None) or ai
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=800,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = _strip_json_fences(resp.content[0].text)
        s, e = raw.find("{"), raw.rfind("}") + 1
        result = _json.loads(raw[s:e]) if s >= 0 else {}
    except Exception as ex:
        raise HTTPException(502, f"AI recommendations failed: {ex}")

    return {"recommendations": result, "note_count": len(notes)}


# ─── Task Management ─────────────────────────────────────────────────────────

def _ensure_task_tables(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS project_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
        phase_name TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
        assignee TEXT NOT NULL DEFAULT '', duration_days INTEGER DEFAULT 1,
        priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'not_started',
        depends_on TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS project_task_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL,
        comment TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")

class TaskIn(BaseModel):
    phase_name: str = ""; name: str; assignee: str = ""
    duration_days: int = 1; priority: str = "medium"; depends_on: list = []

class TaskPatch(BaseModel):
    name: Optional[str] = None; assignee: Optional[str] = None
    priority: Optional[str] = None; status: Optional[str] = None
    depends_on: Optional[list] = None

class CommentIn(BaseModel):
    comment: str

def _ai_client(ai):
    return getattr(ai, "_anthropic", None) or ai

async def _ai_json(ai, prompt, max_tokens=300):
    client = _ai_client(ai)
    resp = await client.messages.create(model="claude-haiku-4-5-20251001",
        max_tokens=max_tokens, messages=[{"role": "user", "content": prompt}])
    raw = _strip_json_fences(resp.content[0].text)
    s, e = raw.find("{"), raw.rfind("}") + 1
    return _json.loads(raw[s:e]) if s >= 0 else {}

@router.post("/{project_id}/tasks/from-plan")
async def tasks_from_plan(project_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_plan_column(conn); _ensure_task_tables(conn)
        proj = conn.execute("SELECT plan_json FROM projects WHERE id=?", (project_id,)).fetchone()
        if not proj: raise HTTPException(404, "Project not found")
        if not proj["plan_json"]: raise HTTPException(404, "No plan — call /generate-plan first")
        plan = _json.loads(proj["plan_json"])
        conn.execute("DELETE FROM project_tasks WHERE project_id=?", (project_id,))
        count = 0
        for phase in plan.get("phases", []):
            pname = phase.get("name", "")
            for t in phase.get("tasks", []):
                conn.execute(
                    "INSERT INTO project_tasks (project_id,phase_name,name,assignee,duration_days,priority) VALUES (?,?,?,?,?,?)",
                    (project_id, pname, t.get("name","Task"), t.get("assignee",""), t.get("duration_days",1), t.get("priority","medium")))
                count += 1
    return {"inserted": count}

@router.get("/{project_id}/tasks")
async def list_tasks(project_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_task_tables(conn)
        rows = conn.execute(
            """SELECT t.id, t.phase_name, t.name, t.assignee, t.duration_days, t.priority,
                      t.status, t.depends_on, t.created_at, COUNT(c.id) as comment_count
               FROM project_tasks t LEFT JOIN project_task_comments c ON c.task_id = t.id
               WHERE t.project_id=? GROUP BY t.id ORDER BY t.phase_name, t.id""",
            (project_id,)).fetchall()
    return {"tasks": [{**dict(r), "depends_on": _json.loads(r["depends_on"] or "[]")} for r in rows]}

@router.post("/{project_id}/tasks")
async def create_task(project_id: int, body: TaskIn, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_task_tables(conn)
        if not conn.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
        cur = conn.execute(
            "INSERT INTO project_tasks (project_id,phase_name,name,assignee,duration_days,priority,depends_on) VALUES (?,?,?,?,?,?,?)",
            (project_id, body.phase_name, body.name.strip(), body.assignee, body.duration_days, body.priority, _json.dumps(body.depends_on)))
    return {"id": cur.lastrowid}

@router.patch("/{project_id}/tasks/{task_id}")
async def update_task(project_id: int, task_id: int, body: TaskPatch, request: Request):
    cache = request.app.state.cache
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates: return {"ok": True}
    if "depends_on" in updates: updates["depends_on"] = _json.dumps(updates["depends_on"])
    set_clause = ", ".join(f"{k}=?" for k in updates) + ", updated_at=CURRENT_TIMESTAMP"
    with cache._conn() as conn:
        conn.execute(f"UPDATE project_tasks SET {set_clause} WHERE id=? AND project_id=?",
                     list(updates.values()) + [task_id, project_id])
    return {"ok": True}

@router.delete("/{project_id}/tasks/{task_id}")
async def delete_task(project_id: int, task_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM project_task_comments WHERE task_id=?", (task_id,))
        conn.execute("DELETE FROM project_tasks WHERE id=? AND project_id=?", (task_id, project_id))
    return {"deleted": task_id}

@router.get("/{project_id}/tasks/{task_id}/comments")
async def list_comments(project_id: int, task_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_task_tables(conn)
        rows = conn.execute(
            "SELECT id, comment, created_at FROM project_task_comments WHERE task_id=? ORDER BY created_at ASC",
            (task_id,)).fetchall()
    return {"comments": [dict(r) for r in rows]}

@router.post("/{project_id}/tasks/{task_id}/comments")
async def add_comment(project_id: int, task_id: int, body: CommentIn, request: Request):
    if not body.comment.strip(): raise HTTPException(400, "Comment cannot be empty")
    cache = request.app.state.cache
    ai = request.app.state.advisor.ai
    with cache._conn() as conn:
        _ensure_task_tables(conn)
        task = conn.execute("SELECT name FROM project_tasks WHERE id=? AND project_id=?",
                            (task_id, project_id)).fetchone()
        if not task: raise HTTPException(404, "Task not found")
        cur = conn.execute("INSERT INTO project_task_comments (task_id, comment) VALUES (?,?)",
                           (task_id, body.comment.strip()))
        cid = cur.lastrowid
        prev = conn.execute(
            "SELECT comment FROM project_task_comments WHERE task_id=? AND id!=? ORDER BY created_at DESC LIMIT 5",
            (task_id, cid)).fetchall()
    suggestions = []
    try:
        prev_text = "; ".join(r["comment"] for r in prev) or "(none)"
        prompt = (f'Task: {task["name"]}. Latest comment: {body.comment.strip()}. '
                  f'Previous: {prev_text}. Suggest 1-2 next actions as JSON: {{"suggestions": ["str","str"]}}')
        data = await _ai_json(ai, prompt, 200)
        suggestions = data.get("suggestions", [])
    except Exception:
        pass
    return {"id": cid, "comment": body.comment.strip(), "suggestions": suggestions}

@router.post("/{project_id}/weekly-update")
async def weekly_update(project_id: int, request: Request):
    cache = request.app.state.cache
    ai = request.app.state.advisor.ai
    with cache._conn() as conn:
        _ensure_task_tables(conn)
        proj = conn.execute("SELECT name FROM projects WHERE id=?", (project_id,)).fetchone()
        if not proj: raise HTTPException(404, "Project not found")
        tasks = conn.execute("SELECT status FROM project_tasks WHERE project_id=?", (project_id,)).fetchall()
        recent = conn.execute(
            """SELECT c.comment, t.name as task_name FROM project_task_comments c
               JOIN project_tasks t ON t.id = c.task_id
               WHERE t.project_id=? AND c.created_at >= datetime('now','-7 days')
               ORDER BY c.created_at DESC LIMIT 20""", (project_id,)).fetchall()
    counts = {"done": 0, "in_progress": 0, "blocked": 0, "not_started": 0}
    for t in tasks: counts[t["status"]] = counts.get(t["status"], 0) + 1
    activity = "; ".join(f"[{r['task_name']}] {r['comment']}" for r in recent) or "(no recent activity)"
    prompt = (f"Project: {proj['name']}. Tasks: done={counts['done']}, in_progress={counts['in_progress']}, "
              f"blocked={counts['blocked']}, not_started={counts['not_started']}. "
              f"Recent activity: {activity}. Write a 150-word weekly update email summarizing progress, "
              f"blockers, and next week's focus. Return ONLY JSON: {{\"subject\": \"str\", \"body\": \"str\"}}")
    try:
        result = await _ai_json(ai, prompt, 400)
        if not result: raise ValueError("empty")
    except Exception as ex:
        raise HTTPException(502, f"AI weekly update failed: {ex}")
    return result
