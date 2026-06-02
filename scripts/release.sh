#!/usr/bin/env bash
# release.sh <version>
# Bumps version, rebuilds frontend, commits, pushes, and syncs the local
# installed app — so the running instance immediately reflects the new version.
#
# Usage: bash scripts/release.sh 3.6.0

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
    echo "Usage: $0 <version>  (e.g. 3.6.0)"
    exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="$HOME/Applications/DirectorAssistant"

echo "==> Bumping version to $VERSION"
echo "{\"version\":\"$VERSION\"}" > "$REPO_DIR/version.json"
# Update frontend/package.json version field
python3 -c "
import json, pathlib
p = pathlib.Path('$REPO_DIR/frontend/package.json')
d = json.loads(p.read_text())
d['version'] = '$VERSION'
p.write_text(json.dumps(d, indent=2) + '\n')
"

echo "==> Rebuilding frontend"
cd "$REPO_DIR/frontend" && npm run build

echo "==> Committing and pushing"
cd "$REPO_DIR"
git add version.json frontend/package.json frontend/dist
git commit -m "chore: release v$VERSION"
git push

echo "==> Syncing installed app at $INSTALL_DIR"
if [[ -d "$INSTALL_DIR" ]]; then
    cp "$REPO_DIR/version.json" "$INSTALL_DIR/version.json"
    rm -rf "$INSTALL_DIR/backend/static"
    cp -r "$REPO_DIR/frontend/dist" "$INSTALL_DIR/backend/static"
    # Sync backend code (excludes .venv and __pycache__)
    rsync -a --exclude='.venv' --exclude='__pycache__' \
        "$REPO_DIR/backend/" "$INSTALL_DIR/backend/"
    echo "    Installed version.json, dist, and backend synced"
    # Restart uvicorn so new code takes effect; watchdog will revive it
    pkill -f "uvicorn main:app" 2>/dev/null || true
    echo "    Uvicorn restarted (watchdog will revive it)"
else
    echo "    $INSTALL_DIR not found — skipping local sync"
fi

echo "==> Done. v$VERSION released and installed."
