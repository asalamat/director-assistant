"""Imported contacts — vCard upload, export, deduplication, and list."""

import asyncio
import json
import re
from fastapi import APIRouter, Request, UploadFile, File, HTTPException
from fastapi.responses import Response

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


_YAHOO_DOMAINS = frozenset({
    'yahoo.com', 'yahoo.ca', 'yahoo.co.uk', 'yahoo.com.au', 'yahoo.fr',
    'yahoo.de', 'yahoo.es', 'yahoo.it', 'yahoo.co.jp', 'yahoo.com.br',
    'ymail.com', 'rocketmail.com',
})


async def _sync_yahoo_carddav(cache, accounts) -> tuple[int, int]:
    """Fetch contacts from Yahoo CardDAV for all Yahoo accounts."""
    import httpx
    from base64 import b64encode
    try:
        import xml.etree.ElementTree as ET
    except ImportError:
        return 0, 0

    yahoo_accs = [
        a for a in accounts
        if getattr(a, 'password', None) and (
            (a.username or '').split('@')[-1].lower() in _YAHOO_DOMAINS
            or getattr(a, 'provider', '') in ('yahoo_imap', 'yahoo')
        )
    ]
    if not yahoo_accs:
        return 0, 0

    imported = skipped = 0
    report_xml = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<CR:addressbook-query xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">'
        '<D:prop><D:getetag/><CR:address-data/></D:prop>'
        '</CR:addressbook-query>'
    )

    for acc in yahoo_accs:
        try:
            auth = b64encode(f"{acc.username}:{acc.password}".encode()).decode()
            url = f"https://carddav.yahoo.com/dav/{acc.username}/addressbook/"
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as c:
                r = await c.request(
                    "REPORT", url,
                    headers={
                        "Authorization": f"Basic {auth}",
                        "Content-Type": "application/xml; charset=utf-8",
                        "Depth": "1",
                    },
                    content=report_xml.encode('utf-8'),
                )
            if r.status_code not in (200, 207):
                continue

            root = ET.fromstring(r.content)
            ns = {'D': 'DAV:', 'CR': 'urn:ietf:params:xml:ns:carddav'}
            vcard_chunks = [
                el.text for el in root.findall('.//CR:address-data', ns) if el.text
            ]
            if not vcard_chunks:
                continue

            contacts = _parse_vcard('\n'.join(vcard_chunks))
            with cache._conn() as conn:
                for c in contacts:
                    try:
                        conn.execute(
                            "INSERT OR IGNORE INTO imported_contacts (email_addr, name, phones, source)"
                            " VALUES (?,?,?,?)",
                            (c['email'], c['name'], json.dumps(c['phones']), 'yahoo'),
                        )
                        if conn.execute("SELECT changes()").fetchone()[0] > 0:
                            imported += 1
                        else:
                            skipped += 1
                    except Exception:
                        skipped += 1
        except Exception:
            continue

    return imported, skipped


@router.post("/sync-provider")
async def sync_from_provider(request: Request):
    """Auto-import contacts from the connected email provider (no file upload needed).
    Supports Microsoft 365 via Graph API and Yahoo via CardDAV. Skips duplicates."""
    cache = request.app.state.cache
    imported = 0
    skipped = 0
    providers: list[str] = []

    accounts = cache.list_accounts()

    # ── Yahoo CardDAV ─────────────────────────────────────────────────────────
    try:
        y_imp, y_skip = await _sync_yahoo_carddav(cache, accounts)
        if y_imp + y_skip > 0:
            imported += y_imp
            skipped += y_skip
            providers.append("Yahoo")
    except Exception:
        pass

    # ── Microsoft Graph contacts ──────────────────────────────────────────────
    ms_tried = False
    try:
        import httpx
        acc = next(
            (a for a in accounts if getattr(a, "access_token", None) and not getattr(a, "password", None)),
            None,
        )
        if acc:
            ms_tried = True
            token = acc.access_token
            ms_url = (
                "https://graph.microsoft.com/v1.0/me/contacts"
                "?$select=emailAddresses,displayName,homePhones,mobilePhone,businessPhones&$top=500"
            )

            async def _get(tok: str):
                async with httpx.AsyncClient(timeout=12) as c2:
                    r = await c2.get(ms_url, headers={"Authorization": f"Bearer {tok}"})
                    return r.status_code, r.json() if r.status_code in (200, 401) else {}

            status, data = await _get(token)
            if status == 401:
                new_token = await asyncio.get_event_loop().run_in_executor(
                    None, cache.refresh_oauth_token, acc.id
                )
                if new_token:
                    status, data = await _get(new_token)

            if status == 200:
                providers.append("Microsoft 365")
                ms_contacts = []
                for contact in data.get("value", []):
                    phones: list[str] = []
                    for field in ("homePhones", "businessPhones"):
                        phones.extend(contact.get(field) or [])
                    mobile = contact.get("mobilePhone")
                    if mobile:
                        phones.append(mobile)
                    name = contact.get("displayName") or ""
                    for addr_obj in contact.get("emailAddresses") or []:
                        email = (addr_obj.get("address") or "").strip().lower()
                        if email and "@" in email:
                            ms_contacts.append({"email": email, "name": name, "phones": phones})
                with cache._conn() as conn:
                    for c in ms_contacts:
                        try:
                            conn.execute(
                                "INSERT OR IGNORE INTO imported_contacts (email_addr, name, phones, source) VALUES (?,?,?,?)",
                                (c["email"], c["name"], json.dumps(c["phones"]), "microsoft"),
                            )
                            if conn.execute("SELECT changes()").fetchone()[0] > 0:
                                imported += 1
                            else:
                                skipped += 1
                        except Exception:
                            skipped += 1

    except Exception:
        pass

    if not providers:
        return {
            "success": False, "imported": 0, "skipped": 0, "provider": None,
            "message": "No syncable account found. Connect Microsoft 365 or Yahoo (with App Password) in Settings → Accounts.",
        }

    provider_label = " + ".join(providers)
    return {
        "success": True,
        "imported": imported,
        "skipped": skipped,
        "total": imported + skipped,
        "provider": provider_label,
        "message": f"Synced {imported} contacts from {provider_label}, skipped {skipped} already present",
    }


def _vcard_escape(s: str) -> str:
    return s.replace('\\', '\\\\').replace(',', '\\,').replace(';', '\\;').replace('\n', '\\n')


def _build_vcard(name: str, email: str, phones: list[str]) -> str:
    parts = name.strip().split(' ', 1)
    last = _vcard_escape(parts[1] if len(parts) > 1 else '')
    first = _vcard_escape(parts[0] if parts else '')
    fn = _vcard_escape(name.strip() or email)
    lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        f'FN:{fn}',
        f'N:{last};{first};;;',
        f'EMAIL;TYPE=INTERNET:{email}',
    ]
    for ph in phones:
        lines.append(f'TEL;TYPE=VOICE:{ph}')
    lines.append('END:VCARD')
    return '\r\n'.join(lines) + '\r\n'


@router.get("/export-vcard")
async def export_vcard(request: Request):
    """Export all app contacts (email history + imported) as a downloadable .vcf file."""
    cache = request.app.state.cache

    # 1. Collect people from email history: one entry per sender email
    contacts: dict[str, dict] = {}  # email → {name, phones}
    try:
        with cache._conn() as conn:
            rows = conn.execute(
                """SELECT sender FROM emails
                   WHERE sender IS NOT NULL AND sender != ''
                   GROUP BY LOWER(sender)"""
            ).fetchall()
        for row in rows:
            raw = (row['sender'] or '').strip()
            # Parse "Name <email>" or plain "email"
            m = re.match(r'^"?([^"<]+?)"?\s*<([^>]+)>', raw)
            if m:
                name, email = m.group(1).strip(), m.group(2).strip().lower()
            elif '@' in raw:
                email = raw.lower()
                name = email.split('@')[0].replace('.', ' ').replace('_', ' ').title()
            else:
                continue
            if email not in contacts:
                contacts[email] = {'name': name, 'phones': []}
    except Exception:
        pass

    # 2. Merge imported contacts (may add new ones or richer names)
    try:
        with cache._conn() as conn:
            rows = conn.execute(
                "SELECT email_addr, name, phones FROM imported_contacts"
            ).fetchall()
        for row in rows:
            email = row['email_addr'].lower()
            phones = json.loads(row['phones'] or '[]')
            if email in contacts:
                # Prefer imported name if it looks more complete
                if row['name'] and len(row['name']) > len(contacts[email]['name']):
                    contacts[email]['name'] = row['name']
                contacts[email]['phones'] = list(set(contacts[email]['phones'] + phones))
            else:
                contacts[email] = {'name': row['name'] or '', 'phones': phones}
    except Exception:
        pass

    # 3. Merge phone hints from email signatures
    try:
        phone_re = re.compile(r'\+?[\d][\d\s\-\.\(\)]{7,18}[\d]')
        with cache._conn() as conn:
            rows = conn.execute(
                """SELECT sender, body FROM emails
                   WHERE body IS NOT NULL AND length(body) > 50
                   GROUP BY LOWER(sender) HAVING MAX(date) LIMIT 500"""
            ).fetchall()
        for row in rows:
            sender = (row['sender'] or '').strip()
            m = re.match(r'^"?[^"<]+?"?\s*<([^>]+)>', sender)
            email = (m.group(1).strip().lower() if m else sender.lower()) if '@' in sender else ''
            if not email or email not in contacts:
                continue
            body = row['body'] or ''
            sig_lines = body.strip().splitlines()[-5:]
            for raw_ph in phone_re.findall('\n'.join(sig_lines)):
                if len(re.sub(r'\D', '', raw_ph)) >= 10:
                    if raw_ph not in contacts[email]['phones']:
                        contacts[email]['phones'].append(raw_ph)
    except Exception:
        pass

    # Build vCard file
    vcf = ''.join(
        _build_vcard(v['name'], email, v['phones'])
        for email, v in sorted(contacts.items(), key=lambda x: x[1]['name'].lower() or x[0])
    )

    return Response(
        content=vcf.encode('utf-8'),
        media_type='text/vcard',
        headers={'Content-Disposition': 'attachment; filename="director-assistant-contacts.vcf"'},
    )
