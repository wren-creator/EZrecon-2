#!/bin/bash
# EZrecon-2 — health check. Read-only; changes nothing.

set -uo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; DIM='\033[2m'; RESET='\033[0m'
y() { echo -e "  ${GREEN}✓${RESET} $*"; }
n() { echo -e "  ${RED}✗${RESET} $*"; }
m() { echo -e "  ${YELLOW}•${RESET} $*"; }

[ -f .env ] && . ./.env
SEARX_PORT="${SEARX_PORT:-10080}"
GIBSON_DIR="${GIBSON_DIR:-$HOME/git/GIBSON/gibson-mainframe}"

echo
echo "EZrecon-2 — status"
echo "=================="

if command -v ezrecon >/dev/null 2>&1; then y "eZrecon $(ezrecon --version 2>/dev/null | awk '{print $2}')  ($(command -v ezrecon))"; else n "ezrecon not on PATH — run ./setup.sh"; fi
if command -v ezrecon2 >/dev/null 2>&1; then y "ezrecon2 logging wrapper  ($(command -v ezrecon2))"; else m "ezrecon2 wrapper not linked — ./setup.sh, or run sectools/bin/ezrecon2 directly"; fi
if command -v nmap >/dev/null 2>&1; then
  nse=$(ls "$(nmap --datadir 2>/dev/null || echo /opt/homebrew/share/nmap)"/scripts 2>/dev/null | grep -icE 'tn3270|cics|tso|vtam|drda|nje' || echo 0)
  y "nmap $(nmap --version | head -1 | awk '{print $3}')  ·  ${nse} mainframe NSE scripts"
else n "nmap missing"; fi
command -v s3270 >/dev/null 2>&1 && y "s3270 $(command -v s3270)" || n "s3270 missing"

if [ -x cicspwn/.venv/bin/python ] && cicspwn/.venv/bin/python -c 'import py3270' >/dev/null 2>&1; then
  y "cicspwn venv + py3270  ·  wrapper $( [ -x cicspwn/cicspwn ] && echo present || echo MISSING )"
else n "cicspwn venv not ready — run ./setup.sh"; fi

if docker info >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' | grep -q '^ezrecon-searxng$'; then
    api=$(ezrecon searx status 2>/dev/null | grep -i 'JSON API' | sed 's/.*working: *//')
    y "SearXNG running on :${SEARX_PORT}  ·  JSON API ${api:-?}"
  else
    m "SearXNG container not running — ./start.sh"
  fi
else
  m "Docker not running (SearXNG unavailable)"
fi

if nc -z 127.0.0.1 23 >/dev/null 2>&1; then y "GIBSON listening on 127.0.0.1:23"
elif [ -d "$GIBSON_DIR" ]; then m "GIBSON present but not running — ./start.sh --gibson"
else m "GIBSON not found at $GIBSON_DIR"; fi

SECTOOLS_PORT="${SECTOOLS_PORT:-8899}"
if nc -z 127.0.0.1 "$SECTOOLS_PORT" >/dev/null 2>&1; then y "SecTools shell on http://127.0.0.1:$SECTOOLS_PORT"
elif [ -f sectools/server.js ]; then
  t=$([ -d sectools/node_modules ] && echo "deps ok" || echo "run: cd sectools && npm install")
  m "SecTools shell present, not running — ./start.sh --sectools  ($t)"
else m "sectools/ not built"; fi

echo
echo -e "${DIM}targets:  eZrecon → sighberbank.com   ·   CICSpwn → GIBSON 127.0.0.1:23 CICS${RESET}"
echo -e "${DIM}credits:  eZrecon by Kev Milne + Phil Young  ·  CICSpwn by Ayoub Elaassal (@Ayoul3)${RESET}"
echo
