# EZrecon-2

A macOS-verified mainframe reconnaissance and CICS-assessment bundle, built for a
Red Hat mainframe security training, and the **SecTools shell** that unifies it
into one screen.

EZrecon-2 is **not a fork of eZrecon.** It stands on eZrecon (Kev Milne, Phil
Young), CICSpwn (Ayoub Elaassal), the `tn3270_library` TN3270E stack, and the
GIBSON simulator (Kev Milne), and adds:

- **`sectools/`** — a standalone Node app: Recon → Targets → live 3270 Session →
  CICS primitives → Evidence, all sharing one engagement record, with a
  per-target authorisation gate and an append-only audit log. It also has a
  backend that runs the session through a browser-based TN3270 bridge so that
  bridge's MITM / Traffic Recorder / Anomaly Detector / ESM Fingerprint see the
  traffic. See [`sectools/README.md`](sectools/README.md).
- **`ezrecon2`** — a pass-through wrapper: `ezrecon2 <anything you'd give ezrecon>`
  behaves identically and records the invocation (operator id, argv, target,
  exit) to a local log and the SecTools audit log.
- **Setup / run scripts** for the whole macOS lab.
- **Training material** — a keyboard-side lab card and a shell wireframe.

## Quick start (macOS)

```bash
./setup.sh                     # once: eZrecon (pipx), nmap + s3270 (brew),
                               #       cicspwn venv, SearXNG, the ezrecon2 wrapper
./start.sh --sectools          # SecTools shell on http://127.0.0.1:8899
./start.sh --sectools --gibson # ...also start the GIBSON simulator
./status.sh                    # health check (incl. the web3270 bridge)
./stop.sh
```

`setup.sh` fetches eZrecon and CICSpwn from
[`github.com/kmilne40/ezrecon`](https://github.com/kmilne40/ezrecon) (override
with `EZRECON_REPO`). They are **not** included in this repo.

## Layout

| Path | |
|---|---|
| `sectools/` | the SecTools shell (Node, no build step) — the main deliverable |
| `sectools/bin/ezrecon2` | the logging wrapper |
| `setup.sh` `start.sh` `stop.sh` `status.sh` | lab bootstrap + run |
| `TRAINING-QUICKREF.md` / `.html` | the lab card |
| `SECTOOLS-SHELL-WIREFRAME.html` | the shell wireframe |
| `wordlist.txt` | a mainframe-flavoured subdomain list for eZrecon |
| `ezrecon/` `ezrecon-src/` `cicspwn/` | fetched by `setup.sh`; git-ignored |

## Authorised use only

This is offensive security tooling for **authorised** penetration testing, CTF,
and education. Run it only against systems you own or have explicit written
permission to test. **GIBSON** — Kev Milne's deliberately vulnerable z/OS
simulator — is the safe practice target, and every test and lab in here runs
against it.

## Credits

- **eZrecon** — **Kev Milne** (OffensiveSec.org) and **Phil Young**
  (Soldier of Fortran). The mainframe OSINT / recon engine. EZrecon-2 shells out
  to the `ezrecon` CLI; the recon intelligence is entirely theirs. eZrecon ships
  under its own "Community and Educational" licence.
- **CICSpwn** — **Ayoub Elaassal** ([@Ayoul3](https://github.com/ayoul3)), GPL.
  The original CICS penetration-testing tool. The primitives in
  `sectools/lib/cics.js` are a **clean-room reimplementation of the techniques**
  it demonstrates — no CICSpwn source is imported, vendored, or linked; the
  Python tool is used only as a conformance oracle.
- **tn3270_library** — **Britley Wren Hoff**. The zero-dependency TN3270/TN3270E
  protocol stack.
- **GIBSON** — **Kev Milne**. The z/OS training simulator.
- The lab exercises mirror the companion material for **_Hacking Mainframes_**.

## Licence

**GPL-3.0-or-later** — see [`LICENSE`](LICENSE). Applies to the EZrecon-2 code in
this repo (`sectools/`, the scripts, the docs) and its use of `tn3270_library`.
eZrecon and CICSpwn are separate tools with their own licences, fetched and run
at arm's length by `setup.sh`; they are not included or linked here.
