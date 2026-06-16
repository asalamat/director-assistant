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


@router.get("/{project_id}/documents")
async def list_project_documents(project_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_doc_table(conn)
        rows = conn.execute(
            "SELECT doc_id, filename, linked_at FROM project_documents WHERE project_id=? ORDER BY linked_at",
            (project_id,)
        ).fetchall()
    return {"documents": [dict(r) for r in rows]}


@router.post("/{project_id}/documents")
async def link_document(project_id: int, request: Request):
    body = await request.json()
    doc_id = body.get("doc_id", "").strip()
    filename = body.get("filename", "").strip()
    if not doc_id:
        raise HTTPException(400, "doc_id required")
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_doc_table(conn)
        conn.execute(
            "INSERT OR IGNORE INTO project_documents (project_id, doc_id, filename) VALUES (?,?,?)",
            (project_id, doc_id, filename)
        )
    return {"linked": True}


@router.delete("/{project_id}/documents/{doc_id:path}")
async def unlink_document(project_id: int, doc_id: str, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_doc_table(conn)
        conn.execute(
            "DELETE FROM project_documents WHERE project_id=? AND doc_id=?",
            (project_id, doc_id)
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

def _ensure_doc_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS project_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        doc_id TEXT NOT NULL,
        filename TEXT NOT NULL DEFAULT '',
        linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, doc_id)
    )""")


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
    # Budget columns — safe to run on every startup
    for col, typedef in [("hourly_rate", "REAL DEFAULT 0"), ("budget_total", "REAL DEFAULT 0")]:
        try:
            conn.execute(f"ALTER TABLE project_tasks ADD COLUMN {col} {typedef}")
        except Exception:
            pass


def _ensure_budget_column(conn):
    try:
        conn.execute("ALTER TABLE projects ADD COLUMN budget_total REAL DEFAULT 0")
    except Exception:
        pass


class TaskIn(BaseModel):
    phase_name: str = ""; name: str; assignee: str = ""
    duration_days: int = 1; priority: str = "medium"; depends_on: list = []
    hourly_rate: float = 0.0

class TaskPatch(BaseModel):
    name: Optional[str] = None; assignee: Optional[str] = None
    priority: Optional[str] = None; status: Optional[str] = None
    depends_on: Optional[list] = None; hourly_rate: Optional[float] = None

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
                      t.status, t.depends_on, t.created_at, t.updated_at,
                      COALESCE(t.hourly_rate, 0) as hourly_rate,
                      COUNT(c.id) as comment_count
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
            "INSERT INTO project_tasks (project_id,phase_name,name,assignee,duration_days,priority,depends_on,hourly_rate) VALUES (?,?,?,?,?,?,?,?)",
            (project_id, body.phase_name, body.name.strip(), body.assignee, body.duration_days,
             body.priority, _json.dumps(body.depends_on), body.hourly_rate))
    return {"id": cur.lastrowid}

@router.patch("/{project_id}/tasks/{task_id}")
async def update_task(project_id: int, task_id: int, body: TaskPatch, request: Request):
    cache = request.app.state.cache
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates: return {"ok": True}
    if "depends_on" in updates: updates["depends_on"] = _json.dumps(updates["depends_on"])
    set_clause = ", ".join(f"{k}=?" for k in updates) + ", updated_at=CURRENT_TIMESTAMP"
    with cache._conn() as conn:
        _ensure_task_tables(conn)
        conn.execute(f"UPDATE project_tasks SET {set_clause} WHERE id=? AND project_id=?",
                     list(updates.values()) + [task_id, project_id])
    return {"ok": True}


class BudgetPatch(BaseModel):
    budget_total: float


@router.get("/{project_id}/budget")
async def get_budget(project_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_task_tables(conn)
        _ensure_budget_column(conn)
        proj = conn.execute(
            "SELECT COALESCE(budget_total, 0) as budget_total FROM projects WHERE id=?",
            (project_id,)).fetchone()
        if not proj:
            raise HTTPException(404, "Project not found")
        tasks = conn.execute(
            """SELECT id, phase_name, name, duration_days,
                      COALESCE(hourly_rate, 0) as hourly_rate, status, updated_at
               FROM project_tasks WHERE project_id=? ORDER BY phase_name, id""",
            (project_id,)).fetchall()

    budget_total = proj["budget_total"] or 0.0
    tasks_breakdown = []
    estimated_cost = 0.0
    actual_cost = 0.0

    for t in tasks:
        cost = (t["duration_days"] or 1) * 8 * (t["hourly_rate"] or 0)
        estimated_cost += cost
        if t["status"] == "done":
            actual_cost += cost
        tasks_breakdown.append({
            "id": t["id"],
            "phase_name": t["phase_name"],
            "name": t["name"],
            "duration_days": t["duration_days"] or 1,
            "hourly_rate": t["hourly_rate"] or 0,
            "estimated_cost": cost,
            "status": t["status"],
        })

    return {
        "budget_total": budget_total,
        "estimated_cost": estimated_cost,
        "actual_cost_estimate": actual_cost,
        "tasks_breakdown": tasks_breakdown,
    }


@router.patch("/{project_id}/budget")
async def update_budget(project_id: int, body: BudgetPatch, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_budget_column(conn)
        if not conn.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
        conn.execute("UPDATE projects SET budget_total=? WHERE id=?",
                     (body.budget_total, project_id))
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

# ─── Milestone Tracking ──────────────────────────────────────────────────────

def _ensure_milestone_table(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS project_milestones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""")


class MilestoneIn(BaseModel):
    name: str
    due_date: str


class MilestonePatch(BaseModel):
    status: Optional[str] = None


@router.get("/{project_id}/milestones")
async def list_milestones(project_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_milestone_table(conn)
        rows = conn.execute(
            "SELECT id, name, due_date, status, created_at FROM project_milestones "
            "WHERE project_id=? ORDER BY due_date ASC",
            (project_id,)
        ).fetchall()
    from datetime import date as _date
    today = _date.today().isoformat()
    milestones = []
    for r in rows:
        m = dict(r)
        try:
            due = _date.fromisoformat(r["due_date"])
            delta = (due - _date.today()).days
            m["days_until"] = delta
        except Exception:
            m["days_until"] = None
        milestones.append(m)
    return {"milestones": milestones}


@router.post("/{project_id}/milestones")
async def add_milestone(project_id: int, body: MilestoneIn, request: Request):
    cache = request.app.state.cache
    if not body.name.strip():
        raise HTTPException(400, "Name cannot be empty")
    if not body.due_date.strip():
        raise HTTPException(400, "due_date cannot be empty")
    with cache._conn() as conn:
        _ensure_milestone_table(conn)
        if not conn.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone():
            raise HTTPException(404, "Project not found")
        cur = conn.execute(
            "INSERT INTO project_milestones (project_id, name, due_date) VALUES (?,?,?)",
            (project_id, body.name.strip(), body.due_date.strip())
        )
    return {"id": cur.lastrowid}


@router.patch("/{project_id}/milestones/{milestone_id}")
async def update_milestone(project_id: int, milestone_id: int, body: MilestonePatch, request: Request):
    cache = request.app.state.cache
    if body.status not in ("pending", "done", None):
        raise HTTPException(400, "status must be 'pending' or 'done'")
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        return {"ok": True}
    set_clause = ", ".join(f"{k}=?" for k in updates)
    with cache._conn() as conn:
        conn.execute(
            f"UPDATE project_milestones SET {set_clause} WHERE id=? AND project_id=?",
            list(updates.values()) + [milestone_id, project_id]
        )
    return {"ok": True}


@router.delete("/{project_id}/milestones/{milestone_id}")
async def delete_milestone(project_id: int, milestone_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute(
            "DELETE FROM project_milestones WHERE id=? AND project_id=?",
            (milestone_id, project_id)
        )
    return {"deleted": milestone_id}


@router.post("/{project_id}/tasks/{task_id}/assign-email")
async def assign_email(project_id: int, task_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_task_tables(conn)
        row = conn.execute(
            """SELECT t.name, t.assignee, t.duration_days, t.priority, p.name as project_name
               FROM project_tasks t JOIN projects p ON p.id = t.project_id
               WHERE t.id=? AND t.project_id=?""",
            (task_id, project_id)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Task not found")
    assignee = row["assignee"] or "Team Member"
    subject = f"Task assigned: {row['name']}"
    body = (
        f"Hi {assignee},\n\n"
        f"You've been assigned the following task in project '{row['project_name']}':\n\n"
        f"  Task: {row['name']}\n"
        f"  Duration: {row['duration_days']} day(s)\n"
        f"  Priority: {row['priority']}\n\n"
        "Please confirm receipt and let us know if you have any questions.\n\nThank you."
    )
    return {"subject": subject, "body": body, "to": assignee}


def _ensure_templates_table(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS project_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        template_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")


@router.post("/{project_id}/save-as-template")
async def save_as_template(project_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_task_tables(conn)
        _ensure_templates_table(conn)
        proj = conn.execute("SELECT name FROM projects WHERE id=?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(404, "Project not found")
        tasks = conn.execute(
            "SELECT phase_name, name, duration_days, priority FROM project_tasks WHERE project_id=? ORDER BY phase_name, id",
            (project_id,)
        ).fetchall()
    task_list = [dict(t) for t in tasks]
    template_json = _json.dumps(task_list)
    with cache._conn() as conn:
        _ensure_templates_table(conn)
        cur = conn.execute(
            "INSERT INTO project_templates (name, template_json) VALUES (?,?)",
            (proj["name"], template_json)
        )
    return {"id": cur.lastrowid, "name": proj["name"], "task_count": len(task_list)}


@router.get("/templates")
async def list_templates(request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_templates_table(conn)
        rows = conn.execute(
            "SELECT id, name, created_at, template_json FROM project_templates ORDER BY created_at DESC"
        ).fetchall()
    result = []
    for r in rows:
        tasks = _json.loads(r["template_json"] or "[]")
        result.append({"id": r["id"], "name": r["name"], "created_at": r["created_at"], "task_count": len(tasks)})
    return {"templates": result}


class TemplateProjectIn(BaseModel):
    name: str
    description: str = ""


@router.post("/from-template/{template_id}")
async def create_from_template(template_id: int, body: TemplateProjectIn, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_templates_table(conn)
        tmpl = conn.execute("SELECT * FROM project_templates WHERE id=?", (template_id,)).fetchone()
    if not tmpl:
        raise HTTPException(404, "Template not found")
    tasks = _json.loads(tmpl["template_json"] or "[]")
    with cache._conn() as conn:
        cur = conn.execute(
            "INSERT INTO projects (name, description, status) VALUES (?,?,?)",
            (body.name.strip(), body.description.strip(), "active")
        )
        pid = cur.lastrowid
        _ensure_task_tables(conn)
        for t in tasks:
            conn.execute(
                "INSERT INTO project_tasks (project_id,phase_name,name,duration_days,priority) VALUES (?,?,?,?,?)",
                (pid, t.get("phase_name", ""), t.get("name", "Task"),
                 t.get("duration_days", 1), t.get("priority", "medium"))
            )
    return {"id": pid, "name": body.name, "tasks_created": len(tasks)}


@router.post("/{project_id}/client-report")
async def client_report(project_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_plan_column(conn)
        _ensure_task_tables(conn)
        proj = conn.execute(
            "SELECT name, description, plan_json FROM projects WHERE id=?", (project_id,)
        ).fetchone()
        if not proj:
            raise HTTPException(404, "Project not found")
        tasks = conn.execute(
            "SELECT name, status, priority, phase_name FROM project_tasks WHERE project_id=? ORDER BY phase_name, id",
            (project_id,)
        ).fetchall()

    task_list = [dict(t) for t in tasks]
    total = len(task_list)
    done_count = sum(1 for t in task_list if t["status"] == "done")
    pct = int(done_count / total * 100) if total else 0
    bar_done = int(pct / 5)
    progress_bar = "█" * bar_done + "░" * (20 - bar_done)

    plan: dict = {}
    if proj["plan_json"]:
        try:
            plan = _json.loads(proj["plan_json"])
        except Exception:
            pass

    summary = plan.get("summary") or proj["description"] or "No summary available."
    risks = plan.get("risks", [])
    phases = plan.get("phases", [])

    milestones_html = ""
    for ph in phases:
        ms = ph.get("milestone", "")
        if not ms:
            continue
        ph_tasks = [t for t in task_list if t["phase_name"] == ph.get("name", "")]
        ph_done = bool(ph_tasks) and all(t["status"] == "done" for t in ph_tasks)
        overdue = any(t["status"] == "blocked" for t in ph_tasks)
        icon = "✓" if ph_done else ("⚠" if overdue else "⏳")
        color = "#16a34a" if ph_done else ("#dc2626" if overdue else "#d97706")
        milestones_html += (
            f'<li style="margin-bottom:6px"><span style="color:{color};font-weight:bold">{icon}</span>'
            f' <strong>{ph["name"]}</strong>: {ms}</li>'
        )

    next_tasks = [t for t in task_list if t["status"] in ("in_progress", "not_started")][:3]
    next_html = "".join(
        f'<li style="margin-bottom:4px">{t["name"]} <span style="color:#64748b;font-size:11px">({t["priority"]} priority)</span></li>'
        for t in next_tasks
    )

    risks_html = "".join(
        f'<li style="margin-bottom:4px"><span style="color:{"#dc2626" if r["impact"]=="high" else "#d97706"}">'
        f'{r["impact"].upper()}</span> — {r["description"]}: <em>{r.get("mitigation","")}</em></li>'
        for r in risks
    ) or "<li>No significant risks identified.</li>"

    from datetime import date as _date
    today_str = _date.today().isoformat()

    html = (
        f'<!DOCTYPE html><html><head><meta charset="utf-8">'
        f'<title>{proj["name"]} — Client Status Report</title>'
        f'<style>'
        f'body{{font-family:system-ui,sans-serif;max-width:760px;margin:32px auto;color:#1e293b;font-size:13px;line-height:1.6}}'
        f'h1{{font-size:22px;color:#0f172a;margin-bottom:2px}}'
        f'h2{{font-size:14px;font-weight:700;color:#1e293b;margin:24px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:4px}}'
        f'.progress-wrap{{background:#f1f5f9;border-radius:8px;padding:10px 14px;margin:8px 0}}'
        f'ul{{margin:4px 0 0 18px;padding:0}}li{{margin-bottom:3px}}'
        f'.bar{{font-family:monospace;font-size:13px;color:#2563eb;letter-spacing:1px}}'
        f'@media print{{body{{margin:0}}}}'
        f'</style></head><body>'
        f'<h1>{proj["name"]}</h1>'
        f'<p style="color:#64748b;font-size:12px">Client Status Report &mdash; {today_str}</p>'
        f'<h2>Executive Summary</h2><p>{summary}</p>'
        f'<h2>Milestones</h2><ul>{milestones_html or "<li>No milestones defined yet.</li>"}</ul>'
        f'<h2>Progress</h2>'
        f'<div class="progress-wrap">'
        f'<p style="margin:0 0 4px"><strong>{pct}% complete</strong> &mdash; {done_count} of {total} task(s) done</p>'
        f'<p class="bar">[{progress_bar}] {pct}%</p>'
        f'</div>'
        f'<h2>Next Steps</h2><ul>{next_html or "<li>All tasks complete!</li>"}</ul>'
        f'<h2>Risks &amp; Mitigations</h2><ul>{risks_html}</ul>'
        f'</body></html>'
    )
    return {"html": html}


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
