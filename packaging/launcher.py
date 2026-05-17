"""
Director Assistant launcher — bundles backend + frontend into a single executable.

Starts uvicorn in a background thread, waits for it to be ready, then opens
the browser.  Ctrl-C / window close shuts everything down cleanly.
"""

import multiprocessing
import os
import sys
import time
import signal
import socket
import threading
import webbrowser
import logging
from pathlib import Path

# Must be called before any other multiprocessing usage when frozen by PyInstaller
multiprocessing.freeze_support()

# Prevent loky/tokenizer worker crashes on Python 3.13 + sentence-transformers
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("OMP_NUM_THREADS", "1")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("launcher")

PORT = 8000
HOST = "127.0.0.1"
URL  = f"http://{HOST}:{PORT}"


def _find_free_port(start: int = PORT) -> int:
    for p in range(start, start + 100):
        with socket.socket() as s:
            try:
                s.bind((HOST, p))
                return p
            except OSError:
                continue
    raise RuntimeError("No free port found")


def _wait_for_server(port: int, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as s:
            s.settimeout(0.5)
            try:
                s.connect((HOST, port))
                return True
            except (ConnectionRefusedError, OSError):
                time.sleep(0.3)
    return False


def _resource_path(relative: str) -> str:
    """Resolve path whether running from source or PyInstaller bundle."""
    if hasattr(sys, "_MEIPASS"):
        return os.path.join(sys._MEIPASS, relative)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", relative)


def _data_dir() -> Path:
    """User-writable data directory for config, DB, etc."""
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / "DirectorAssistant"
    elif sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home())) / "DirectorAssistant"
    else:
        base = Path.home() / ".director-assistant"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _run_backend(port: int, data_dir: Path):
    import uvicorn

    os.environ.setdefault("DATA_DIR", str(data_dir))

    # When frozen by PyInstaller, all bundled files land in sys._MEIPASS.
    # main.py is placed at the root of _MEIPASS, so chdir there so that
    # relative imports and Path(__file__).parent work correctly.
    if hasattr(sys, "_MEIPASS"):
        root = sys._MEIPASS
    else:
        root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
        root = os.path.realpath(root)

    os.chdir(root)
    if root not in sys.path:
        sys.path.insert(0, root)

    uvicorn.run(
        "main:app",
        host=HOST,
        port=port,
        log_level="warning",
    )


def main():
    port = _find_free_port()
    data_dir = _data_dir()

    log.info(f"Starting Director Assistant on port {port}")
    log.info(f"Data directory: {data_dir}")

    t = threading.Thread(target=_run_backend, args=(port, data_dir), daemon=True)
    t.start()

    if not _wait_for_server(port):
        log.error("Backend failed to start within 30 seconds.")
        sys.exit(1)

    url = f"http://{HOST}:{port}"
    log.info(f"Opening {url}")
    webbrowser.open(url)

    # Keep main thread alive; handle Ctrl-C gracefully
    try:
        while t.is_alive():
            t.join(timeout=1)
    except KeyboardInterrupt:
        log.info("Shutting down…")


if __name__ == "__main__":
    main()
