"""
Document ingestor — scans a folder and indexes files into the shared RAG.

Supported: PDF, DOCX, XLSX, TXT, MD, CSV, RTF
Each file gets chunked and stored in ChromaDB with source_type="document".
"""

import hashlib
import logging
import multiprocessing
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Iterator

if TYPE_CHECKING:
    from services.rag_engine import RAGEngine

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".txt", ".md", ".csv", ".rtf"}
_EXTRACT_TIMEOUT = 30  # seconds per file


@dataclass
class DocIngestProgress:
    status: str = "idle"   # idle | running | completed | error
    processed: int = 0
    total: int = 0
    message: str = ""


_progress = DocIngestProgress()


def get_progress() -> DocIngestProgress:
    return _progress


def _doc_id(path: Path) -> str:
    h = hashlib.sha1(str(path).encode()).hexdigest()[:16]
    return f"doc:{h}"


def _is_mostly_garbage(text: str) -> bool:
    """True when pdfminer returned almost no real prose — likely a scanned PDF."""
    import re
    stripped = text.strip()
    if not stripped or len(stripped) < 50:
        return True
    # Strip UUIDs, page-break chars, and known watermark patterns before counting words
    cleaned = re.sub(r'[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}', '', stripped, flags=re.IGNORECASE)
    cleaned = re.sub(r'Authentisign\s+ID\s*:', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'[\x0c\x00-\x08\x0b\x0e-\x1f]', ' ', cleaned)  # control chars / form feeds
    words = re.findall(r'[A-Za-z]{4,}', cleaned)
    return len(words) < 8


_OCR_MAX_PAGES = 15   # enough for most agreements; limits pdftoppm time
_OCR_DPI       = 100  # 100 DPI → 4× faster than 200 DPI; sufficient for text


def _ocr_pdf(path_str: str) -> str:
    """OCR up to _OCR_MAX_PAGES pages of a scanned PDF. Returns combined text."""
    try:
        import pytesseract
        from pdf2image import convert_from_path
        pytesseract.pytesseract.tesseract_cmd = (
            pytesseract.pytesseract.tesseract_cmd
            if pytesseract.pytesseract.tesseract_cmd != "tesseract"
            else "/opt/homebrew/bin/tesseract"
        )
        images = convert_from_path(path_str, dpi=_OCR_DPI, last_page=_OCR_MAX_PAGES)
        pages = []
        for img in images:
            page_text = pytesseract.image_to_string(img, lang="eng")
            if page_text.strip():
                pages.append(page_text.strip())
        return "\n\n".join(pages)
    except Exception as e:
        logger.warning(f"[docs] OCR failed for {path_str}: {e}")
        return ""


def _extract_worker(path_str: str, result_queue: "multiprocessing.Queue") -> None:
    """Runs in a child process — completely isolated from the server.
    Calls os.setsid() so SIGKILL can be sent to the entire process group
    (including pdftoppm grandchildren spawned by pdf2image).
    """
    import os as _os
    try:
        _os.setsid()   # new session → new process group
    except Exception:
        pass
    try:
        path = Path(path_str)
        ext = path.suffix.lower()
        text = ""
        if ext == ".pdf":
            from pdfminer.high_level import extract_text
            text = extract_text(path_str) or ""
            if _is_mostly_garbage(text):
                text = _ocr_pdf(path_str)
        elif ext == ".docx":
            import docx
            doc = docx.Document(path_str)
            text = "\n".join(p.text for p in doc.paragraphs)
        elif ext == ".xlsx":
            import openpyxl
            wb = openpyxl.load_workbook(path_str, read_only=True, data_only=True)
            parts = []
            for ws in wb.worksheets:
                for row in ws.iter_rows(values_only=True):
                    line = "\t".join(str(c) if c is not None else "" for c in row)
                    if line.strip():
                        parts.append(line)
            text = "\n".join(parts)
        elif ext in (".txt", ".md", ".csv", ".rtf"):
            text = path.read_text(errors="replace")
        result_queue.put(("ok", text))
    except Exception as e:
        result_queue.put(("error", str(e)))


def _extract_text(path: Path) -> str:
    """Extract text using a child process so a hung network file can be hard-killed."""
    import os as _os
    import signal as _signal
    ctx = multiprocessing.get_context("spawn")
    q: multiprocessing.Queue = ctx.Queue()
    p = ctx.Process(target=_extract_worker, args=(str(path), q), daemon=True)
    p.start()
    p.join(timeout=_EXTRACT_TIMEOUT)

    if p.is_alive():
        # Kill the entire process group to also reap pdftoppm grandchildren.
        try:
            _os.killpg(_os.getpgid(p.pid), _signal.SIGKILL)
        except Exception:
            p.kill()   # fallback: kill just the child
        p.join(timeout=3)
        logger.warning(f"[docs] extract failed {path.name}: timed out after {_EXTRACT_TIMEOUT}s")
        return ""

    if p.exitcode != 0:
        logger.warning(f"[docs] extract failed {path.name}: worker exited {p.exitcode}")
        return ""

    if q.empty():
        return ""

    status, payload = q.get_nowait()
    if status == "error":
        logger.warning(f"[docs] extract failed {path.name}: {payload}")
        return ""
    return payload


def _iter_files(folder: Path) -> Iterator[Path]:
    try:
        for p in folder.rglob("*"):
            try:
                if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS:
                    yield p
            except (PermissionError, OSError):
                continue
    except (PermissionError, OSError) as e:
        logger.warning(f"[docs] cannot read {folder}: {e}")


def ingest_folder(folder_path: str, rag: "RAGEngine") -> int:
    """Scan folder lazily and ingest new/modified files. Returns newly indexed count."""
    global _progress
    folder = Path(folder_path).expanduser().resolve()
    if not folder.exists():
        _progress = DocIngestProgress(status="error", message=f"Folder not found: {folder}")
        return 0

    _progress = DocIngestProgress(status="running", message=f"Scanning {folder.name}…")

    scanned = 0
    new_count = 0

    for path in _iter_files(folder):
        scanned += 1
        _progress.processed = scanned
        _progress.message = f"Checking {path.name}…"

        try:
            mtime = str(int(path.stat().st_mtime))
        except OSError:
            continue

        doc_id = _doc_id(path)

        if rag.is_document_current(doc_id, mtime):
            continue

        _progress.message = f"Indexing {path.name}…"
        try:
            text = _extract_text(path)
        except Exception as e:
            logger.warning(f"[docs] skipping {path.name}: {e}")
            continue
        if not text.strip():
            continue

        rag.ingest_document(
            doc_id=doc_id,
            text=text,
            filename=path.name,
            file_path=str(path),
            file_type=path.suffix.lstrip(".").lower(),
            modified_at=mtime,
        )
        new_count += 1

    _progress = DocIngestProgress(
        status="completed",
        processed=scanned,
        total=scanned,
        message=f"Done — {new_count} new file{'s' if new_count != 1 else ''} indexed ({scanned} scanned)",
    )
    return new_count
