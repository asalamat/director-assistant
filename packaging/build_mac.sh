#!/usr/bin/env bash
# Build Director Assistant macOS .app bundle and .dmg
# Run from repo root: ./packaging/build_mac.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$REPO_ROOT/backend/.venv"
DIST="$REPO_ROOT/dist"

echo "==> Checking environment"
if [[ ! -d "$VENV" ]]; then
  echo "ERROR: virtualenv not found at $VENV"
  echo "       Run: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi

PYTHON="$VENV/bin/python"
PIP="$VENV/bin/pip"

echo "==> Installing/upgrading PyInstaller"
"$PIP" install --quiet --upgrade pyinstaller

echo "==> Building frontend"
cd "$REPO_ROOT/frontend"
npm ci --silent
npm run build

echo "==> Copying frontend build to backend/static"
rm -rf "$REPO_ROOT/backend/static/assets"
cp -r "$REPO_ROOT/frontend/dist/." "$REPO_ROOT/backend/static/"

echo "==> Running PyInstaller"
cd "$REPO_ROOT"
"$VENV/bin/pyinstaller" \
  --noconfirm \
  --clean \
  "packaging/director_assistant.spec"

APP_BUNDLE="$DIST/Director Assistant.app"

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "ERROR: App bundle not found at '$APP_BUNDLE'"
  exit 1
fi

echo "==> App bundle created: $APP_BUNDLE"

# ---- optional: create DMG ----
if command -v hdiutil &>/dev/null; then
  DMG_NAME="DirectorAssistant-mac.dmg"
  DMG_PATH="$DIST/$DMG_NAME"
  STAGING="$DIST/dmg-staging"

  echo "==> Creating DMG: $DMG_NAME"
  rm -rf "$STAGING"
  mkdir -p "$STAGING"
  cp -r "$APP_BUNDLE" "$STAGING/"
  # Symlink to /Applications for drag-and-drop install
  ln -s /Applications "$STAGING/Applications"

  hdiutil create \
    -volname "Director Assistant" \
    -srcfolder "$STAGING" \
    -ov \
    -format UDZO \
    "$DMG_PATH"

  rm -rf "$STAGING"
  echo "==> DMG created: $DMG_PATH"
else
  echo "NOTE: hdiutil not found — skipping DMG creation. App bundle is at '$APP_BUNDLE'."
fi

echo ""
echo "Done! Distribute '$APP_BUNDLE' or '$DIST/DirectorAssistant-mac.dmg'."
