# EZrecon-2 SecTools (standalone shell)

One client, four surfaces, one engagement record:

```
Recon  ──▶  Targets  ──▶  Session (live 3270)  ──▶  CICS  ──▶  Evidence
(eZrecon)   (rail)        (tn3270_library)          (primitives)  (report)
```

A self-contained Node app that unifies:

- **Recon** — the eZrecon CLI (Kev Milne, Phil Young), run at arm's length via
  `ezrecon <cmd> --report json`; findings normalised into the engagement.
- **Session** — a live TN3270(E) terminal over **tn3270_library** (Britley Wren Hoff).
- **CICS** — five attack primitives (`infoGather`, `enumTSQ`, `readFile`,
  `racfBypass`, `enableTrans`), clean-room reimplementations of the techniques in
  **CICSpwn** (Ayoub Elaassal, @Ayoul3, GPL). No CICSpwn code is imported. The
  Python tool stays as a conformance oracle.
- **Evidence** — every finding, recording, and CICS action in one `Engagement`
  record with a report generator (md / html / json).

Nothing here is web3270-specific. The panels, the endpoints, the schema and the
CICS primitives are written to port into `web3270/Bridge_server/` later. See
[`WIRING.md`](./WIRING.md).

## Run it

```bash
npm install
npm start                 # http://127.0.0.1:8899
npm test                  # 19 tests, no network (uses the in-process CICS mock)
```

Open the URL. There is no build step and nothing is bundled in the browser.

A **command console** sits at the bottom of every tab (collapsible). It is not a
system shell — every command routes through the same audited API. `help` lists
them: `recon auto <domain>`, `target add <addr>`, `authorise <addr> --approver X
--scope "…"`, `connect <addr>`, `cics racfBypass <addr>`, `audit`, `report`.
New audit lines stream into it live.

### Try it with no mainframe

Add a target with address **`mock`** (the rail's "＋ Add" box, or the MCP
`add_target` tool). It connects to an in-process CICS mock (`mock-cics/`) that
answers CEMT / CEDA / CECI for all five primitives with GIBSON-flavoured output.

### Against GIBSON / a real LPAR

Add a target with the real host + port (23, or 992 with `tls`). `./start.sh`
in the repo root brings GIBSON up first (`./start.sh --gibson`).

### Through the web3270 bridge

Tick **via web3270 bridge** when adding the target (or `target add <host> <port>
--bridge` in the console). The session then runs through a running web3270
bridge (`SECTOOLS_BRIDGE_URL`, default `ws://127.0.0.1:8081`) instead of raw TCP,
so whatever that bridge has armed — MITM, Traffic Recorder, Anomaly Detector,
ESM Fingerprint — sees every AID and screen the CICS primitives produce. The
bridge just needs a route to the host (a matching LPAR profile helps but the
connect frame carries host/port directly). Nothing to arm on this side.

## Layout

| Path | Role |
|---|---|
| `lib/engagement.js` | schema factories — `Finding` (eZrecon's shape), `Target`, `Action`, `Engagement` |
| `lib/store.js` | `EngagementStore` — Map + JSON persistence + `change` events (web3270 `*-store.js` pattern) |
| `lib/recon.js` | eZrecon CLI wrapper → `Finding[]` + candidate targets |
| `lib/tn3270.js` | adapter over a driver — connect / type / press / waitFor |
| `lib/bridge-backend.js` | drives a **web3270 bridge** session over its WebSocket, so the bridge's MITM / Traffic Recorder / Anomaly Detector / ESM Fingerprint see the CICS traffic |
| `lib/cics.js` | the five primitives, backend-agnostic; each returns `{ ok, data, steps[], transcript[] }` |
| `lib/report.js` | `Engagement` → `{ json, md, html }` + exposure score |
| `lib/audit.js` | append-only `data/audit.log` — operator id + target domain per action |
| `mock-cics/` | in-process CICS fake with the same driver contract |
| `server.js` | HTTP + WS: static client, `/api/*`, live-session relay |
| `public/` | the 4-panel client (`index.html`, `css/app.css`, `js/app.js`) |
| `mcp/server.js` | zero-dep stdio MCP server — a client of `/api/*` (`recon_run`, `cics_run`, …) |

## API sketch

```
GET  /api/engagements                              POST (create)
GET  /api/engagement/:id
POST /api/engagement/:id/recon         {argv:["auto","example.com"]}
POST /api/engagement/:id/targets       {addr,port,kind,applid,provenance}
POST /api/engagement/:id/target/:tid/authorise  {approver,scope}   → gates active actions
POST /api/engagement/:id/target/:tid/revoke
POST /api/engagement/:id/target/:tid/connect
POST /api/engagement/:id/target/:tid/cics   {primitive,opts}       → 403 on active without authorise
POST /api/engagement/:id/target/:tid/esm    {product,confidence,evidence}
GET  /api/engagement/:id/report.(json|md|html)
GET  /api/audit                        append-only log (X-User-Id + target per action)
WS   /ws   subscribe · session.attach · session.aid · session.disconnect

All requests carry `X-User-Id` (operator id, logged).
```

## Authorisation + audit

**Passive by default.** These require an explicit per-target authorisation:

- active eZrecon recon: `ports`, `nse`, `buckets`
- state-changing CICS primitives: `readFile`, `racfBypass`, `enableTrans`

Authorise a target (rail → **Authorise**, or `POST .../target/:tid/authorise`
with `{approver, scope}`). Until then the active recon button and those CICS
Run buttons are disabled, and the API answers **403**. `infoGather` and
`enumTSQ` are read-only and always run.

**Operator id.** Every request carries `X-User-Id` (the client prompts once and
stores it; the MCP server sends `SECTOOLS_USER`). It defaults to `anonymous`
if absent.

**Audit log.** `data/audit.log` — one JSON line per action, never rewritten:

```json
{"ts":"…","event":"cics-active","userId":"britley.hoff","target":"tso.acme.com:23",
 "engagementId":"eng_…","detail":{"primitive":"racfBypass","approver":"security-lead"}}
```

Events: `authorise`, `revoke`, `denied`, `active-recon`, `cics`, `cics-active`,
`session.connect`. Read it at `GET /api/audit` or the Evidence tab.

**Hard lock.** `SECTOOLS_LOCK_ACTIVE=true` refuses all active work even for
authorised targets (locked-down / demo deployments).

GIBSON is the safe practice target.

## Credits

- **eZrecon** — Kev Milne (OffensiveSec.org) and Phil Young (Soldier of Fortran)
- **CICSpwn** — Ayoub Elaassal (@Ayoul3), GPL — techniques reimplemented clean-room
- **tn3270_library** — Britley Wren Hoff
- **GIBSON** — Kev Milne
