#!/bin/bash
# EZrecon-2 — environment bootstrap (macOS)
# Idempotent. Safe to re-run. Builds out everything the labs need:
#   Homebrew: nmap, s3270      pipx: ezrecon (from ezrecon-src/)
#   cicspwn/.venv + py3270 + wrapper      SearXNG container (keyless search)
#
# eZrecon by Kev Milne (OffensiveSec.org) and Phil Young (Soldier of Fortran).
# CICSpwn by Ayoub Elaassal (@Ayoul3) — this build adds only py3270 compat fixes.

set -uo pipefail
cd "$(dirname "$0")"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; DIM='\033[2m'; RESET='\033[0m'
info()  { echo -e "${CYAN}[setup]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[warn]${RESET}  $*"; }
ok()    { echo -e "${GREEN}[ok]${RESET}    $*"; }
bad()   { echo -e "${RED}[fail]${RESET}  $*"; }
step()  { echo -e "\n${CYAN}── $* ─────────────────────────────────────────${RESET}"; }

# ── config ────────────────────────────────────────────────────────────────
[ -f .env ] && . ./.env
SEARX_PORT="${SEARX_PORT:-10080}"
# eZrecon + CICSpwn are not in this repo — they're fetched from here.
EZRECON_REPO="${EZRECON_REPO:-https://github.com/kmilne40/ezrecon.git}"
EZ_ZIP="ezrecon/EZRecon.zip"
CICS_ZIP="ezrecon/cicspwn-python3-fixed.zip"

fails=0

# ── 1. Homebrew ──────────────────────────────────────────────────────────
step "Homebrew + CLI tools"
if ! command -v brew >/dev/null 2>&1; then
  bad "Homebrew not found. Install it from https://brew.sh and re-run."
  exit 1
fi
ok "brew $(brew --version | head -1 | awk '{print $2}')"

for tool in nmap s3270; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool present"
  else
    info "installing $tool …"
    if brew install "$tool" >/dev/null 2>&1; then ok "$tool installed"; else bad "brew install $tool failed"; fails=$((fails+1)); fi
  fi
done

if command -v nmap >/dev/null 2>&1; then
  n=$(ls "$(nmap --datadir 2>/dev/null || echo /opt/homebrew/share/nmap)"/scripts 2>/dev/null | grep -icE 'tn3270|cics|tso|vtam|drda|nje' || true)
  [ "${n:-0}" -ge 1 ] && ok "mainframe NSE scripts: ${n} present" || warn "no mainframe NSE scripts found — check the nmap install"
  echo -e "   ${DIM}script.db refresh (optional): sudo nmap --script-updatedb${RESET}"
fi

# ── 2. pipx ──────────────────────────────────────────────────────────────
step "pipx"
if ! command -v pipx >/dev/null 2>&1; then
  info "installing pipx …"
  brew install pipx >/dev/null 2>&1 && pipx ensurepath >/dev/null 2>&1
fi
command -v pipx >/dev/null 2>&1 && ok "pipx present" || { bad "pipx unavailable"; fails=$((fails+1)); }

# ── 3. unpack sources ────────────────────────────────────────────────────
step "sources"
# fetch eZrecon + CICSpwn (the release zips live in one repo) if not already local
if [ ! -f "$EZ_ZIP" ] && [ ! -d ezrecon-src ]; then
  if command -v git >/dev/null 2>&1; then
    info "fetching eZrecon + CICSpwn from $EZRECON_REPO"
    git clone --depth 1 "$EZRECON_REPO" ezrecon >/dev/null 2>&1 \
      && ok "cloned into ezrecon/" \
      || { bad "git clone $EZRECON_REPO failed — clone it into ./ezrecon manually"; fails=$((fails+1)); }
  else
    bad "git not found and no local $EZ_ZIP — install git or drop the eZrecon release zips in ./ezrecon/"; fails=$((fails+1))
  fi
fi
if [ ! -d ezrecon-src ] || [ ! -f ezrecon-src/pyproject.toml ]; then
  if [ -f "$EZ_ZIP" ]; then
    mkdir -p ezrecon-src && ( cd ezrecon-src && unzip -oq "../$EZ_ZIP" ) && ok "ezrecon-src/ unpacked"
  else
    bad "$EZ_ZIP not found"; fails=$((fails+1))
  fi
else
  ok "ezrecon-src/ present"
fi
if [ ! -f cicspwn/cicspwn.py ]; then
  if [ -f "$CICS_ZIP" ]; then
    mkdir -p cicspwn && ( cd cicspwn && unzip -oq "../$CICS_ZIP" ) && ok "cicspwn/ unpacked"
  else
    bad "$CICS_ZIP not found"; fails=$((fails+1))
  fi
else
  ok "cicspwn/ present"
fi

# ── 4. eZrecon (pipx) + the logging wrapper ─────────────────────────────
step "eZrecon"
if [ -f ezrecon-src/pyproject.toml ] && command -v pipx >/dev/null 2>&1; then
  if pipx install --force ./ezrecon-src >/dev/null 2>&1; then
    ok "ezrecon $(ezrecon --version 2>/dev/null | awk '{print $2}') installed"
  else
    bad "pipx install ./ezrecon-src failed"; fails=$((fails+1))
  fi
fi
# ezrecon2 — same as ezrecon, but every invocation is logged (local file +
# the SecTools audit log when the shell is up). Use it in place of ezrecon.
if [ -x sectools/bin/ezrecon2 ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$(pwd)/sectools/bin/ezrecon2" "$HOME/.local/bin/ezrecon2"
  ok "ezrecon2 (logging wrapper) → ~/.local/bin/ezrecon2"
fi

# ── 5. CICSpwn venv + wrapper ────────────────────────────────────────────
step "CICSpwn (venv + py3270 + wrapper)"
if [ -f cicspwn/cicspwn.py ]; then
  [ -d cicspwn/.venv ] || python3 -m venv cicspwn/.venv
  cicspwn/.venv/bin/python -m pip -q install --upgrade pip py3270 >/dev/null 2>&1
  if cicspwn/.venv/bin/python -c 'import py3270' >/dev/null 2>&1; then ok "py3270 in cicspwn/.venv"; else bad "py3270 install failed"; fails=$((fails+1)); fi
  if [ ! -x cicspwn/cicspwn ]; then
    cat > cicspwn/cicspwn <<'EOF'
#!/usr/bin/env bash
# macOS wrapper: run cicspwn.py with its venv interpreter. Usage matches the lab guide:
#   ./cicspwn -a CICS 127.0.0.1 23 -i
here="$(cd "$(dirname "$0")" && pwd)"
exec "$here/.venv/bin/python" "$here/cicspwn.py" "$@"
EOF
    chmod +x cicspwn/cicspwn && ok "cicspwn/cicspwn wrapper created"
  else
    ok "cicspwn/cicspwn wrapper present"
  fi
fi

# ── 6. SearXNG ───────────────────────────────────────────────────────────
step "SearXNG (keyless search)"
if command -v ezrecon >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    if docker ps -a --format '{{.Names}}' | grep -q '^ezrecon-searxng$'; then
      ok "container ezrecon-searxng already exists — start.sh will bring it up"
    else
      info "provisioning SearXNG on port ${SEARX_PORT} (first run pulls an image) …"
      ezrecon searx setup --yes --port "${SEARX_PORT}" && ok "SearXNG provisioned" || { warn "SearXNG setup did not finish — retry later with: ezrecon searx setup --yes --port ${SEARX_PORT}"; }
    fi
    docker update --restart unless-stopped ezrecon-searxng >/dev/null 2>&1 || true
  else
    warn "Docker not running — skipped SearXNG. Start Docker Desktop, then: ./start.sh"
  fi
fi

# ── 7. GIBSON check (separate repo) ──────────────────────────────────────
step "GIBSON simulator (CICSpwn target)"
GIBSON_DIR="${GIBSON_DIR:-$HOME/git/GIBSON/gibson-mainframe}"
if [ -d "$GIBSON_DIR" ]; then
  ok "found at $GIBSON_DIR — start it with:  ./start.sh --gibson"
else
  warn "not found at $GIBSON_DIR (set GIBSON_DIR in .env). CICSpwn labs need it running on 127.0.0.1:23."
fi

# ── done ────────────────────────────────────────────────────────────────
step "done"
if [ "$fails" -eq 0 ]; then
  ok "environment ready"
else
  warn "$fails step(s) had problems — see [fail] lines above"
fi
cat <<EOF

  Next:   ./start.sh            bring SearXNG (and --gibson) up
          ./status.sh           health check
          open TRAINING-QUICKREF.md / .html   the labs

  eZrecon  · Kev Milne + Phil Young      CICSpwn · Ayoub Elaassal (@Ayoul3)
EOF
exit "$fails"
