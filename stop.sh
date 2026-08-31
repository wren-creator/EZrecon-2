#!/bin/bash
# EZrecon-2 — stop services started by start.sh
#   ./stop.sh            stop SearXNG
#   ./stop.sh --all      also stop GIBSON if this host started it

set -uo pipefail
cd "$(dirname "$0")"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RESET='\033[0m'
info() { echo -e "${CYAN}[stop]${RESET}  $*"; }
warn() { echo -e "${YELLOW}[warn]${RESET}  $*"; }
ok()   { echo -e "${GREEN}[ok]${RESET}    $*"; }

# ── SearXNG ─────────────────────────────────────────────────────────────
if docker info >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q '^ezrecon-searxng$'; then
  docker stop ezrecon-searxng >/dev/null && ok "SearXNG stopped"
else
  info "SearXNG not running"
fi

# ── SecTools shell ────────────────────────────────────────────────────
if pgrep -f 'sectools/server.js' >/dev/null 2>&1; then
  pkill -f 'sectools/server.js' && ok "SecTools shell stopped"
else
  info "SecTools shell not running"
fi

# ── GIBSON (only with --all; it lives in its own repo) ──────────────────
if [ "${1:-}" = "--all" ]; then
  GIBSON_DIR="${GIBSON_DIR:-$HOME/git/GIBSON/gibson-mainframe}"
  [ -f .env ] && . ./.env
  if [ -x "$GIBSON_DIR/gibsonctl.sh" ]; then
    ( cd "$GIBSON_DIR" && ./gibsonctl.sh stop ) && ok "GIBSON stop requested"
  else
    warn "no gibsonctl.sh at $GIBSON_DIR — stop GIBSON in its own terminal"
  fi
else
  nc -z 127.0.0.1 23 >/dev/null 2>&1 && info "GIBSON still up on :23 (stop it in its own terminal, or ./stop.sh --all)"
fi

ok "done"
