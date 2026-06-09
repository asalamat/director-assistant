"""Imported contacts — vCard upload, deduplication, and list."""

import json
import re
from fastapi import APIRouter, Request, UploadFile, File, HTTPException

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


def _parse_vcard(text: str) -> list[dict]:
    """Parse a vCard file into a list of {email, name, phones} dicts."""
    contacts = []
    # Split on END:VCARD to get individual cards
    for block in re.split(r'END:VCARD', text, flags=re.IGNORECASE):
        block = block.strip()
        if 'BEGIN:VCARD' not in block.upper():
            continue
        name = ''
        emails: list[str] = []
        phones: list[str] = []
        # Handle line folding (lines starting with space/tab continue previous)
        unfolded = re.sub(r'\r?\n[ \t]', '', block)
        for line in unfolded.splitlines():
            line = line.strip()
            upper = line.upper()
            if upper.startswith('FN:'):
                name = line[3:].strip()
            elif re.match(r'EMAIL[;:]', line, re.IGNORECASE):
                val = line.split(':', 1)[-1].strip()
                if '@' in val:
                    emails.append(val.lower())
            elif re.match(r'TEL[;:]', line, re.IGNORECASE):
                val = line.split(':', 1)[-1].strip()
                if val:
                    phones.append(val)
        for email in emails:
            if email and '@' in email:
                contacts.append({'email': email, 'name': name, 'phones': phones})
    return contacts


@router.post("/import-vcard")
async def import_vcard(request: Request, file: UploadFile = File(...)):
    """Import contacts from a .vcf vCard file. Skips existing email addresses (no duplicates)."""
    if not file.filename or not file.filename.lower().endswith('.vcf'):
        raise HTTPException(400, "File must be a .vcf vCard file")

    content = await file.read()
    try:
        text = content.decode('utf-8')
    except UnicodeDecodeError:
        text = content.decode('latin-1', errors='replace')

    contacts = _parse_vcard(text)
    if not contacts:
        return {"imported": 0, "skipped": 0, "total": 0, "message": "No contacts found in file"}

    cache = request.app.state.cache
    imported = 0
    skipped = 0

    with cache._conn() as conn:
        for c in contacts:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO imported_contacts (email_addr, name, phones, source) VALUES (?,?,?,?)",
                    (c['email'], c['name'], json.dumps(c['phones']), 'vcard'),
                )
                if conn.execute("SELECT changes()").fetchone()[0] > 0:
                    imported += 1
                else:
                    skipped += 1
            except Exception:
                skipped += 1

    return {
        "imported": imported,
        "skipped": skipped,
        "total": len(contacts),
        "message": f"Imported {imported} contacts, skipped {skipped} duplicates",
    }


@router.get("/imported")
async def list_imported(request: Request):
    """List all imported contacts."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT id, email_addr, name, phones, source, imported_at FROM imported_contacts ORDER BY name"
        ).fetchall()
    return {
        "contacts": [
            {**dict(r), "phones": json.loads(r["phones"] or "[]")}
            for r in rows
        ]
    }


@router.delete("/imported/{contact_id}")
async def delete_imported(contact_id: int, request: Request):
    """Remove a single imported contact."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM imported_contacts WHERE id = ?", (contact_id,))
    return {"removed": contact_id}


@router.delete("/imported")
async def clear_imported(request: Request):
    """Remove all imported contacts."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM imported_contacts")
    return {"cleared": True}
