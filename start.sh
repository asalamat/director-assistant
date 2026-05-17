#!/bin/bash
# ============================================================
# Director Assistant — Start Script
# ============================================================
# Usage:
#   bash start.sh           — production mode (port 8000, built frontend)
#   bash start.sh dev       — dev mode (backend 8000 + frontend 5173 hot-reload)
# ============================================================

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# Prevent loky/tokenizer parallelism crashes on Python 3.13
export TOKENIZERS_PARALLELISM=false
export OMP_NUM_THREADS=1

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }

MODE="${1:-prod}"

# Kill anything already using port 8000
kill_port() {
    local pid
    pid=$(lsof -ti :"$1" 2>/dev/null)
    if [ -n "$pid" ]; then
        warn "Killing existing process on port $1 (PID $pid)…"
        kill -9 $pid 2>/dev/null
        sleep 1
    fi
}

# ── PRODUCTION MODE ──────────────────────────────────────────
if [ "$MODE" != "dev" ]; then
    kill_port 8000

    # Build frontend if static dir is missing or outdated
    if [ ! -f "$BACKEND/static/index.html" ]; then
        info "Building frontend…"
        cd "$FRONTEND" && npm install --silent && npm run build
        mkdir -p "$BACKEND/static"
        cp -r "$FRONTEND/dist/." "$BACKEND/static/"
        success "Frontend built"
    fi

    cd "$BACKEND"
    source .venv/bin/activate

    echo ""
    echo "============================================"
    echo "  Director Assistant — Production"
    echo "  http://localhost:8000"
    echo "  Press Ctrl+C to stop"
    echo "============================================"
    echo ""

    # Open browser after 3 seconds
    (sleep 3 && open "http://localhost:8000" 2>/dev/null || xdg-open "http://localhost:8000" 2>/dev/null) &

    uvicorn main:app --host 0.0.0.0 --port 8000

# ── DEV MODE ─────────────────────────────────────────────────
else
    kill_port 8000

    cd "$BACKEND"
    source .venv/bin/activate

    echo ""
    echo "============================================"
    echo "  Director Assistant — Dev Mode"
    echo "  Frontend: http://localhost:5173"
    echo "  Backend:  http://localhost:8000"
    echo "  Press Ctrl+C to stop both"
    echo "============================================"
    echo ""

    # Start backend with reload
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
    BACKEND_PID=$!

    # Start frontend dev server
    cd "$FRONTEND"
    npm run dev &
    FRONTEND_PID=$!

    # Open browser after 4 seconds
    (sleep 4 && open "http://localhost:5173" 2>/dev/null || xdg-open "http://localhost:5173" 2>/dev/null) &

    # Stop both on Ctrl+C
    trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
    wait
fi
