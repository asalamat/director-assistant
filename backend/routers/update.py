"""Auto-update: check GitHub for a newer version and apply it."""

import json
import os
import subprocess
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/update", tags=["update"])

GITHUB_RAW = "https://raw.githubusercontent.com/asalamat/director-assistant/main/version.json"
_INSTALL_DIR = Path.home() / "Applications" / "DirectorAssistant"


def _current_version() -> str:
    try:
        vf = _INSTALL_DIR / "version.json"
        return json.loads(vf.read_text())["version"]
    except Exception:
        return "unknown"


def _source_repo() -> Path | None:
    try:
        p = (_INSTALL_DIR / "source_repo.txt").read_text().strip()
        repo = Path(p)
        return repo if (repo / ".git").exists() else None
    except Exception:
        return None


@router.get("/check")
async def check_update():
    """Compare installed version against latest on GitHub main branch."""
    import urllib.request
    current = _current_version()
    try:
        with urllib.request.urlopen(GITHUB_RAW, timeout=8) as r:
            latest_data = json.loads(r.read())
        latest = latest_data.get("version", "unknown")
    except Exception as e:
        return JSONResponse({"current": current, "latest": None, "update_available": False,
                             "error": str(e)})
    update_available = latest != "unknown" and latest != current
    return {
        "current": current,
        "latest": latest,
        "update_available": update_available,
    }


@router.post("/apply")
async def apply_update():
    """Pull latest code and reinstall. Responds immediately; restart happens in background."""
    repo = _source_repo()
    if repo is None:
        return JSONResponse({"status": "error",
                             "message": "Source repo not found. Re-run install-mac.sh first."}, status_code=400)

    install_script = repo / "scripts" / "install-mac.sh"
    if not install_script.exists():
        return JSONResponse({"status": "error",
                             "message": f"Install script not found at {install_script}"}, status_code=400)

    # Pull latest code into the source repo, then reinstall.
    # Sleep 2s so the HTTP response is delivered before the backend restarts.
    # Inject common Python/Homebrew/conda paths so the install script finds python3.
    extra_paths = "/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/python@3.13/bin"
    update_cmd = (
        f"export PATH=\"{extra_paths}:$PATH\" && "
        f"cd '{repo}' && git pull origin main --ff-only "
        f"&& bash '{install_script}' >> /tmp/director-assistant-update.log 2>&1"
    )
    env = os.environ.copy()
    env["PATH"] = f"{extra_paths}:{env.get('PATH', '')}"
    subprocess.Popen(
        ["bash", "-c", f"sleep 2 && {update_cmd}"],
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )

    return {"status": "updating", "message": "Update started. The app will restart in a few moments."}
