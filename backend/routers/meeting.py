"""Meeting intelligence — audio transcription and action extraction."""

import contextlib
import json
import os
import tempfile
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List

MAX_WHISPER_BYTES = 24 * 1024 * 1024  # 24 MB safety margin
# Larger than the Whisper limit because _split_and_transcribe chunks long recordings
MAX_MEETING_AUDIO_BYTES = 200 * 1024 * 1024  # 200 MB
ALLOWED_AUDIO_TYPES = {"audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/webm",
                       "audio/ogg", "audio/flac", "audio/x-m4a", "audio/m4a", "audio/mp3",
                       "video/mp4", "video/webm", "video/mpeg"}


async def _transcribe_file(oai_client, file_path: str) -> str:
    """Transcribe a single audio file via Whisper."""
    with open(file_path, "rb") as f:
        result = await oai_client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="text",
        )
    return str(result).strip()


async def _split_and_transcribe(oai_client, audio_path: str, suffix: str) -> str:
    """Split large audio file into chunks and transcribe each."""
    import shutil

    # Check if ffmpeg/pydub available
    if not shutil.which("ffmpeg"):
        # No ffmpeg: just try sending the full file (may fail if truly >25 MB)
        return await _transcribe_file(oai_client, audio_path)

    try:
        from pydub import AudioSegment
        audio = AudioSegment.from_file(audio_path)

        # Split into 10-minute segments
        chunk_ms = 10 * 60 * 1000
        chunks = []
        for i in range(0, len(audio), chunk_ms):
            chunk = audio[i:i + chunk_ms]
            chunk_path = audio_path + f"_chunk{i}.mp3"
            chunk.export(chunk_path, format="mp3", bitrate="64k")
            chunks.append(chunk_path)

        # Transcribe each chunk
        transcripts = []
        for cp in chunks:
            try:
                t = await _transcribe_file(oai_client, cp)
                if t:
                    transcripts.append(t)
            except Exception:
                pass
            finally:
                with contextlib.suppress(Exception):
                    os.unlink(cp)

        return " ".join(transcripts)

    except ImportError:
        # pydub not installed: send full file
        return await _transcribe_file(oai_client, audio_path)

router = APIRouter(prefix="/api/meeting", tags=["meeting"])


class BuildAgendaRequest(BaseModel):
    title: str
    attendees: List[str] = []
    duration_mins: int = 60
    context_notes: Optional[str] = ""


@router.post("/build-agenda")
async def build_agenda(req: BuildAgendaRequest, request: Request):
    """Build a structured meeting agenda from attendees + context pulled from emails/chase queue."""
    if not req.title.strip():
        raise HTTPException(400, "Meeting title is required")

    advisor = request.app.state.advisor
    cache = request.app.state.cache
    rag = request.app.state.rag

    # 1. Pull email context for each attendee via RAG
    attendee_context: list[str] = []
    for person in req.attendees[:6]:
        try:
            results = rag.semantic_search(person, n=4)
            snippets = []
            for doc, meta in zip(results.get("documents", [[]])[0], results.get("metadatas", [[]])[0]):
                subj = meta.get("subject", "")
                sender = meta.get("sender", "")
                snippet = doc[:200].replace("\n", " ") if doc else ""
                if snippet:
                    snippets.append(f"[{subj} / {sender}] {snippet}")
            if snippets:
                attendee_context.append(f"Recent emails about {person}:\n" + "\n".join(snippets[:3]))
        except Exception:
            pass

    # 2. Pull open follow-ups / chase items
    open_items: list[str] = []
    try:
        with cache._conn() as conn:
            rows = conn.execute(
                """SELECT subject, note, sender FROM email_followups
                   WHERE done=0 ORDER BY due_date ASC LIMIT 15"""
            ).fetchall()
            for r in rows:
                line = r[0] or ""
                if r[1]: line += f" ({r[1]})"
                open_items.append(line)
    except Exception:
        pass

    # Build context block for the prompt
    context_parts = []
    if attendee_context:
        context_parts.append("EMAIL CONTEXT:\n" + "\n\n".join(attendee_context))
    if open_items:
        context_parts.append("OPEN FOLLOW-UPS / CHASE ITEMS:\n" + "\n".join(f"- {i}" for i in open_items[:10]))
    if req.context_notes and req.context_notes.strip():
        context_parts.append("ORGANIZER NOTES:\n" + req.context_notes.strip())

    context_block = "\n\n".join(context_parts) if context_parts else "No additional context available."

    attendees_str = ", ".join(req.attendees) if req.attendees else "unspecified"

    prompt = f"""You are an executive assistant. Build a structured meeting agenda.

MEETING: {req.title}
ATTENDEES: {attendees_str}
DURATION: {req.duration_mins} minutes

CONTEXT:
{context_block}

Create a practical agenda. Respond with ONLY valid JSON (no markdown fences):

{{
  "pre_meeting_prep": ["action the organizer should do before the meeting", "..."],
  "agenda_items": [
    {{
      "title": "agenda item title",
      "duration_mins": 10,
      "type": "update|decision|discussion|action-review|intro|wrap-up",
      "points": ["talking point", "..."],
      "questions": ["question to ask attendees", "..."]
    }}
  ],
  "success_criteria": "one sentence: what does a good outcome look like?",
  "follow_up_template": "brief follow-up email template to send after the meeting"
}}

Rules:
- Total duration_mins across all agenda items must equal {req.duration_mins}
- Maximum 6 agenda items
- Include at least 5 min for wrap-up / next steps
- If email context shows pending issues with attendees, include them
- prep_actions: max 4 items, each under 80 chars
"""

    try:
        ant = getattr(advisor.ai, "_anthropic", None)
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=1800,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=1800,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()

        s, e = raw.find("{"), raw.rfind("}") + 1
        data = json.loads(raw[s:e]) if s >= 0 else {}
    except Exception as exc:
        raise HTTPException(502, f"AI agenda generation failed: {exc}") from exc

    return {
        "title": req.title,
        "attendees": req.attendees,
        "duration_mins": req.duration_mins,
        "pre_meeting_prep": data.get("pre_meeting_prep", []),
        "agenda_items": data.get("agenda_items", []),
        "success_criteria": data.get("success_criteria", ""),
        "follow_up_template": data.get("follow_up_template", ""),
    }


class AnalyzeNotesRequest(BaseModel):
    notes: str
    title: Optional[str] = ""


@router.post("/analyze-notes")
async def analyze_notes(req: AnalyzeNotesRequest, request: Request):
    """Analyze pasted meeting notes: extract action items, decisions, follow-up emails, calendar events."""
    if not req.notes.strip():
        raise HTTPException(400, "Notes cannot be empty")

    advisor = request.app.state.advisor
    cache = request.app.state.cache
    title = req.title.strip() or (req.notes[:60].split('\n')[0].strip() + '…')

    prompt = f"""You are an executive assistant analyzing meeting notes.

MEETING TITLE: {title}

MEETING NOTES:
{req.notes[:8000]}

Extract all of the following and respond with ONLY valid JSON (no markdown fences):

{{
  "summary": "2-3 sentence plain-English summary of the meeting",
  "action_items": [
    {{"task": "clear action text", "owner": "person name or 'TBD'", "deadline": "YYYY-MM-DD or 'TBD'", "priority": "high|medium|low"}}
  ],
  "decisions": ["Decision text", "..."],
  "follow_up_emails": [
    {{"to": "recipient name or email if mentioned", "subject": "email subject", "body": "professional email body 2-3 paragraphs"}}
  ],
  "calendar_events": [
    {{"title": "event title", "date_hint": "date/time mentioned or 'TBD'", "duration_mins": 60, "attendees": ["name1", "name2"]}}
  ]
}}

Rules:
- action_items: max 10, each under 120 chars
- decisions: only firm decisions made, not suggestions
- follow_up_emails: only if follow-up emails are clearly needed
- calendar_events: only if next meetings or dates are mentioned
- All arrays may be empty []
"""

    try:
        ant = getattr(advisor.ai, "_anthropic", None)
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()

        s, e = raw.find("{"), raw.rfind("}") + 1
        data = json.loads(raw[s:e]) if s >= 0 else {}
    except Exception as exc:
        raise HTTPException(502, f"AI analysis failed: {exc}") from exc

    result = {
        "title": title,
        "summary": data.get("summary", ""),
        "action_items": data.get("action_items", []),
        "decisions": data.get("decisions", []),
        "follow_up_emails": data.get("follow_up_emails", []),
        "calendar_events": data.get("calendar_events", []),
    }

    # Auto-save to meeting_recordings table so it appears in history
    try:
        action_texts = [a.get("task", "") for a in result["action_items"]]
        with cache._conn() as conn:
            cur = conn.execute(
                """INSERT INTO meeting_recordings (transcript, action_items, draft_email, title)
                   VALUES (?,?,?,?)""",
                (req.notes, json.dumps(action_texts),
                 result["follow_up_emails"][0]["body"] if result["follow_up_emails"] else "",
                 title),
            )
            result["id"] = cur.lastrowid
        rag = request.app.state.rag
        rag._proxy.upsert(
            ids=[f"meeting__{result['id']}"],
            documents=[f"Meeting notes: {title}\n\n{req.notes[:6000]}"],
            metadatas=[{
                "email_id": f"meeting__{result['id']}",
                "source_type": "meeting",
                "subject": f"Meeting: {title}",
                "sender": "meeting", "date": "",
                "meeting_id": str(result["id"]), "meeting_title": title,
            }],
        )
    except Exception:
        pass

    return result


class SaveRecordingRequest(BaseModel):
    transcript: str
    action_items: list[str] = []
    draft_email: str = ""
    duration_secs: int = 0
    title: str = ""


@router.post("/recordings")
async def save_recording(req: SaveRecordingRequest, request: Request):
    """Persist a meeting recording to the database."""
    cache = request.app.state.cache
    title = req.title.strip() or (req.transcript[:60].split('.')[0] + '…')
    with cache._conn() as conn:
        cur = conn.execute(
            """INSERT INTO meeting_recordings (transcript, action_items, draft_email, duration_secs, title)
               VALUES (?,?,?,?,?)""",
            (req.transcript, json.dumps(req.action_items), req.draft_email, req.duration_secs, title),
        )
        rid = cur.lastrowid

    # Index transcript into RAG so Ask can find it (source_type="meeting")
    try:
        rag = request.app.state.rag
        chunk_id = f"meeting__{rid}"
        rag._proxy.upsert(
            ids=[chunk_id],
            documents=[f"Meeting recording: {title}\n\n{req.transcript[:6000]}"],
            metadatas=[{
                "email_id": chunk_id,
                "source_type": "meeting",
                "subject": f"Meeting: {title}",
                "sender": "meeting",
                "date": "",
                "meeting_id": str(rid),
                "meeting_title": title,
            }],
        )
    except Exception:
        pass

    return {"id": rid, "title": title}


@router.get("/recordings")
async def list_recordings(request: Request):
    """List all saved meeting recordings, newest first."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT id, recorded_at, duration_secs, title,
                      substr(transcript, 1, 200) as preview
               FROM meeting_recordings ORDER BY recorded_at DESC LIMIT 50"""
        ).fetchall()
    return {"recordings": [dict(r) for r in rows]}


@router.get("/recordings/{recording_id}")
async def get_recording(recording_id: int, request: Request):
    """Get full detail of a recording."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        row = conn.execute(
            "SELECT * FROM meeting_recordings WHERE id = ?", (recording_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Recording not found")
    d = dict(row)
    d["action_items"] = json.loads(d.get("action_items") or "[]")
    return d


@router.delete("/recordings/{recording_id}")
async def delete_recording(recording_id: int, request: Request):
    """Delete a recording."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM meeting_recordings WHERE id = ?", (recording_id,))
    return {"deleted": recording_id}


@router.post("/transcribe")
async def transcribe_meeting(request: Request, audio: UploadFile = File(...)):
    """Transcribe audio via Whisper, extract action items and draft follow-up email."""
    from routers.config import load_app_config
    cfg = load_app_config()
    openai_key = cfg.get("openai_api_key", "").strip()
    if not openai_key:
        raise HTTPException(400, "OpenAI API key not configured — add it in Settings → App Settings")

    cache = request.app.state.cache

    if audio.content_type and audio.content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(415, f"Unsupported audio type: {audio.content_type}")

    chunks = []
    total = 0
    while chunk := await audio.read(1024 * 1024):
        total += len(chunk)
        if total > MAX_MEETING_AUDIO_BYTES:
            raise HTTPException(413, "Audio too large (max 200 MB)")
        chunks.append(chunk)
    content = b"".join(chunks)
    if not content:
        raise HTTPException(400, "Empty audio file")

    # Determine file suffix from content type or filename
    suffix = ".webm"
    if audio.filename:
        ext = os.path.splitext(audio.filename)[1]
        if ext in (".mp3", ".mp4", ".m4a", ".wav", ".ogg", ".flac", ".webm"):
            suffix = ext

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        from openai import AsyncOpenAI

        # Check if file needs chunking
        file_size = os.path.getsize(tmp_path)
        oai = AsyncOpenAI(api_key=openai_key)

        if file_size > MAX_WHISPER_BYTES:
            transcript = await _split_and_transcribe(oai, tmp_path, suffix)
        else:
            transcript = await _transcribe_file(oai, tmp_path)
        if not transcript:
            return {"transcript": "", "action_items": [], "draft_email": ""}

        # Extract action items and draft follow-up using existing AI
        advisor = request.app.state.advisor
        prompt = f"""You are an executive assistant. A meeting just ended.

MEETING TRANSCRIPT:
{transcript[:6000]}

Extract:
1. A JSON array of concise action items (strings under 120 chars each), max 10 items.
2. A professional follow-up email body (2–4 short paragraphs) summarising key decisions and listing action items.

Respond with valid JSON only, no markdown fences:
{{"action_items": ["...", "..."], "draft_email": "..."}}"""

        draft_email = ""
        action_items: list[str] = []
        try:
            ant = getattr(advisor.ai, "_anthropic", None)
            if ant:
                resp = await ant.messages.create(
                    model="claude-haiku-4-5-20251001", max_tokens=1200,
                    messages=[{"role": "user", "content": prompt}],
                )
                raw = resp.content[0].text.strip()
            else:
                resp = await advisor.ai.messages.create(
                    model="claude-haiku-4-5-20251001", max_tokens=1200,
                    messages=[{"role": "user", "content": prompt}],
                )
                raw = resp.content[0].text.strip()
            s, e = raw.find("{"), raw.rfind("}") + 1
            data = json.loads(raw[s:e]) if s >= 0 else {}
            action_items = data.get("action_items", [])
            draft_email = data.get("draft_email", "")
        except Exception:
            data = {}

        # Auto-save recording to DB and index in RAG
        try:
            auto_title = (transcript[:60].split('.')[0] + '…') if transcript else "Meeting"
            with cache._conn() as conn:
                cur2 = conn.execute(
                    """INSERT INTO meeting_recordings (transcript, action_items, draft_email, title)
                       VALUES (?,?,?,?)""",
                    (transcript, json.dumps(action_items), draft_email, auto_title),
                )
                rid2 = cur2.lastrowid
            rag_engine = request.app.state.rag
            rag_engine._proxy.upsert(
                ids=[f"meeting__{rid2}"],
                documents=[f"Meeting recording: {auto_title}\n\n{transcript[:6000]}"],
                metadatas=[{
                    "email_id": f"meeting__{rid2}",
                    "source_type": "meeting",
                    "subject": f"Meeting: {auto_title}",
                    "sender": "meeting", "date": "",
                    "meeting_id": str(rid2), "meeting_title": auto_title,
                }],
            )
        except Exception:
            pass

        return {
            "transcript": transcript,
            "action_items": action_items,
            "draft_email": draft_email,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Transcription failed: {exc}") from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
