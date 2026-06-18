"""Auto-update: check GitHub for a newer version and apply it.
Cross-platform: works on macOS (bash/rsync) and Windows (PowerShell/xcopy).
"""

import json
import os
import sys
import subprocess
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/update", tags=["update"])

GITHUB_RAW = "https://raw.githubusercontent.com/asalamat/director-assistant/main/version.json"
GITHUB_API = "https://api.github.com/repos/asalamat/director-assistant/contents/version.json"

IS_WINDOWS = sys.platform == "win32"

# Install directory differs by platform
# macOS: ~/Applications/DirectorAssistant
# Windows: ~/DirectorAssistant  (install.bat uses %USERPROFILE%\DirectorAssistant)
_INSTALL_DIR = (
    Path.home() / "DirectorAssistant"
    if IS_WINDOWS
    else Path.home() / "Applications" / "DirectorAssistant"
)


def _current_version() -> str:
    for vf in [
        Path(__file__).parents[2] / "version.json",  # repo root or install root
        _INSTALL_DIR / "version.json",
    ]:
        try:
            return json.loads(vf.read_text())["version"]
        except Exception:
            continue
    return "unknown"


def _source_repo() -> Path | None:
    """Find the git repo that backs this installation."""
    # macOS: install-mac.sh writes source_repo.txt
    try:
        p = (_INSTALL_DIR / "source_repo.txt").read_text().strip()
        repo = Path(p)
        if (repo / ".git").exists():
            return repo
    except Exception:
        pass
    # Windows: install.bat clones into INSTALL_DIR itself, so INSTALL_DIR is the repo
    if (_INSTALL_DIR / ".git").exists():
        return _INSTALL_DIR
    # Dev layout: this file lives inside the repo
    repo = Path(__file__).parents[2]
    if (repo / ".git").exists():
        return repo
    return None


def _venv_python() -> str | None:
    """Return the venv Python path, checking both Windows and Unix layouts."""
    candidates = [
        _INSTALL_DIR / "backend" / ".venv" / "Scripts" / "python.exe",  # Windows
        _INSTALL_DIR / "backend" / ".venv" / "bin" / "python3",          # macOS/Linux
        _INSTALL_DIR / "backend" / ".venv" / "bin" / "python",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return None


def _node_path() -> str:
    """Return a PATH string that includes common Node/npm locations."""
    if IS_WINDOWS:
        extras = [
            r"C:\Program Files\nodejs",
            str(Path.home() / "AppData" / "Local" / "Programs" / "nodejs"),
            str(Path.home() / "AppData" / "Roaming" / "npm"),
        ]
        sep = ";"
    else:
        extras = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/homebrew/opt/node/bin"]
        sep = ":"
    return sep.join(extras) + sep + os.environ.get("PATH", "")


@router.get("/check")
async def check_update():
    """Compare installed version against latest on GitHub main branch."""
    import urllib.request, base64
    current = _current_version()
    try:
        req = urllib.request.Request(
            GITHUB_API,
            headers={"Accept": "application/vnd.github.v3+json",
                     "User-Agent": "director-assistant-updater"},
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            api_data = json.loads(r.read())
        raw_content = base64.b64decode(api_data["content"]).decode()
        latest_data = json.loads(raw_content)
    except Exception:
        try:
            import time as _time
            url = f"{GITHUB_RAW}?nocache={int(_time.time())}"
            with urllib.request.urlopen(url, timeout=8) as r:
                latest_data = json.loads(r.read())
        except Exception as e:
            return JSONResponse({"current": current, "latest": None, "update_available": False,
                                 "error": str(e)})
    latest = latest_data.get("version", "unknown")

    def _semver(v: str) -> tuple:
        try:
            return tuple(int(x) for x in v.split("."))
        except Exception:
            return (0,)

    update_available = latest != "unknown" and _semver(latest) > _semver(current)
    return {"current": current, "latest": latest, "update_available": update_available}


@router.post("/apply")
async def apply_update():
    """Pull latest code and reinstall. Uses bash on macOS, PowerShell on Windows."""
    repo = _source_repo()
    if repo is None:
        hint = "Re-run install.bat" if IS_WINDOWS else "Re-run install-mac.sh"
        return JSONResponse({"status": "error",
                             "message": f"Source repo not found. {hint} to set up auto-update."}, status_code=400)

    python = _venv_python()
    if python is None:
        return JSONResponse({"status": "error",
                             "message": "Virtual environment not found in install dir."}, status_code=400)

    install_dir = str(_INSTALL_DIR)
    node_path = _node_path()
    env = os.environ.copy()
    env["PATH"] = node_path

    if IS_WINDOWS:
        _apply_windows(repo, install_dir, python, node_path, env)
    else:
        _apply_macos(repo, install_dir, python, node_path, env)

    return {"status": "updating", "message": "Update started. The app will restart in ~60 seconds."}


def _apply_macos(repo: Path, install_dir: str, python: str, node_path: str, env: dict):
    log = "/tmp/director-assistant-update.log"
    home = str(Path.home())
    plist = f"{home}/Library/LaunchAgents/com.director-assistant.app.plist"

    cmd = (
        f"exec >> {log} 2>&1 && "
        f"echo '--- Update started at '$(date) && "
        f"cd '{repo}' && git pull origin main --ff-only && "
        f"rsync -a --exclude='.venv' --exclude='__pycache__' '{repo}/backend/' '{install_dir}/backend/' && "
        f"'{python}' -m pip install -q --upgrade -r '{install_dir}/backend/requirements.txt' && "
        f"export PATH='{node_path}' && "
        f"cd '{repo}/frontend' && npm install --silent && npm run build && "
        f"rm -rf '{install_dir}/backend/static' && "
        f"cp -r '{repo}/frontend/dist' '{install_dir}/backend/static' && "
        f"cp '{repo}/version.json' '{install_dir}/version.json' && "
        f"echo '--- Update complete. Restarting…' && "
        f"pkill -f 'uvicorn main:app' || true && sleep 15 && "
        f"curl -sf http://localhost:8000/health > /dev/null 2>&1 || "
        f"launchctl kickstart gui/$(id -u)/com.director-assistant.app && "
        f"echo '--- restart done'"
    )
    subprocess.Popen(["bash", "-c", f"sleep 2 && {cmd}"],
                     start_new_session=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)


def _apply_windows(repo: Path, install_dir: str, python: str, node_path: str, env: dict):
    log = r"%TEMP%\director-assistant-update.log"

    # Build a PowerShell update script as a string
    ps = f"""
$ErrorActionPreference = 'Stop'
$log = "$env:TEMP\\director-assistant-update.log"
function Log($msg) {{ Add-Content $log "$(Get-Date -f 'yyyy-MM-dd HH:mm:ss') $msg" }}

Log '--- Update started'
try {{
    # 1. Git pull
    Set-Location '{repo}'
    git pull origin main --ff-only 2>&1 | ForEach-Object {{ Log $_ }}

    # 2. Sync backend files (exclude .venv and __pycache__)
    $src = '{repo}\\backend\\'
    $dst = '{install_dir}\\backend\\'
    robocopy $src $dst /E /XD .venv __pycache__ /NFL /NDL /NJH /NJS | Out-Null

    # 3. pip install
    & '{python}' -m pip install -q --upgrade -r '{install_dir}\\backend\\requirements.txt'
    Log 'pip install done'

    # 4. npm build
    $env:PATH = '{node_path.replace(chr(39), chr(34))}'
    Set-Location '{repo}\\frontend'
    npm install --silent 2>&1 | Out-Null
    npm run build 2>&1 | ForEach-Object {{ Log $_ }}

    # 5. Copy dist to static
    $static = '{install_dir}\\backend\\static'
    if (Test-Path $static) {{ Remove-Item $static -Recurse -Force }}
    Copy-Item '{repo}\\frontend\\dist' $static -Recurse

    # 6. Copy version.json
    Copy-Item '{repo}\\version.json' '{install_dir}\\version.json' -Force

    Log '--- Update complete. Restarting...'

    # 7. Kill uvicorn and let start.bat revive it
    Get-Process | Where-Object {{ $_.CommandLine -like '*uvicorn*main:app*' }} | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep 3
    Start-Process '{install_dir}\\start.bat' -WindowStyle Hidden

    Log '--- restart done'
}} catch {{
    Log "ERROR: $_"
}}
"""
    # Write the script to a temp file and run it detached
    ps_path = Path(os.environ.get("TEMP", "C:\\Windows\\Temp")) / "da_update.ps1"
    ps_path.write_text(ps, encoding="utf-8")

    subprocess.Popen(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
         "-Command", f"Start-Sleep 2; & '{ps_path}'"],
        start_new_session=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
        creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0,
    )
