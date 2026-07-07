#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# --- Backend ---
if [ ! -d "$BACKEND/.venv" ]; then
  echo "Creating Python virtualenv..."
  python3 -m venv "$BACKEND/.venv"
fi
source "$BACKEND/.venv/bin/activate"

if [ ! -f "$BACKEND/.env" ]; then
  cp "$BACKEND/.env.example" "$BACKEND/.env"
  echo ""
  echo "!! Created $BACKEND/.env — add your ANTHROPIC_API_KEY before starting"
  echo ""
fi

pip install -q -r "$BACKEND/requirements.txt"

echo "Starting backend on http://localhost:8000 ..."
cd "$BACKEND"
uvicorn main:app --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!

# --- Frontend ---
cd "$FRONTEND"
if [ ! -d "node_modules" ]; then
  echo "Installing frontend deps..."
  npm install
fi

echo "Starting frontend on http://localhost:5173 ..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Director Assistant running:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop both"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" SIGINT SIGTERM
wait
