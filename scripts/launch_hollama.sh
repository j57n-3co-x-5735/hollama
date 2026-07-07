#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BINARY="$APP_DIR/dist/linux-unpacked/hollama"
PORT="${PORT:-4173}"

# --- Paste your API key here ---
export OPENAI_API_KEY=""
# --------------------------------

# Optional: allow connections to a remote Ollama server
# export PUBLIC_CSP_CONNECT_SOURCES="https://ollama.example.com"

if [ ! -f "$BINARY" ]; then
    echo "Binary not found at $BINARY"
    echo "Run 'npm run electron:build' first."
    exit 1
fi

# --- Cleanup: kill any stale Hollama/node processes on our port ---
stale_pids=$(lsof -ti:"$PORT" 2>/dev/null || true)
if [ -n "$stale_pids" ]; then
    echo "Killing stale process(es) on port $PORT: $stale_pids"
    echo "$stale_pids" | xargs kill -9 2>/dev/null || true
    sleep 0.5
fi

# Kill any lingering hollama electron processes (exclude this script and the build)
pkill -f "dist/linux-unpacked/hollama" 2>/dev/null || true
sleep 0.2

# --- Clean stale runtime state ---
rm -rf "$APP_DIR/.hollama/credentials.json.tmp" 2>/dev/null || true

echo "Launching Hollama..."
[ -n "$OPENAI_API_KEY" ] && echo "API key: set via env var" || echo "API key: not set (enter in Settings)"
echo "Port: $PORT"
echo ""

"$BINARY" 2>&1 | grep -v gbm_wrapper
