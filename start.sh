#!/bin/bash
# EZrecon-2 — start everything
#   ./start.sh            SearXNG up + status
#   ./start.sh --gibson   also start the GIBSON simulator (CICSpwn target)
#
# eZrecon by Kev Milne (OffensiveSec.org) and Phil Young (Soldier of Fortran).

set -uo pipefail
cd "$(dirname "$0")"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; DIM='\033[2m'; RESET='\033[0m'
info() { echo -e "${CYAN}[start]${RESET} $*"; }
warn() { echo -e "${YELLOW}[warn]${RESET}  $*"; }
ok()   { echo -e "${GREEN}[ok]${RESET}    $*"; }
bad()  { echo -e "${RED}[fail]${RESET}  $*"; }

[ -f .env ] && . ./.env
SEARX_PORT="${SEARX_PORT:-10080}"
SECTOOLS_PORT="${SECTOOLS_PORT:-8899}"
GIBSON_DIR="${GIBSON_DIR:-$HOME/git/GIBSON/gibson-mainframe}"
WANT_GIBSON=0; WANT_SECTOOLS=0
for a in "$@"; do
  [ "$a" = "--gibson" ] && WANT_GIBSON=1
  [ "$a" = "--sectools" ] && WANT_SECTOOLS=1
done

command -v ezrecon >/dev/null 2>&1 || { bad "ezrecon not found — run ./setup.sh first"; exit 1; }

# ── SearXNG ─────────────────────────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  bad "Docker is not running. Start Docker Desktop and re-run ./start.sh"
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -q '^ezrecon-searxng$'; then
  ok "SearXNG already running"
elif docker ps -a --format '{{.Names}}' | grep -q '^ezrecon-searxng$'; then
  info "starting SearXNG container …"
  docker start ezrecon-searxng >/dev/null && ok "SearXNG started" || bad "could not start ezrecon-searxng"
else
  info "SearXNG container missing — provisioning on port ${SEARX_PORT} …"
  ezrecon searx setup --yes --port "${SEARX_PORT}" || warn "SearXNG setup did not finish"
fi
docker update --restart unless-stopped ezrecon-searxng >/dev/null 2>&1 || true

# give it a moment, then report
sleep 1
ezrecon searx status 2>/dev/null | sed 's/^/   /'

# ── GIBSON ─────────────────────────────────────────────────────────────
if [ "$WANT_GIBSON" -eq 1 ]; then
  if nc -z 127.0.0.1 23 >/dev/null 2>&1; then
    ok "GIBSON already listening on 127.0.0.1:23"
  elif [ -x "$GIBSON_DIR/run_gibson.sh" ]; then
    info "starting GIBSON from $GIBSON_DIR (own terminal recommended) …"
    ( cd "$GIBSON_DIR" && ./run_gibson.sh ) &
    for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; nc -z 127.0.0.1 23 >/dev/null 2>&1 && break; done
    nc -z 127.0.0.1 23 >/dev/null 2>&1 && ok "GIBSON up on 127.0.0.1:23" || warn "GIBSON not answering yet — check its own logs"
  else
    warn "no run_gibson.sh at $GIBSON_DIR — start GIBSON however you normally do"
  fi
else
  nc -z 127.0.0.1 23 >/dev/null 2>&1 && ok "GIBSON is listening on 127.0.0.1:23" \
    || echo -e "   ${DIM}GIBSON not running — add --gibson, or start it in ~/git/GIBSON${RESET}"
fi

# ── SecTools shell (optional) ─────────────────────────────────────────
if [ "$WANT_SECTOOLS" -eq 1 ]; then
  if nc -z 127.0.0.1 "$SECTOOLS_PORT" >/dev/null 2>&1; then
    ok "SecTools shell already on :$SECTOOLS_PORT"
  elif [ -f sectools/server.js ]; then
    [ -d sectools/node_modules ] || ( cd sectools && npm install >/dev/null 2>&1 )
    # run with the full path so pgrep/pkill 'sectools/server.js' can find it
    SECTOOLS_PORT="$SECTOOLS_PORT" nohup node "$(pwd)/sectools/server.js" >/tmp/ezrecon2-sectools.log 2>&1 </dev/null &
    for i in 1 2 3 4 5; do sleep 1; nc -z 127.0.0.1 "$SECTOOLS_PORT" >/dev/null 2>&1 && break; done
    nc -z 127.0.0.1 "$SECTOOLS_PORT" >/dev/null 2>&1 \
      && ok "SecTools shell → http://127.0.0.1:$SECTOOLS_PORT  (log: /tmp/ezrecon2-sectools.log)" \
      || warn "SecTools shell did not come up — see /tmp/ezrecon2-sectools.log"
  else
    warn "sectools/ not found"
  fi
fi

cat <<EOF

  Ready.
    ezrecon                       TUI (real terminal)
    ezrecon auto sighberbank.com --report ./out
    cd cicspwn && ./cicspwn -a CICS 127.0.0.1 23 -i
    ./start.sh --sectools         unified SecTools shell (http://127.0.0.1:$SECTOOLS_PORT)
    ./status.sh                   re-check   ·   ./stop.sh   shut down

EOF
