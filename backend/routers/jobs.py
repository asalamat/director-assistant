from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _ensure_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS job_applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company TEXT NOT NULL,
            role TEXT,
            stage TEXT NOT NULL DEFAULT 'applied',
            contact TEXT,
            contact_email TEXT,
            applied_date TEXT,
            last_contact TEXT,
            notes TEXT,
            email_ids TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.commit()


class JobCreate(BaseModel):
    company: str
    role: Optional[str] = None
    stage: str = "applied"
    contact: Optional[str] = None
    contact_email: Optional[str] = None
    applied_date: Optional[str] = None
    notes: Optional[str] = None
    email_ids: Optional[list] = None


class JobPatch(BaseModel):
    company: Optional[str] = None
    role: Optional[str] = None
    stage: Optional[str] = None
    contact: Optional[str] = None
    contact_email: Optional[str] = None
    applied_date: Optional[str] = None
    last_contact: Optional[str] = None
    notes: Optional[str] = None


@router.get("")
async def list_jobs(request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_table(conn)
        rows = conn.execute(
            "SELECT * FROM job_applications ORDER BY created_at DESC"
        ).fetchall()
    return {"jobs": [dict(r) for r in rows]}


@router.post("")
async def create_job(job: JobCreate, request: Request):
    import json
    cache = request.app.state.cache
    email_ids_json = json.dumps(job.email_ids or [])
    with cache._conn() as conn:
        _ensure_table(conn)
        cur = conn.execute(
            """INSERT INTO job_applications
               (company, role, stage, contact, contact_email, applied_date, notes, email_ids)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (job.company, job.role, job.stage, job.contact,
             job.contact_email, job.applied_date, job.notes, email_ids_json),
        )
        conn.commit()
        return {"id": cur.lastrowid}


@router.patch("/{job_id}")
async def update_job(job_id: int, patch: JobPatch, request: Request):
    cache = request.app.state.cache
    fields = {k: v for k, v in patch.model_dump().items() if v is not None}
    if not fields:
        return {"ok": True}
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [job_id]
    with cache._conn() as conn:
        _ensure_table(conn)
        cur = conn.execute(
            f"UPDATE job_applications SET {set_clause} WHERE id = ?", values
        )
        conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, "Job not found")
    return {"ok": True}


@router.delete("/{job_id}")
async def delete_job(job_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        _ensure_table(conn)
        cur = conn.execute("DELETE FROM job_applications WHERE id = ?", (job_id,))
        conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, "Job not found")
    return {"ok": True}


@router.post("/extract")
async def extract_jobs(request: Request):
    """Use AI to scan recent emails for job application activity."""
    import json, re
    cache = request.app.state.cache
    advisor = getattr(request.app.state, "advisor", None)
    if not advisor:
        return {"jobs": [], "error": "AI advisor not available"}

    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT sender, subject, body FROM emails
               WHERE (lower(subject) LIKE '%interview%'
                   OR lower(subject) LIKE '%application%'
                   OR lower(subject) LIKE '%position%'
                   OR lower(subject) LIKE '%recruiter%'
                   OR lower(subject) LIKE '%offer%'
                   OR lower(subject) LIKE '%hiring%'
                   OR lower(body) LIKE '%job application%'
                   OR lower(body) LIKE '%we received your application%'
                   OR lower(body) LIKE '%thank you for applying%')
               ORDER BY date DESC LIMIT 60"""
        ).fetchall()

    if not rows:
        return {"jobs": [], "scanned": 0}

    snippets = "\n---\n".join(
        f"FROM: {r['sender']}\nSUBJECT: {r['subject']}\n{(r['body'] or '')[:300]}"
        for r in rows
    )
    prompt = (
        "From the email snippets below, extract distinct job application entries. "
        "Group emails about the same company+role together. "
        "Return a JSON array of objects with these exact fields: "
        "company (string), role (string or null), "
        "stage (one of: applied/interview_scheduled/interviewed/offer/rejected), "
        "contact (recruiter/HR name or null), contact_email (string or null), "
        "applied_date (YYYY-MM-DD or null). "
        "Return ONLY the JSON array, no markdown, no explanation.\n\n"
        + snippets[:5000]
    )
    try:
        ant = getattr(advisor.ai, "_anthropic", None)
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=1500,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=1500,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()

        m = re.search(r"\[.*\]", text, re.DOTALL)
        if not m:
            return {"jobs": [], "scanned": len(rows)}
        jobs = json.loads(m.group())
        return {"jobs": jobs[:30], "scanned": len(rows)}
    except Exception as exc:
        return {"jobs": [], "error": str(exc), "scanned": len(rows)}


@router.post("/{job_id}/thank-you")
async def draft_thank_you(job_id: int, request: Request):
    """Generate a post-interview thank-you email for a job application."""
    import json
    cache = request.app.state.cache
    advisor = getattr(request.app.state, "advisor", None)
    if not advisor:
        raise HTTPException(503, "AI advisor not available")

    with cache._conn() as conn:
        _ensure_table(conn)
        job = conn.execute(
            "SELECT * FROM job_applications WHERE id = ?", (job_id,)
        ).fetchone()
        if not job:
            raise HTTPException(404, "Job not found")
        job = dict(job)

        email_context = ""
        ids = []
        if job.get("email_ids"):
            try:
                ids = [str(x) for x in json.loads(job["email_ids"])]
            except (ValueError, TypeError):
                ids = []
        if ids:
            ids = ids[:10]
            placeholders = ",".join("?" for _ in ids)
            erows = conn.execute(
                f"SELECT sender, subject, body, date FROM emails "
                f"WHERE id IN ({placeholders}) ORDER BY date DESC LIMIT 10",
                ids,
            ).fetchall()
            if erows:
                email_context = "Relevant email history:\n" + "\n".join(
                    f"- {r['subject']}: {(r['body'] or '')[:200]}" for r in erows
                )

    company = job.get("company") or "the company"
    role = job.get("role") or "the position"
    contact = job.get("contact") or "the hiring team"

    prompt = (
        "Write a professional post-interview thank-you email for the following job application.\n\n"
        f"Company: {company}\n"
        f"Role: {role}\n"
        f"Contact: {contact}\n"
        f"{email_context}\n\n"
        "Write a warm, specific 3-paragraph thank-you email:\n"
        "1. Thank them for their time and the specific conversation topics\n"
        "2. Reiterate your interest and one key strength relevant to the role\n"
        "3. Suggest next steps / express looking forward to hearing back\n\n"
        f'Subject line: "Thank you — {role} interview at {company}"\n'
        "Return: subject on first line, blank line, then body. No markdown."
    )

    try:
        ant = getattr(advisor.ai, "_anthropic", None)
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=600,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=600,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
    except Exception as exc:
        raise HTTPException(500, str(exc))

    lines = text.split("\n", 1)
    subject = lines[0].strip()
    if subject.lower().startswith("subject:"):
        subject = subject[len("subject:"):].strip()
    body = lines[1].strip() if len(lines) > 1 else ""

    return {"subject": subject, "body": body, "to": job.get("contact_email") or ""}
