#!/usr/bin/env bash
# Run production: Weave server + the named Cloudflare tunnel "weave" (app.askweave.xyz and *.askweave.xyz).
#
# One-time setup:
#   cloudflared tunnel login                         # pick askweave.xyz
#   cloudflared tunnel create weave
#   cloudflared tunnel route dns weave app.askweave.xyz
#   cloudflared tunnel route dns weave '*.askweave.xyz'
#   cloudflared tunnel token weave > ~/.cloudflared/weave.token && chmod 600 ~/.cloudflared/weave.token
#
# The tunnel's public hostnames all go to the local server; the server tells app.askweave.xyz apart from
# <username>.askweave.xyz by the Host header (weave/web/hosting.py).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${WEAVE_PORT:-8765}"
CF="$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")"
TOKEN_FILE="${WEAVE_TUNNEL_TOKEN_FILE:-$HOME/.cloudflared/weave.token}"
[ -x "$CF" ] || { echo "cloudflared not found"; exit 1; }
[ -s "$TOKEN_FILE" ] || { echo "No tunnel token at $TOKEN_FILE (see the setup steps at the top of this script)"; exit 1; }
mkdir -p data

"$CF" tunnel --no-autoupdate run --url "http://127.0.0.1:${PORT}" --token "$(cat "$TOKEN_FILE")" >data/cloudflared.log 2>&1 &
CF_PID=$!
trap 'kill "$CF_PID" 2>/dev/null || true' EXIT INT TERM

export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://app.askweave.xyz}"
echo "$PUBLIC_BASE_URL" > data/public_url
echo "  Weave: $PUBLIC_BASE_URL  (tunnel log: data/cloudflared.log, dashboard: http://127.0.0.1:$PORT)"
.venv/bin/python -m weave serve
