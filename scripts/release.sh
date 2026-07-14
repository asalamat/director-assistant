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
# Stage all tracked changes (source + dist) so CI always has current code.
# Excludes .env, secrets, and generated artefacts that should not be committed.
git add -u
git add frontend/dist frontend/package-lock.json
git diff --cached --quiet && echo "    Nothing to commit (version already at $VERSION)" || { git commit -m "chore: release v$VERSION" && git push; }

echo "==> Creating GitHub release v$VERSION"
if command -v gh &>/dev/null; then
    gh release create "v$VERSION" \
        --title "v$VERSION" \
        --notes "Release v$VERSION — see commit history for changes." \
        --latest 2>&1 && echo "    GitHub release created" || echo "    GitHub release failed (continuing)"
else
    echo "    gh CLI not found — skipping GitHub release"
fi

echo "==> Updating dev backend/static with fresh build"
rm -rf "$REPO_DIR/backend/static"
cp -r "$REPO_DIR/frontend/dist" "$REPO_DIR/backend/static"
echo "    Dev static updated"

echo "==> Syncing installed app at $INSTALL_DIR"
if [[ -d "$INSTALL_DIR" ]]; then
    cp "$REPO_DIR/version.json" "$INSTALL_DIR/version.json"
    # Sync backend code first (excludes .venv and __pycache__)
    tar -C "$REPO_DIR/backend" \
        --exclude='./.venv' --exclude='./__pycache__' --exclude='./*.pyc' \
        -cf - . | tar -C "$INSTALL_DIR/backend" -xf -
    # Then overwrite static with the freshly-built dist (rsync may have an old version)
    rm -rf "$INSTALL_DIR/backend/static"
    cp -r "$REPO_DIR/frontend/dist" "$INSTALL_DIR/backend/static"
    echo "    Installed version.json, dist, and backend synced"
    # Install any new requirements into the venv
    VENV="$INSTALL_DIR/backend/.venv"
    if [[ -f "$VENV/bin/pip" ]]; then
        "$VENV/bin/pip" install -q -r "$INSTALL_DIR/backend/requirements.txt" 2>&1 | tail -3 || true
        echo "    Requirements synced"
    fi
    # Restart uvicorn so new code takes effect; watchdog will revive it
    pkill -f "uvicorn main:app" 2>/dev/null || true
    echo "    Uvicorn restarted (watchdog will revive it)"
else
    echo "    $INSTALL_DIR not found — skipping local sync"
fi

echo "==> Done. v$VERSION released and installed."
