#!/bin/bash
# Launch Director Assistant with menu bar icon (macOS)
INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "$INSTALL_DIR/backend/.venv" ]; then
  echo "Run install-mac.sh first."
  exit 1
fi

# Build static assets if missing
if [ ! -d "$INSTALL_DIR/backend/static" ]; then
  echo "Building frontend…"
  cd "$INSTALL_DIR/frontend" && npm run build
  cp -r dist "$INSTALL_DIR/backend/static"
fi

# Install rumps if missing (needed for menu bar icon)
if ! "$INSTALL_DIR/backend/.venv/bin/python" -c "import rumps" 2>/dev/null; then
  echo "Installing rumps for menu bar support…"
  "$INSTALL_DIR/backend/.venv/bin/pip" install rumps --quiet
fi

exec "$INSTALL_DIR/backend/.venv/bin/python" "$INSTALL_DIR/scripts/menubar.py" --open
