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


def _venv_python() -> str | None:
    """Return the venv Python path in the install dir, or None."""
    for candidate in [
        _INSTALL_DIR / "backend" / ".venv" / "bin" / "python3",
        _INSTALL_DIR / "backend" / ".venv" / "bin" / "python",
    ]:
        if candidate.exists():
            return str(candidate)
    return None


def _node_path() -> str:
    """Return a PATH that includes common Node/npm locations."""
    extra = "/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/node/bin"
    return f"{extra}:{os.environ.get('PATH', '')}"


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
    def _semver(v: str) -> tuple:
        try:
            return tuple(int(x) for x in v.split("."))
        except Exception:
            return (0,)
    update_available = latest != "unknown" and _semver(latest) > _semver(current)
    return {
        "current": current,
        "latest": latest,
        "update_available": update_available,
    }


@router.post("/apply")
async def apply_update():
    """Pull latest code and reinstall without relying on shell PATH for Python."""
    repo = _source_repo()
    if repo is None:
        return JSONResponse({"status": "error",
                             "message": "Source repo not found. Re-run install-mac.sh first."}, status_code=400)

    python = _venv_python()
    if python is None:
        return JSONResponse({"status": "error",
                             "message": "Venv Python not found in install dir."}, status_code=400)

    install_dir = str(_INSTALL_DIR)
    log = "/tmp/director-assistant-update.log"
    node_path = _node_path()

    home = str(Path.home())
    plist = f"{home}/Library/LaunchAgents/com.director-assistant.app.plist"

    # Build the update steps:
    # 1. git pull source repo
    # 2. rsync backend (exclude .venv to avoid permission errors on symlinks)
    # 3. pip install requirements using existing venv
    # 4. build frontend (node/npm already installed)
    # 5. copy dist → backend/static
    # 6. copy version.json
    # 7. kill just the uvicorn process — menubar.py watchdog restarts it automatically
    update_cmd = (
        f"exec >> {log} 2>&1 && "
        f"echo '--- Update started at '$(date) && "
        # Pull latest code into source repo
        f"cd '{repo}' && git pull origin main --ff-only && "
        # Sync backend excluding .venv and __pycache__ to avoid permission errors
        f"rsync -a --exclude='.venv' --exclude='__pycache__' '{repo}/backend/' '{install_dir}/backend/' && "
        # Reinstall Python deps with existing venv (no PATH dependency)
        f"'{python}' -m pip install -q --upgrade -r '{install_dir}/backend/requirements.txt' && "
        # Build frontend
        f"export PATH='{node_path}' && "
        f"cd '{repo}/frontend' && npm install --silent && npm run build && "
        # Copy built assets to install dir static
        f"rm -rf '{install_dir}/backend/static' && "
        f"cp -r '{repo}/frontend/dist' '{install_dir}/backend/static' && "
        # Copy version.json
        f"cp '{repo}/version.json' '{install_dir}/version.json' && "
        f"echo '--- Update complete. Restarting…' && "
        # Kill uvicorn; if menubar watchdog doesn't restart within 15s, use kickstart.
        f"pkill -f 'uvicorn main:app' || true && sleep 15 && "
        f"curl -sf http://localhost:8000/health > /dev/null 2>&1 || "
        f"launchctl kickstart gui/$(id -u)/com.director-assistant.app && "
        f"echo '--- restart done'"
    )

    env = os.environ.copy()
    env["PATH"] = node_path
    subprocess.Popen(
        ["bash", "-c", f"sleep 2 && {update_cmd}"],
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )

    return {"status": "updating", "message": "Update started. The app will restart in ~30 seconds."}
