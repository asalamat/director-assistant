#!/bin/bash
# ============================================================
# Director Assistant — Build distributable packages
# Outputs:
#   dist/DirectorAssistant-mac.zip   (macOS installer + source)
#   dist/DirectorAssistant-win.zip   (Windows installer + source)
# ============================================================

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c "import json; print(json.load(open('$ROOT/version.json'))['version'])")"
DIST="$ROOT/dist"
TMP="$DIST/tmp"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo "============================================"
echo "  Director Assistant $VERSION — Packager"
echo "============================================"
echo ""

# ── 1. Build frontend ────────────────────────────────────────
info "Building frontend…"
cd "$ROOT/frontend"
npm install --silent
npm run build
success "Frontend built (dist/)"

# ── 2. Copy static to backend ────────────────────────────────
info "Embedding frontend into backend/static…"
rm -rf "$ROOT/backend/static"
mkdir -p "$ROOT/backend/static"
cp -r "$ROOT/frontend/dist/." "$ROOT/backend/static/"
success "Static assets embedded"

# ── 3. Prepare clean staging area ────────────────────────────
info "Staging source files…"
rm -rf "$TMP" "$DIST/DirectorAssistant-mac.zip" "$DIST/DirectorAssistant-win.zip"
mkdir -p "$TMP/DirectorAssistant"

rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.venv' \
  --exclude='frontend/dist' \
  --exclude='dist/' \
  --exclude='.env' \
  --exclude='*.egg-info' \
  --exclude='.claude' \
  --exclude='.claude-flow' \
  "$ROOT/" "$TMP/DirectorAssistant/"
success "Files staged to $TMP/DirectorAssistant"

# ── 4. macOS package ─────────────────────────────────────────
info "Creating macOS package…"
cd "$TMP"
zip -r "$DIST/DirectorAssistant-mac-$VERSION.zip" \
  DirectorAssistant \
  -x "*/__pycache__/*" "*.pyc" "*/.DS_Store" > /dev/null
success "Created: dist/DirectorAssistant-mac-$VERSION.zip"

# ── 5. Windows package ───────────────────────────────────────
info "Creating Windows package…"
zip -r "$DIST/DirectorAssistant-win-$VERSION.zip" \
  DirectorAssistant \
  -x "*/__pycache__/*" "*.pyc" "*/.DS_Store" > /dev/null
success "Created: dist/DirectorAssistant-win-$VERSION.zip"

# ── 6. Cleanup ───────────────────────────────────────────────
rm -rf "$TMP"

echo ""
ls -lh "$DIST/"*.zip
echo ""
echo "============================================"
echo "  Packages ready in: $DIST/"
echo ""
echo "  macOS:   DirectorAssistant-mac-$VERSION.zip"
echo "    → Extract → run: bash DirectorAssistant/scripts/install-mac.sh"
echo ""
echo "  Windows: DirectorAssistant-win-$VERSION.zip"
echo "    → Extract → double-click: DirectorAssistant\\install.bat"
echo "============================================"
echo ""
