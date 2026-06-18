"""Imported contacts — vCard upload, export, deduplication, and list."""

import asyncio
import csv
import io
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


_PHONE_COLS = [
    'Mobile Phone', 'Home Phone', 'Work Phone',
    'Home Phone 2', 'Work Phone 2', 'Other Phone', 'Pager', 'Fax',
    'Mobile Phone 2', 'Work Fax', 'Home Fax',
]
_EMAIL_COLS = ['Email', 'Email 2', 'Email 3', 'Yahoo ID']


def _parse_contacts_csv(text: str) -> list[dict]:
    """Parse a contacts CSV (Yahoo format or generic) into contact dicts."""
    contacts = []
    try:
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            # Name
            first = row.get('First Name', '').strip()
            last = row.get('Last Name', '').strip()
            name = row.get('Name', '').strip() or f"{first} {last}".strip()

            # Emails
            emails = []
            for col in _EMAIL_COLS:
                val = row.get(col, '').strip()
                if val and '@' in val:
                    emails.append(val.lower())

            # Phones
            phones = []
            for col in _PHONE_COLS:
                val = row.get(col, '').strip()
                if val and len(re.sub(r'\D', '', val)) >= 7:
                    phones.append(val)

            for email in emails:
                contacts.append({'email': email, 'name': name, 'phones': phones})
    except Exception:
        pass
    return contacts


@router.post("/import-contacts")
async def import_contacts(request: Request, file: UploadFile = File(...)):
    """Import contacts from a .vcf (vCard) or .csv file. Skips duplicates."""
    fname = (file.filename or '').lower()
    if not (fname.endswith('.vcf') or fname.endswith('.csv')):
        raise HTTPException(400, "File must be a .vcf or .csv file")

    content = await file.read()
    try:
        text = content.decode('utf-8')
    except UnicodeDecodeError:
        text = content.decode('latin-1', errors='replace')

    contacts = _parse_contacts_csv(text) if fname.endswith('.csv') else _parse_vcard(text)
    if not contacts:
        return {"imported": 0, "skipped": 0, "total": 0, "message": "No contacts found in file"}

    cache = request.app.state.cache
    imported = 0
    skipped = 0
    source = 'csv' if fname.endswith('.csv') else 'vcard'

    with cache._conn() as conn:
        for c in contacts:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO imported_contacts (email_addr, name, phones, source) VALUES (?,?,?,?)",
                    (c['email'], c['name'], json.dumps(c['phones']), source),
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


@router.patch("/imported/{contact_id}")
async def update_imported(contact_id: int, request: Request):
    """Update name, phones and note for an imported contact."""
    body = await request.json()
    name = (body.get("name") or "").strip()
    phones = [p.strip() for p in (body.get("phones") or []) if p.strip()]
    note = (body.get("note") or "").strip()
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute(
            "UPDATE imported_contacts SET name=?, phones=?, note=? WHERE id=?",
            (name, json.dumps(phones), note, contact_id),
        )
    return {"updated": contact_id, "name": name, "phones": phones, "note": note}


@router.post("/upsert")
async def upsert_contact(request: Request):
    """Create or update a contact by email address (used when editing email-history contacts)."""
    body = await request.json()
    email = (body.get("email_addr") or "").strip().lower()
    if not email:
        raise HTTPException(400, "email_addr required")
    name = (body.get("name") or "").strip()
    phones = [p.strip() for p in (body.get("phones") or []) if p.strip()]
    note = (body.get("note") or "").strip()
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute(
            """INSERT INTO imported_contacts (email_addr, name, phones, note, source)
               VALUES (?,?,?,?,'manual')
               ON CONFLICT(email_addr) DO UPDATE SET
                 name=excluded.name,
                 phones=excluded.phones,
                 note=excluded.note""",
            (email, name, json.dumps(phones), note),
        )
        row = conn.execute(
            "SELECT id, note FROM imported_contacts WHERE email_addr=?", (email,)
        ).fetchone()
    return {"id": row["id"] if row else None, "email_addr": email, "name": name, "phones": phones, "note": note}


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


@router.get("/duplicates")
async def find_duplicates(request: Request):
    """Find imported contacts that share the same normalised name (potential duplicates)."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT id, email_addr, name, phones, source FROM imported_contacts ORDER BY name"
        ).fetchall()

    # Group by lowercased stripped name
    from collections import defaultdict
    groups: dict[str, list] = defaultdict(list)
    for row in rows:
        key = (row["name"] or "").strip().lower()
        if key:
            groups[key].append({
                "id": row["id"],
                "email_addr": row["email_addr"],
                "name": row["name"],
                "phones": json.loads(row["phones"] or "[]"),
                "source": row["source"],
            })

    dupes = [group for group in groups.values() if len(group) > 1]
    return {"duplicate_groups": dupes, "total_groups": len(dupes)}


@router.post("/merge-duplicates")
async def merge_duplicates(request: Request):
    """Merge imported contacts that share the same name.

    For each duplicate group, keeps the record with the most phones (or most
    recent id as tiebreak), merges all unique phone numbers into it, then
    deletes the other records.
    """
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT id, email_addr, name, phones, source FROM imported_contacts ORDER BY name"
        ).fetchall()

    from collections import defaultdict
    groups: dict[str, list] = defaultdict(list)
    for row in rows:
        key = (row["name"] or "").strip().lower()
        if key:
            groups[key].append({
                "id": row["id"],
                "email_addr": row["email_addr"],
                "name": row["name"],
                "phones": json.loads(row["phones"] or "[]"),
                "source": row["source"],
            })

    merged = 0
    removed = 0

    with cache._conn() as conn:
        for group in groups.values():
            if len(group) < 2:
                continue
            # Keep the record with most phones; tiebreak by highest id
            group.sort(key=lambda c: (len(c["phones"]), c["id"]), reverse=True)
            keep = group[0]
            # Merge all unique phones from duplicates into keeper
            all_phones = list(keep["phones"])
            for dup in group[1:]:
                for ph in dup["phones"]:
                    if ph not in all_phones:
                        all_phones.append(ph)
            # Update keeper with merged phones
            conn.execute(
                "UPDATE imported_contacts SET phones = ? WHERE id = ?",
                (json.dumps(all_phones), keep["id"]),
            )
            # Delete the duplicates
            for dup in group[1:]:
                conn.execute("DELETE FROM imported_contacts WHERE id = ?", (dup["id"],))
                removed += 1
            merged += 1

    return {
        "merged_groups": merged,
        "records_removed": removed,
        "message": (
            f"Merged {merged} duplicate group{'s' if merged != 1 else ''}, removed {removed} duplicate record{'s' if removed != 1 else ''}."
            if merged else "No duplicate contacts found."
        ),
    }


@router.post("/fuzzy-merge")
async def fuzzy_merge_contacts(request: Request):
    """Merge contacts with very similar names (handles typos, abbreviations, case variations).

    Uses a simple character-overlap ratio: if two names share >80% of their characters
    (after lowercasing and removing punctuation), they're treated as the same person.
    """
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT id, email_addr, name, phones FROM imported_contacts ORDER BY name"
        ).fetchall()

    def normalize(s: str) -> str:
        import re as _re
        return _re.sub(r'[^a-z0-9]', '', (s or '').lower())

    def similarity(a: str, b: str) -> float:
        na, nb = normalize(a), normalize(b)
        if not na or not nb:
            return 0.0
        longer = max(len(na), len(nb))
        common = sum(1 for c in set(na) if c in nb)
        # Also check if one is a prefix/substring of the other
        is_substring = na in nb or nb in na
        ratio = common / longer
        return max(ratio, 0.9 if is_substring else 0)

    # Group by similar names
    contacts = [{"id": r["id"], "email_addr": r["email_addr"],
                 "name": r["name"] or "", "phones": json.loads(r["phones"] or "[]")}
                for r in rows]

    merged = 0
    removed = 0
    visited = set()

    with cache._conn() as conn:
        for i, c1 in enumerate(contacts):
            if c1["id"] in visited or not c1["name"].strip():
                continue
            group = [c1]
            for j, c2 in enumerate(contacts):
                if i == j or c2["id"] in visited:
                    continue
                if similarity(c1["name"], c2["name"]) >= 0.82:
                    group.append(c2)
            if len(group) < 2:
                continue
            # Keep the one with most phones; merge all phones
            group.sort(key=lambda c: len(c["phones"]), reverse=True)
            keep = group[0]
            all_phones = list(keep["phones"])
            for dup in group[1:]:
                for ph in dup["phones"]:
                    if ph not in all_phones:
                        all_phones.append(ph)
                conn.execute("DELETE FROM imported_contacts WHERE id = ?", (dup["id"],))
                visited.add(dup["id"])
                removed += 1
            conn.execute("UPDATE imported_contacts SET phones = ? WHERE id = ?",
                         (json.dumps(all_phones), keep["id"]))
            visited.add(keep["id"])
            merged += 1

    return {
        "merged_groups": merged,
        "records_removed": removed,
        "message": f"Fuzzy merged {merged} similar-name group(s), removed {removed} record(s)." if merged else "No fuzzy duplicates found.",
    }


@router.post("/hide")
async def hide_contact(request: Request):
    """Hide a contact from the People tab. Accepts JSON body {email_addr: str}."""
    body = await request.json()
    email = (body.get("email_addr") or "").strip().lower()
    if not email:
        raise HTTPException(400, "email_addr required")
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("INSERT OR IGNORE INTO hidden_contacts (email_addr) VALUES (?)", (email,))
        # Also remove from imported_contacts if present
        conn.execute("DELETE FROM imported_contacts WHERE LOWER(email_addr) = ?", (email,))
    return {"hidden": email}


@router.delete("/hide/{email}")
async def unhide_contact(email: str, request: Request):
    """Restore a hidden contact so it shows in the People tab again."""
    from urllib.parse import unquote
    email = unquote(email).strip().lower()
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM hidden_contacts WHERE email_addr = ?", (email,))
    return {"unhidden": email}


@router.get("/hidden")
async def list_hidden(request: Request):
    """List all hidden contacts."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT email_addr, hidden_at FROM hidden_contacts ORDER BY hidden_at DESC"
        ).fetchall()
    return {"hidden": [dict(r) for r in rows]}


_YAHOO_DOMAINS = frozenset({
    'yahoo.com', 'yahoo.ca', 'yahoo.co.uk', 'yahoo.com.au', 'yahoo.fr',
    'yahoo.de', 'yahoo.es', 'yahoo.it', 'yahoo.co.jp', 'yahoo.com.br',
    'ymail.com', 'rocketmail.com',
})


async def _sync_yahoo_carddav(cache, accounts) -> tuple[int, int, str | None]:
    """Fetch contacts from Yahoo CardDAV for all Yahoo accounts.
    Returns (imported, skipped, error_message_or_None)."""
    import httpx
    from base64 import b64encode
    import xml.etree.ElementTree as ET

    yahoo_accs = [
        a for a in accounts
        if getattr(a, 'password', None) and (
            (a.username or '').split('@')[-1].lower() in _YAHOO_DOMAINS
            or getattr(a, 'provider', '') in ('yahoo_imap', 'yahoo')
        )
    ]
    if not yahoo_accs:
        return 0, 0, None

    imported = skipped = 0
    last_error = None

    report_xml = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<CR:addressbook-query xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">'
        '<D:prop><D:getetag/><CR:address-data/></D:prop>'
        '</CR:addressbook-query>'
    )

    for acc in yahoo_accs:
        username = acc.username or ""
        # Try both full email and just the local part (Yahoo varies)
        local_part = username.split('@')[0]
        url_candidates = [
            f"https://carddav.yahoo.com/dav/{username}/addressbook/",
            f"https://carddav.yahoo.com/dav/{local_part}/addressbook/",
        ]
        auth = b64encode(f"{username}:{acc.password}".encode()).decode()

        for url in url_candidates:
            try:
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

                if r.status_code == 401:
                    last_error = f"Yahoo CardDAV: authentication failed (status 401). Make sure you are using an App Password, not your regular Yahoo password."
                    break
                if r.status_code == 403:
                    last_error = f"Yahoo CardDAV: access denied (status 403). Generate a new App Password in Yahoo Account Security."
                    break
                if r.status_code not in (200, 207):
                    last_error = f"Yahoo CardDAV: unexpected status {r.status_code}"
                    continue

                root = ET.fromstring(r.content)
                ns = {'D': 'DAV:', 'CR': 'urn:ietf:params:xml:ns:carddav'}
                vcard_chunks = [
                    el.text for el in root.findall('.//CR:address-data', ns) if el.text
                ]
                if not vcard_chunks:
                    last_error = "Yahoo CardDAV connected but returned 0 contacts — address book may be empty."
                    break

                contacts = _parse_vcard('\n'.join(vcard_chunks))
                with cache._conn() as conn:
                    for ct in contacts:
                        try:
                            conn.execute(
                                "INSERT OR IGNORE INTO imported_contacts (email_addr, name, phones, source)"
                                " VALUES (?,?,?,?)",
                                (ct['email'], ct['name'], json.dumps(ct['phones']), 'yahoo'),
                            )
                            if conn.execute("SELECT changes()").fetchone()[0] > 0:
                                imported += 1
                            else:
                                skipped += 1
                        except Exception:
                            skipped += 1
                last_error = None
                break  # success — no need to try second URL

            except Exception as e:
                err_str = str(e)
                if "nodename nor servname" in err_str or "Name or service not known" in err_str or "getaddrinfo" in err_str:
                    last_error = "Yahoo discontinued their CardDAV service — use '📁 From file' to import a .vcf exported from contacts.yahoo.com instead"
                    break
                last_error = f"Yahoo CardDAV error: {e}"
                continue

    return imported, skipped, last_error


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
    yahoo_error = None
    try:
        y_imp, y_skip, yahoo_error = await _sync_yahoo_carddav(cache, accounts)
        imported += y_imp
        skipped += y_skip
        if y_imp + y_skip > 0 or yahoo_error is None:
            providers.append("Yahoo")
    except Exception as e:
        yahoo_error = str(e)

    # ── Google Contacts ───────────────────────────────────────────────────────────
    try:
        import httpx as _httpx
        google_accs = [
            a for a in accounts
            if getattr(a, "access_token", None)
            and getattr(a, "provider", "") in ("gmail", "google")
        ]
        for g_acc in google_accs:
            token = g_acc.access_token
            url = (
                "https://people.googleapis.com/v1/people/me/connections"
                "?personFields=names,emailAddresses,phoneNumbers&pageSize=500"
            )
            try:
                async with _httpx.AsyncClient(timeout=12.0) as c:
                    r = await c.get(url, headers={"Authorization": f"Bearer {token}"})
                if r.status_code == 401:
                    new_token = await asyncio.get_event_loop().run_in_executor(
                        None, cache.refresh_oauth_token, g_acc.id
                    )
                    if new_token:
                        async with _httpx.AsyncClient(timeout=12.0) as c:
                            r = await c.get(url, headers={"Authorization": f"Bearer {new_token}"})
                if r.status_code == 200:
                    data = r.json()
                    contacts_list = data.get("connections") or []
                    with cache._conn() as conn:
                        for contact in contacts_list:
                            names = contact.get("names") or []
                            name = names[0].get("displayName", "") if names else ""
                            emails_list = contact.get("emailAddresses") or []
                            phones_list = [
                                p.get("value", "") for p in (contact.get("phoneNumbers") or [])
                                if p.get("value")
                            ]
                            for email_obj in emails_list:
                                addr = (email_obj.get("value") or "").strip().lower()
                                if addr and "@" in addr:
                                    try:
                                        conn.execute(
                                            "INSERT OR IGNORE INTO imported_contacts (email_addr, name, phones, source) VALUES (?,?,?,?)",
                                            (addr, name, json.dumps(phones_list), "google"),
                                        )
                                        if conn.execute("SELECT changes()").fetchone()[0] > 0:
                                            imported += 1
                                        else:
                                            skipped += 1
                                    except Exception:
                                        skipped += 1
                    if contacts_list:
                        providers.append("Google")
            except Exception as _ge:
                pass
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
    total = imported + skipped
    if imported == 0 and skipped > 0:
        msg = f"Already up to date — all {skipped} contacts from {provider_label} were previously imported"
    elif imported > 0 and skipped > 0:
        msg = f"Imported {imported} new contacts from {provider_label} ({skipped} already present)"
    elif imported > 0:
        msg = f"Imported {imported} contacts from {provider_label}"
    else:
        msg = f"No contacts found in {provider_label}"
    result: dict = {
        "success": True,
        "imported": imported,
        "skipped": skipped,
        "total": total,
        "provider": provider_label,
        "message": msg,
    }
    if yahoo_error:
        result["yahoo_error"] = yahoo_error
        result["message"] += f" (Yahoo: {yahoo_error})"
    return result


@router.get("/sync-status")
async def sync_status(request: Request):
    """Show which accounts are eligible for auto-sync."""
    cache = request.app.state.cache
    accounts = cache.list_accounts()
    result = []
    for acc in accounts:
        has_token = bool(getattr(acc, "access_token", None))
        has_password = bool(getattr(acc, "password", None))
        domain = (acc.username or "").split("@")[-1].lower()
        is_yahoo = domain in _YAHOO_DOMAINS or getattr(acc, "provider", "") in ("yahoo_imap", "yahoo")
        is_ms365 = has_token and not has_password
        is_google = has_token and getattr(acc, "provider", "") in ("gmail", "google")
        eligible = ("yahoo_carddav" if is_yahoo and has_password else None) or \
                   ("microsoft_graph" if is_ms365 else None) or \
                   ("google_contacts" if is_google else None) or "none"
        result.append({
            "id": acc.id,
            "username": acc.username,
            "provider": getattr(acc, "provider", ""),
            "has_password": has_password,
            "has_token": has_token,
            "eligible_for": eligible,
        })
    with cache._conn() as conn:
        total_imported = conn.execute("SELECT COUNT(*) FROM imported_contacts").fetchone()[0]
    return {"accounts": result, "total_imported_contacts": total_imported}


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


@router.get("/timeline/{email_addr:path}")
async def contact_timeline(email_addr: str, request: Request, limit: int = 50):
    """Chronological email history (oldest first) with a given contact."""
    from urllib.parse import unquote
    addr = unquote(email_addr).strip().lower()
    if not addr:
        raise HTTPException(400, "email_addr required")

    like = f"%{addr}%"
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT id, subject, sender, recipients, date, body, folder
               FROM emails
               WHERE LOWER(sender) LIKE ? OR LOWER(recipients) LIKE ?
               ORDER BY date ASC
               LIMIT ?""",
            (like, like, max(1, min(limit, 500))),
        ).fetchall()

    seen = set()
    emails = []
    for r in rows:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        folder = (r["folder"] or "")
        direction = "sent" if "sent" in folder.lower() else "received"
        raw_body = r["body"] or ""
        snippet = re.sub(r"<[^>]+>", "", raw_body).strip()[:120]
        emails.append({
            "id": r["id"],
            "subject": r["subject"] or "(no subject)",
            "date": r["date"] or "",
            "direction": direction,
            "snippet": snippet,
            "folder": folder,
        })

    return {"emails": emails, "total": len(emails)}


@router.post("/auto-group")
async def auto_group_contacts(request: Request):
    """Use AI to cluster top contacts into named groups."""
    import json as _json
    cache = request.app.state.cache
    advisor = request.app.state.advisor

    # Get top 60 contacts by email frequency
    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT sender, COUNT(*) as cnt
               FROM emails
               WHERE sender NOT LIKE '%noreply%'
               AND sender NOT LIKE '%no-reply%'
               AND sender NOT LIKE '%donotreply%'
               GROUP BY LOWER(sender)
               ORDER BY cnt DESC
               LIMIT 60"""
        ).fetchall()

    if not rows:
        return {"groups": []}

    contacts_text = "\n".join(
        f"- {r['sender']} ({r['cnt']} emails)" for r in rows
    )

    prompt = (
        "Group these email contacts into 4-6 meaningful categories "
        "(e.g. Clients, Team/Colleagues, Vendors, Partners, Newsletters, Other).\n\n"
        f"Contacts:\n{contacts_text}\n\n"
        "Return ONLY valid JSON in this exact format:\n"
        '{"groups": [{"name": "Clients", "color": "blue", "emails": ["email1@x.com", "email2@x.com"]}, ...]}\n'
        "Colors must be one of: blue, green, purple, orange, red, gray.\n"
        "Extract just the email address from each contact string."
    )

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(model="claude-haiku-4-5-20251001", max_tokens=2000,
                messages=[{"role": "user", "content": prompt}])
            text = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=2000,
                messages=[{"role": "user", "content": prompt}])
            text = resp.content[0].text.strip()
        # Strip markdown code fences if present
        text = re.sub(r"```(?:json)?\s*", "", text).strip()
        start, end = text.find("{"), text.rfind("}") + 1
        chunk = text[start:end] if start >= 0 else ""
        # Fix trailing commas before } or ] (common AI JSON mistake)
        chunk = re.sub(r",\s*([}\]])", r"\1", chunk)
        try:
            data = _json.loads(chunk) if chunk else {}
        except Exception:
            data = {}
        groups = data.get("groups", [])
    except Exception as e:
        raise HTTPException(500, f"AI grouping failed: {e}")

    # Build display groups with sender name + email
    sender_map = {
        r["sender"].lower(): r["sender"] for r in rows
    }

    def extract_email(s: str) -> str:
        m = re.search(r"<([^>]+)>", s)
        return (m.group(1) if m else s).strip().lower()

    result = []
    for g in groups:
        members = []
        for addr in g.get("emails", []):
            addr_lower = addr.strip().lower()
            full = sender_map.get(addr_lower)
            if not full:
                # try partial match
                for k, v in sender_map.items():
                    if addr_lower in k or extract_email(k) == addr_lower:
                        full = v
                        break
            if full:
                name_m = re.match(r"^([^<]+)<", full)
                name = name_m.group(1).strip() if name_m else addr
                members.append({"name": name, "email": extract_email(full)})
        if members:
            result.append({"name": g["name"], "color": g.get("color", "gray"), "members": members})

    # Save to cache (simple JSON file beside DB)
    import pathlib
    groups_path = pathlib.Path(cache.db_path).parent / "contact_groups.json"
    groups_path.write_text(_json.dumps(result))

    return {"groups": result}


@router.get("/groups")
async def get_contact_groups(request: Request):
    """Return saved contact groups."""
    import json as _json
    import pathlib
    cache = request.app.state.cache
    groups_path = pathlib.Path(cache.db_path).parent / "contact_groups.json"
    if not groups_path.exists():
        return {"groups": []}
    try:
        return {"groups": _json.loads(groups_path.read_text())}
    except Exception:
        return {"groups": []}
