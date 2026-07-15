#!/usr/bin/env python3
"""macOS menu bar icon for Director Assistant."""

import json
import os
import socket
import subprocess
import sys
import urllib.request

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


_ICON_PATH = os.path.join(_INSTALL_DIR, "assets", "logo-32.png")


class DirectorAssistantApp(rumps.App):
    def __init__(self, open_on_start: bool = False):
        icon = _ICON_PATH if os.path.exists(_ICON_PATH) else None
        super().__init__("DA", icon=icon, template=False, quit_button=None)
        if icon:
            self.title = None  # hide text when icon is set
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
            return
        log_path = os.path.expanduser("~/.director-assistant/server.log")
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        self._backend = subprocess.Popen(
            [_UVICORN, "main:app", "--host", "127.0.0.1", "--port", str(_PORT)],
            cwd=_BACKEND_DIR,
            env=env,
            stdout=open(log_path, "a"),
            stderr=subprocess.STDOUT,
        )

    @rumps.timer(10)
    def _watchdog(self, _):
        """Restart the backend if it has exited unexpectedly."""
        if self._backend is not None and self._backend.poll() is not None:
            self._backend = None
        if self._backend is None and not _port_open():
            self._start_backend()

    @rumps.timer(60)
    def _poll_notifications(self, _):
        """Check for urgent/action emails and fire macOS notifications."""
        if not _port_open():
            return
        try:
            req = urllib.request.Request(
                f"{_URL}/api/emails/?folder=INBOX&limit=20",
                headers={"Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
            emails = data.get("emails", [])
            for email in emails:
                subject = email.get("subject", "")
                sender = email.get("sender", "")
                email_id = email.get("id", "")
                if not email.get("is_read", True):
                    lower_subject = subject.lower()
                    if any(kw in lower_subject for kw in ("urgent", "action required", "action needed", "asap", "important")):
                        notif_key = f"notif_{email_id}"
                        if not getattr(self, "_notified_ids", None):
                            self._notified_ids: set = set()
                        if email_id not in self._notified_ids:
                            self._notified_ids.add(email_id)
                            rumps.notification(
                                title="Director Assistant",
                                subtitle=f"From: {sender}",
                                message=subject,
                                sound=True,
                            )
        except Exception:
            pass

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
