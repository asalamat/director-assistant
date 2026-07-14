#!/bin/bash
# ============================================================
# Director Assistant — One-Line Online Installer
# Usage:
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/asalamat/director-assistant/main/scripts/install-online.sh)"
# ============================================================

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo "============================================"
echo "  Director Assistant — Online Installer"
echo "============================================"
echo ""

# ── 1. Get latest release download URL ───────────────────────
info "Finding latest release…"
API_URL="https://api.github.com/repos/asalamat/director-assistant/releases/latest"
RELEASE_JSON=$(curl -fsSL "$API_URL" 2>/dev/null) || error "Cannot reach GitHub API. Check your internet connection."
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep -o '"browser_download_url": "[^"]*mac[^"]*\.zip"' | head -1 | cut -d'"' -f4)
[ -z "$DOWNLOAD_URL" ] && error "No macOS release found. Visit https://github.com/asalamat/director-assistant/releases"
VERSION=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
success "Found $VERSION"

# ── 2. Download zip ───────────────────────────────────────────
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
ZIP="$WORK_DIR/DirectorAssistant.zip"
info "Downloading $VERSION…"
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$ZIP"
success "Downloaded"

# ── 3. Extract ────────────────────────────────────────────────
info "Extracting…"
unzip -q "$ZIP" -d "$WORK_DIR"
SRC_DIR=$(find "$WORK_DIR" -maxdepth 2 -name "install-mac.sh" | head -1 | xargs dirname | xargs dirname)
[ -z "$SRC_DIR" ] && error "Could not find install script in downloaded archive"
success "Extracted"

# ── 4. Run installer ──────────────────────────────────────────
echo ""
bash "$SRC_DIR/scripts/install-mac.sh"
