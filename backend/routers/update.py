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


def _valid_install_dir(p: Path) -> bool:
    """True if p looks like a Director Assistant install (git repo or ZIP install)."""
    return (p / ".git").exists() or (p / "backend" / "main.py").exists()


def _source_repo() -> Path | None:
    """Find the install/source directory for this installation.
    Works for git-clone installs (has .git) and ZIP installs (no .git)."""
    # source_repo.txt written by install scripts
    try:
        p = (_INSTALL_DIR / "source_repo.txt").read_text().strip()
        repo = Path(p)
        if _valid_install_dir(repo):
            return repo
    except Exception:
        pass
    # INSTALL_DIR itself (git-clone or ZIP installed here)
    if _valid_install_dir(_INSTALL_DIR):
        return _INSTALL_DIR
    # Dev layout: this file lives inside the repo
    repo = Path(__file__).parents[2]
    if _valid_install_dir(repo):
        return repo
    return None


def _effective_install_dir(repo: Path | None = None) -> Path:
    """Return the dir that actually contains backend/.venv.
    On macOS with a separate install, this is _INSTALL_DIR.
    On Windows git-clone layout (install.bat ran inside the repo), this is repo."""
    venv_subs = [
        Path("backend") / ".venv" / "Scripts" / "python.exe",  # Windows
        Path("backend") / ".venv" / "bin" / "python3",          # macOS/Linux
        Path("backend") / ".venv" / "bin" / "python",
    ]
    for sub in venv_subs:
        if (_INSTALL_DIR / sub).exists():
            return _INSTALL_DIR
    if repo is not None:
        for sub in venv_subs:
            if (repo / sub).exists():
                return repo
    return _INSTALL_DIR


def _venv_python(install_dir: Path | None = None) -> str | None:
    """Return the venv Python path, checking both Windows and Unix layouts."""
    base = install_dir if install_dir is not None else _INSTALL_DIR
    candidates = [
        base / "backend" / ".venv" / "Scripts" / "python.exe",  # Windows
        base / "backend" / ".venv" / "bin" / "python3",          # macOS/Linux
        base / "backend" / ".venv" / "bin" / "python",
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

    install_dir_path = _effective_install_dir(repo)
    python = _venv_python(install_dir_path)
    if python is None:
        return JSONResponse({"status": "error",
                             "message": "Virtual environment not found. Re-run install.bat (Windows) or install-mac.sh (macOS)."}, status_code=400)

    install_dir = str(install_dir_path)
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
    """Windows update via GitHub ZIP download — no git or npm required on target machine."""
    zip_url = "https://github.com/asalamat/director-assistant/archive/refs/heads/main.zip"

    ps = f"""
$log = "$env:TEMP\\director-assistant-update.log"
function Log($msg) {{ Add-Content $log "$(Get-Date -f 'yyyy-MM-dd HH:mm:ss') $msg" }}

Log '--- Update started (ZIP method)'
try {{
    $ErrorActionPreference = 'Stop'
    $zip = "$env:TEMP\\da_update.zip"
    $tmp = "$env:TEMP\\da_update_src"

    # 1. Download latest release
    Log 'Downloading...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri '{zip_url}' -OutFile $zip -UseBasicParsing
    Log 'Download complete'

    # 2. Extract
    if (Test-Path $tmp) {{ Remove-Item $tmp -Recurse -Force }}
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    Remove-Item $zip -Force
    $src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
    Log "Extracted: $src"

    # 3. Copy backend files (skip .venv and __pycache__)
    # robocopy exit 0-7 = success; suppress non-zero to avoid false Stop
    $ErrorActionPreference = 'Continue'
    robocopy "$src\\backend" '{install_dir}\\backend' /E /XD .venv __pycache__ /NFL /NDL /NJH /NJS | Out-Null
    $ErrorActionPreference = 'Stop'
    Log 'Backend files copied'

    # 4. pip install new requirements
    & '{python}' -m pip install -q --upgrade -r '{install_dir}\\backend\\requirements.txt'
    Log 'pip install done'

    # 5. Copy pre-built frontend dist (no npm needed — dist is committed to the repo)
    $static = '{install_dir}\\backend\\static'
    if (Test-Path $static) {{ Remove-Item $static -Recurse -Force }}
    Copy-Item "$src\\frontend\\dist" $static -Recurse
    Log 'Frontend copied'

    # 6. Update version.json
    Copy-Item "$src\\version.json" '{install_dir}\\version.json' -Force
    $ver = (Get-Content '{install_dir}\\version.json' | ConvertFrom-Json).version
    Log "Updated to v$ver"

    # 7. Cleanup temp
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

    Log '--- Update complete. Restarting...'

    # 8. Kill python/uvicorn processes — taskkill + CIM fallback (avoids deprecated WMI)
    $ErrorActionPreference = 'Continue'
    taskkill /F /FI "WINDOWTITLE eq Director Assistant*" 2>$null | Out-Null
    taskkill /F /FI "IMAGENAME eq uvicorn.exe" 2>$null | Out-Null
    try {{
        Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='python3.exe'" -ErrorAction Stop |
            Where-Object {{ $_.CommandLine -like '*uvicorn*' -or $_.CommandLine -like '*main:app*' }} |
            ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}
    }} catch {{
        Get-Process python,python3 -ErrorAction SilentlyContinue |
            ForEach-Object {{ $_.Kill() }}
    }}
    Start-Sleep 3

    # 9. Restart via start.bat
    $startBat = '{install_dir}\\start.bat'
    if (Test-Path $startBat) {{
        Start-Process cmd -ArgumentList "/c `"$startBat`"" -WindowStyle Hidden
        Log '--- restart done'
    }} else {{
        Log "WARNING: start.bat not found at $startBat — restart manually"
    }}
}} catch {{
    Log "ERROR: $_"
}}
"""
    ps_path = Path(os.environ.get("TEMP", "C:\\Windows\\Temp")) / "da_update.ps1"
    ps_path.write_text(ps, encoding="utf-8")

    subprocess.Popen(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
         "-Command", f"Start-Sleep 2; & '{ps_path}'"],
        start_new_session=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
        creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0,
    )
