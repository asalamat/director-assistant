#!/bin/bash
# ============================================================
# Director Assistant — macOS Installer
# ============================================================
# Requirements: macOS 12+, Internet connection
# Run with:  bash install-mac.sh
# ============================================================

set -e

APP_NAME="Director Assistant"
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
echo "  Director Assistant — macOS Installer"
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
    success "Found Node.js v$(node --version)"
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
cp -r "$SCRIPT_DIR/." "$INSTALL_DIR/"
success "App files copied"

# ── 4. Create Python virtual environment ─────────────────────
info "Setting up Python environment…"
cd "$INSTALL_DIR/backend"
$PYTHON -m venv .venv
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
success "Python dependencies installed"

# ── 5. Build frontend ─────────────────────────────────────────
info "Building frontend…"
cd "$INSTALL_DIR/frontend"
npm install --silent
npm run build
cp -r dist "$INSTALL_DIR/backend/static"
success "Frontend built and copied to backend/static/"

# ── 6. Create .env if missing ─────────────────────────────────
cd "$INSTALL_DIR/backend"
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  warn "Created $INSTALL_DIR/backend/.env"
  warn "IMPORTANT: Open this file and add your ANTHROPIC_API_KEY"
  warn "  nano $INSTALL_DIR/backend/.env"
  echo ""
fi

# ── 7. Create launch script ───────────────────────────────────
LAUNCHER="$INSTALL_DIR/scripts/launch-mac.sh"
cat > "$LAUNCHER" << 'LAUNCHER_EOF'
#!/bin/bash
# Launch Director Assistant (single-server mode — no Node.js needed)
INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$INSTALL_DIR/backend"
source .venv/bin/activate
uvicorn main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!
sleep 3
open "http://localhost:8000"
echo "Director Assistant running at http://localhost:8000"
echo "Press Ctrl+C to stop"
trap "kill $BACKEND_PID 2>/dev/null" SIGINT SIGTERM
wait $BACKEND_PID
LAUNCHER_EOF
chmod +x "$LAUNCHER"

# ── 8. Create macOS .app bundle ──────────────────────────────
APP_BUNDLE="$HOME/Desktop/$APP_NAME.app"
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
  <key>CFBundleVersion</key>      <string>1.1</string>
  <key>CFBundleExecutable</key>   <string>launch</string>
  <key>CFBundlePackageType</key>  <string>APPL</string>
  <key>LSUIElement</key>          <true/>
</dict>
</plist>
PLISTEOF

success "App bundle created: $APP_BUNDLE"

echo ""
echo "============================================"
echo "  Installation complete!"
echo "============================================"
echo ""
echo "  1. Open ~/.director-assistant/.env"
echo "     and add your ANTHROPIC_API_KEY"
echo ""
echo "  2. Double-click 'Director Assistant' on your Desktop"
echo "     (or run: bash $LAUNCHER)"
echo ""
echo "  The app will open at http://localhost:8000"
echo ""
