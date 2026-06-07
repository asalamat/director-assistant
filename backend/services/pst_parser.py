"""
PST file importer — parses Outlook .pst files and ingests emails into the cache + RAG engine.

Strategy (in order of preference):
  1. pypff  — Python bindings for libpff; most complete parser
  2. readpst (libpst) — command-line tool, converts PST → mbox, then parsed with mailbox module
  3. Raise ImportError with installation instructions if neither is available
"""

from __future__ import annotations

import asyncio
import email as _email_module
import hashlib
import mailbox
import os
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

from models import EmailMessage


# ── Detection ─────────────────────────────────────────────────────────────────

def _detect_backend() -> str:
    """Return 'pypff', 'readpst', or raise ImportError."""
    try:
        import pypff
        # Verify the expected API exists (older pypff uses pypff.file(),
        # newer builds may have changed the API)
        if hasattr(pypff, "file"):
            return "pypff"
        # pypff imported but API changed — fall through to readpst
    except ImportError:
        pass
    try:
        result = subprocess.run(["readpst", "--version"], capture_output=True, timeout=5)
        if result.returncode == 0 or b"readpst" in result.stderr:
            return "readpst"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    raise ImportError(
        "No PST parser found. Install one of:\n"
        "  pip install pypff\n"
        "  brew install libpst  (macOS, provides readpst)"
    )


# ── pypff parser ──────────────────────────────────────────────────────────────

def _iter_pypff(pst_path: str) -> Generator[dict, None, None]:
    import pypff

    def _walk_folder(folder, folder_name: str):
        for i in range(folder.get_number_of_sub_messages()):
            try:
                msg = folder.get_sub_message(i)
                plain = ""
                html = ""
                for j in range(msg.get_number_of_attachments() if hasattr(msg, "get_number_of_attachments") else 0):
                    pass  # skip attachments
                # Body
                try:
                    plain = msg.get_plain_text_body() or ""
                    if isinstance(plain, bytes):
                        plain = plain.decode("utf-8", errors="replace")
                except Exception:
                    plain = ""
                try:
                    html = msg.get_html_body() or ""
                    if isinstance(html, bytes):
                        html = html.decode("utf-8", errors="replace")
                except Exception:
                    html = ""

                # Date
                delivery = msg.get_delivery_time()
                if delivery:
                    try:
                        date_str = delivery.isoformat()
                    except Exception:
                        date_str = str(delivery)
                else:
                    date_str = None

                # Sender
                sender = ""
                try:
                    sender = msg.get_sender_email_address() or msg.get_sender_name() or ""
                except Exception:
                    pass

                # Recipients
                recipients: list[str] = []
                try:
                    for k in range(msg.get_number_of_recipients()):
                        r = msg.get_recipient(k)
                        addr = r.get_email_address() or r.get_display_name() or ""
                        if addr:
                            recipients.append(addr)
                except Exception:
                    pass

                subject = ""
                try:
                    subject = msg.get_subject() or ""
                    if isinstance(subject, bytes):
                        subject = subject.decode("utf-8", errors="replace")
                except Exception:
                    pass

                # Stable ID: hash of (folder, subject, sender, date)
                uid = hashlib.md5(f"{folder_name}|{subject}|{sender}|{date_str}".encode()).hexdigest()[:16]

                yield {
                    "id": f"pst_{uid}",
                    "subject": subject,
                    "sender": sender,
                    "recipients": recipients,
                    "date": date_str,
                    "body": plain,
                    "body_html": html if html else None,
                    "folder": folder_name,
                    "is_read": True,  # PST items are historical — treat as read
                    "thread_id": None,
                }
            except Exception:
                continue

        for j in range(folder.get_number_of_sub_folders()):
            sub = folder.get_sub_folder(j)
            sub_name = sub.get_name() or f"Folder{j}"
            if isinstance(sub_name, bytes):
                sub_name = sub_name.decode("utf-8", errors="replace")
            yield from _walk_folder(sub, sub_name)

    # Support both old API (pypff.file()) and potential new APIs
    try:
        pst = pypff.file()
        pst.open(pst_path)
    except AttributeError:
        # API changed in this build — fall back silently (caller will use readpst)
        return
    root = pst.get_root_folder()
    if root:
        yield from _walk_folder(root, "INBOX")
    pst.close()


# ── readpst / mbox parser ─────────────────────────────────────────────────────

def _iter_readpst(pst_path: str) -> Generator[dict, None, None]:
    with tempfile.TemporaryDirectory() as tmpdir:
        subprocess.run(
            ["readpst", "-o", tmpdir, "-r", pst_path],
            capture_output=True, timeout=300,
        )
        for mbox_path in Path(tmpdir).rglob("*.mbox"):
            folder_name = mbox_path.stem or "INBOX"
            try:
                mb = mailbox.mbox(str(mbox_path))
                for msg in mb:
                    try:
                        subject = msg.get("Subject", "")
                        sender  = msg.get("From", "")
                        to_raw  = msg.get("To", "")
                        date_raw = msg.get("Date", "")

                        try:
                            dt = _email_module.utils.parsedate_to_datetime(date_raw)
                            date_str = dt.isoformat()
                        except Exception:
                            date_str = None

                        # Recipients
                        recipients = [r.strip() for r in re.split(r"[;,]", to_raw) if r.strip()]

                        # Body
                        plain = html = ""
                        if msg.is_multipart():
                            for part in msg.walk():
                                ct = part.get_content_type()
                                charset = part.get_content_charset() or "utf-8"
                                try:
                                    payload = part.get_payload(decode=True)
                                    if payload:
                                        text = payload.decode(charset, errors="replace")
                                        if ct == "text/plain" and not plain:
                                            plain = text
                                        elif ct == "text/html" and not html:
                                            html = text
                                except Exception:
                                    pass
                        else:
                            charset = msg.get_content_charset() or "utf-8"
                            try:
                                payload = msg.get_payload(decode=True)
                                if payload:
                                    plain = payload.decode(charset, errors="replace")
                            except Exception:
                                pass

                        uid = hashlib.md5(f"{folder_name}|{subject}|{sender}|{date_str}".encode()).hexdigest()[:16]
                        yield {
                            "id": f"pst_{uid}",
                            "subject": subject,
                            "sender": sender,
                            "recipients": recipients,
                            "date": date_str,
                            "body": plain,
                            "body_html": html or None,
                            "folder": folder_name,
                            "is_read": True,
                            "thread_id": None,
                        }
                    except Exception:
                        continue
            except Exception:
                continue


# ── OLM parser (Outlook for Mac) ──────────────────────────────────────────────

def _iter_olm(olm_path: str) -> Generator[dict, None, None]:
    """
    Parse an OLM file (Outlook for Mac archive).
    OLM is a ZIP archive containing XML email files in a folder hierarchy.
    No external dependencies — uses stdlib zipfile + xml.etree.ElementTree.
    """
    import zipfile
    import xml.etree.ElementTree as ET

    # OLF XML tag prefixes used by Outlook for Mac
    _TEXT_TAGS = {
        "OPFMessageCopyMessageSubject": "subject",
        "OPFMessageCopyFromAddress":    "sender",
        "OPFMessageCopySenderAddress":  "sender",
        "OPFMessageCopyBody":           "body",
        "OPFMessageCopyHTMLBody":       "body_html",
        "OPFMessageCopyReceivedTime":   "date",
        "OPFMessageCopyDeliveryTime":   "date",
        "OPFMessageCopySentTime":       "date",
        # Fallback generic tags (some OLM versions)
        "messageSubject":   "subject",
        "messageFrom":      "sender",
        "messageBody":      "body",
        "messageBodyHTML":  "body_html",
        "messageDate":      "date",
    }
    _RECIP_TAGS = {
        "OPFMessageCopyToAddresses",
        "OPFMessageCopyCCAddresses",
        "messageTo",
        "messageCC",
    }

    def _parse_date(raw: str) -> str | None:
        if not raw:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S",
                    "%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(raw.strip(), fmt).isoformat()
            except ValueError:
                pass
        return raw.strip() or None

    def _parse_email_xml(xml_bytes: bytes, folder_name: str) -> dict | None:
        try:
            root = ET.fromstring(xml_bytes)
        except ET.ParseError:
            return None

        fields: dict = {
            "subject": "", "sender": "", "body": "",
            "body_html": None, "date": None, "recipients": [],
        }

        # Walk all elements — OLM wraps fields in various parent tags
        for elem in root.iter():
            tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
            text = (elem.text or "").strip()

            if tag in _TEXT_TAGS:
                key = _TEXT_TAGS[tag]
                # Only overwrite if we don't have a value yet (prefer first occurrence)
                if key == "sender" and fields["sender"]:
                    pass
                elif key == "date" and fields["date"]:
                    pass
                else:
                    if key == "date":
                        fields["date"] = _parse_date(text)
                    else:
                        fields[key] = text

            elif tag in _RECIP_TAGS:
                # Recipients may be child elements or comma-separated text
                children = list(elem)
                if children:
                    for child in children:
                        addr = (child.text or "").strip()
                        # OLM often stores as <emailAddress>...</emailAddress>
                        if not addr:
                            for sub in child.iter():
                                addr = (sub.text or "").strip()
                                if addr and "@" in addr:
                                    break
                        if addr:
                            fields["recipients"].append(addr)
                else:
                    for addr in re.split(r"[;,]", text):
                        addr = addr.strip()
                        if addr:
                            fields["recipients"].append(addr)

        if not fields["subject"] and not fields["sender"] and not fields["body"]:
            return None

        uid = hashlib.md5(
            f"{folder_name}|{fields['subject']}|{fields['sender']}|{fields['date']}".encode()
        ).hexdigest()[:16]

        return {
            "id": f"olm_{uid}",
            "subject":    fields["subject"],
            "sender":     fields["sender"],
            "recipients": fields["recipients"],
            "date":       fields["date"],
            "body":       fields["body"] or None,
            "body_html":  fields["body_html"] or None,
            "folder":     folder_name,
            "is_read":    True,
            "thread_id":  None,
        }

    try:
        with zipfile.ZipFile(olm_path, "r") as zf:
            names = zf.namelist()
            for name in names:
                if not name.lower().endswith(".xml"):
                    continue
                # Derive folder name from path: e.g. "Mail/Inbox/msg1.xml" → "Inbox"
                parts = [p for p in name.replace("\\", "/").split("/") if p]
                # Skip metadata files
                if any(skip in name.lower() for skip in ("category", "contact", "task", "note", "calendar")):
                    continue
                folder_name = parts[-2] if len(parts) >= 2 else "INBOX"
                try:
                    xml_bytes = zf.read(name)
                    result = _parse_email_xml(xml_bytes, folder_name)
                    if result:
                        yield result
                except Exception:
                    continue
    except zipfile.BadZipFile:
        raise ValueError(f"Not a valid OLM file: {olm_path}")


# ── Public API ────────────────────────────────────────────────────────────────

def iter_archive_emails(archive_path: str) -> Generator[dict, None, None]:
    """Yield email dicts from a PST or OLM file."""
    if archive_path.lower().endswith(".olm"):
        yield from _iter_olm(archive_path)
    else:
        backend = _detect_backend()
        if backend == "pypff":
            yield from _iter_pypff(archive_path)
        else:
            yield from _iter_readpst(archive_path)


def iter_pst_emails(pst_path: str) -> Generator[dict, None, None]:
    """Yield dicts of email fields from a PST file (kept for backwards compat)."""
    yield from iter_archive_emails(pst_path)


async def import_pst(
    pst_path: str,
    cache,
    rag,
    progress_cb=None,
    batch_size: int = 50,
) -> dict:
    """
    Parse a PST or OLM file and ingest all emails into cache + RAG.
    progress_cb(processed, total_so_far, current_subject) is called after each batch.
    Returns {"imported": N, "skipped": N, "backend": str}
    """
    is_olm = pst_path.lower().endswith(".olm")
    if is_olm:
        backend = "olm (built-in)"
    else:
        backend = _detect_backend()

    loop = asyncio.get_event_loop()
    imported = 0
    skipped  = 0
    buffer: list[EmailMessage] = []

    def _flush():
        nonlocal imported
        if not buffer:
            return
        new = cache.save_batch(buffer, account_id=0)
        for em in buffer:
            rag.ingest_email(em)
        imported += new
        buffer.clear()

    def _process():
        nonlocal skipped
        for raw in iter_archive_emails(pst_path):
            try:
                em = EmailMessage(
                    id=raw["id"],
                    subject=raw["subject"] or "",
                    sender=raw["sender"] or "",
                    recipients=raw["recipients"] or [],
                    date=raw["date"],
                    body=raw["body"] or None,
                    body_html=raw["body_html"],
                    thread_id=raw["thread_id"],
                    folder=raw["folder"] or "INBOX",
                    is_read=True,
                )
                buffer.append(em)
                if len(buffer) >= batch_size:
                    _flush()
                    if progress_cb:
                        progress_cb(imported, imported + skipped, raw.get("subject", ""))
            except Exception:
                skipped += 1
        _flush()
        rag.flush_bm25()

    await loop.run_in_executor(None, _process)
    return {"imported": imported, "skipped": skipped, "backend": backend}
