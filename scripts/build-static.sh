#!/bin/bash
# Builds the React frontend into backend/static/ so FastAPI serves it directly.
# Run this before packaging the app for distribution.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/frontend"
STATIC="$ROOT/backend/static"

echo "Building frontend…"
cd "$FRONTEND"

if [ ! -d "node_modules" ]; then
  echo "Installing Node dependencies…"
  npm install
fi

npm run build

echo "Copying dist to backend/static/…"
rm -rf "$STATIC"
cp -r "$FRONTEND/dist" "$STATIC"

echo "Done — backend/static/ is ready"
