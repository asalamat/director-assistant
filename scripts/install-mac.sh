#!/bin/bash
# ============================================================
# Director Assistant — macOS Installer  v2.9.3
# ============================================================
# Requirements: macOS 12+, Internet connection
# Run with:  bash install-mac.sh
# ============================================================

set -e

APP_NAME="Director Assistant"
APP_VERSION="2.9.3"
INSTALL_DIR="$HOME/Applications/DirectorAssistant"
PYTHON_MIN="3.11"
NODE_MIN="18"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo "============================================"
echo "  Director Assistant $APP_VERSION — macOS Installer"
echo "============================================"
echo ""

# ── 1. Check Python ──────────────────────────────────────────
info "Checking Python $PYTHON_MIN+…"
PYTHON=""
for cmd in python3.13 python3.12 python3.11 python3; do
  if command -v "$cmd" &>/dev/null; then
    VER=$($cmd --version 2>&1 | awk '{print $2}')
    MAJOR=$(echo "$VER" | cut -d. -f1)
    MINOR=$(echo "$VER" | cut -d. -f2)
    if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 11 ]; then
      PYTHON="$cmd"
      success "Found $cmd ($VER)"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  warn "Python $PYTHON_MIN+ not found."
  if command -v brew &>/dev/null; then
    info "Installing Python via Homebrew…"
    brew install python@3.13
    PYTHON="python3.13"
  else
    error "Please install Python $PYTHON_MIN+ from https://www.python.org/downloads/ and re-run this script."
  fi
fi

# ── 2. Check Node.js ─────────────────────────────────────────
info "Checking Node.js $NODE_MIN+…"
if command -v node &>/dev/null; then
  NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -ge "$NODE_MIN" ]; then
    success "Found Node.js $(node --version)"
  else
    warn "Node.js version too old ($(node --version)), need $NODE_MIN+."
    NODE_INSTALL=1
  fi
else
  warn "Node.js not found."
  NODE_INSTALL=1
fi

if [ "${NODE_INSTALL:-0}" = "1" ]; then
  if command -v brew &>/dev/null; then
    info "Installing Node.js via Homebrew…"
    brew install node
    success "Node.js installed"
  else
    error "Please install Node.js $NODE_MIN+ from https://nodejs.org/ and re-run this script."
  fi
fi

# ── 3. Copy app to install directory ─────────────────────────
info "Installing to $INSTALL_DIR…"
mkdir -p "$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
rsync -a --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
  --exclude='.venv' --exclude='frontend/.venv' --exclude='backend/static' \
  "$SCRIPT_DIR/" "$INSTALL_DIR/"
# Record source repo path so the backend can git-pull for auto-updates
echo "$SCRIPT_DIR" > "$INSTALL_DIR/source_repo.txt"
success "App files copied"

# ── 4. Create Python virtual environment ─────────────────────
info "Setting up Python environment…"
cd "$INSTALL_DIR/backend"
$PYTHON -m venv .venv
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
pip install -q rumps
success "Python dependencies installed"

# ── 5. Build frontend ─────────────────────────────────────────
info "Building frontend…"
cd "$INSTALL_DIR/frontend"
npm install --silent
npm run build
mkdir -p "$INSTALL_DIR/backend/static"
cp -r dist/. "$INSTALL_DIR/backend/static/"
success "Frontend built and embedded"

# ── 6. Create launch script ───────────────────────────────────
mkdir -p "$INSTALL_DIR/scripts"
LAUNCHER="$INSTALL_DIR/scripts/launch-mac.sh"
cat > "$LAUNCHER" << 'LAUNCHER_EOF'
#!/bin/bash
INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec "$INSTALL_DIR/backend/.venv/bin/python" "$INSTALL_DIR/scripts/menubar.py" --open
LAUNCHER_EOF
chmod +x "$LAUNCHER"

# ── 7. Create macOS .app bundle ──────────────────────────────
APP_BUNDLE="$HOME/Applications/$APP_NAME.app"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

cat > "$APP_BUNDLE/Contents/MacOS/launch" << APPEOF
#!/bin/bash
bash "$LAUNCHER"
APPEOF
chmod +x "$APP_BUNDLE/Contents/MacOS/launch"

cat > "$APP_BUNDLE/Contents/Info.plist" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>         <string>Director Assistant</string>
  <key>CFBundleIdentifier</key>   <string>com.director-assistant.app</string>
  <key>CFBundleVersion</key>      <string>2.1</string>
  <key>CFBundleExecutable</key>   <string>launch</string>
  <key>CFBundlePackageType</key>  <string>APPL</string>
  <key>LSUIElement</key>          <true/>
</dict>
</plist>
PLISTEOF

success "App bundle created: ~/Applications/$APP_NAME.app"

# ── 8. Install LaunchAgent (auto-start on login) ──────────────
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$PLIST_DIR/com.director-assistant.app.plist"
mkdir -p "$PLIST_DIR"

# Background launcher (no browser open — already running on login)
BACKGROUND_LAUNCHER="$INSTALL_DIR/scripts/launch-background.sh"
cat > "$BACKGROUND_LAUNCHER" << 'BG_EOF'
#!/bin/bash
INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec "$INSTALL_DIR/backend/.venv/bin/python" "$INSTALL_DIR/scripts/menubar.py"
BG_EOF
chmod +x "$BACKGROUND_LAUNCHER"

cat > "$PLIST_FILE" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.director-assistant.app</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$BACKGROUND_LAUNCHER</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key>
  <string>$HOME/.director-assistant/server.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/.director-assistant/server.log</string>
</dict>
</plist>
PLIST_EOF

# Load the agent now (starts the server immediately)
launchctl unload "$PLIST_FILE" 2>/dev/null || true
launchctl load "$PLIST_FILE"
success "Auto-start on login enabled (LaunchAgent installed)"

echo ""
echo "============================================"
echo "  Installation complete!  v$APP_VERSION"
echo "============================================"
echo ""
echo "  Director Assistant is now RUNNING at http://localhost:8000"
echo "  It will auto-start every time you log in."
echo ""
echo "  Open: http://localhost:8000"
echo "  Stop: launchctl unload ~/Library/LaunchAgents/com.director-assistant.app.plist"
echo "  Start: launchctl load ~/Library/LaunchAgents/com.director-assistant.app.plist"
echo ""
echo "  First-time setup:"
echo "  1. Open http://localhost:8000 in your browser"
echo "  2. Go to Settings → App Settings — enter your API key"
echo "  3. Go to Settings → Email Accounts → Add Account"
echo ""
