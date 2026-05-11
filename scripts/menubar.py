#!/usr/bin/env python3
"""macOS menu bar icon for Director Assistant."""

import os
import socket
import subprocess
import sys

try:
    import rumps
except ImportError:
    sys.exit("rumps not installed — run: pip install rumps")

_INSTALL_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
)
_BACKEND_DIR = os.path.join(_INSTALL_DIR, "backend")
_UVICORN = os.path.join(_BACKEND_DIR, ".venv", "bin", "uvicorn")
_URL = "http://localhost:8000"
_PORT = 8000


def _port_open() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", _PORT)) == 0


class DirectorAssistantApp(rumps.App):
    def __init__(self, open_on_start: bool = False):
        super().__init__("✉", quit_button=None)
        self.menu = [
            rumps.MenuItem("Open Director Assistant", callback=self.open_browser),
            None,
            rumps.MenuItem("Quit", callback=self.quit_app),
        ]
        self._backend = None
        self._start_backend()
        if open_on_start:
            self.open_browser(None)

    def _start_backend(self):
        if _port_open():
            return  # already running — skip
        self._backend = subprocess.Popen(
            [_UVICORN, "main:app", "--host", "127.0.0.1", "--port", str(_PORT)],
            cwd=_BACKEND_DIR,
        )

    @rumps.clicked("Open Director Assistant")
    def open_browser(self, _):
        subprocess.Popen(["open", _URL])

    def quit_app(self, _):
        if self._backend and self._backend.poll() is None:
            self._backend.terminate()
            try:
                self._backend.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._backend.kill()
        rumps.quit_application()


if __name__ == "__main__":
    DirectorAssistantApp(open_on_start="--open" in sys.argv).run()
