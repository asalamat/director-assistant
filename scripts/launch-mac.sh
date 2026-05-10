#!/bin/bash
# Production launcher — serves frontend from FastAPI (no Vite needed)
INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$INSTALL_DIR/backend"

if [ ! -d ".venv" ]; then
  echo "Run install-mac.sh first."
  exit 1
fi

source .venv/bin/activate

# Build static if missing
if [ ! -d "static" ]; then
  echo "Building frontend…"
  cd "$INSTALL_DIR/frontend" && npm run build && cp -r dist "$INSTALL_DIR/backend/static"
  cd "$INSTALL_DIR/backend"
fi

uvicorn main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

sleep 3
if command -v open &>/dev/null; then
  open "http://localhost:8000"
fi

echo "Director Assistant running at http://localhost:8000"
echo "Press Ctrl+C to stop"
trap "kill $BACKEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait $BACKEND_PID
