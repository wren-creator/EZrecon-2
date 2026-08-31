# Wiring EZrecon-2 SecTools into web3270

This module is standalone on purpose. When it goes into `web3270/Bridge_server/`
(where the ESM-fingerprint + MCP work already lives), the parts map like this.
The shapes were chosen to match web3270's existing conventions so the port is
mechanical, not a rewrite.

## Region → destination

| SecTools file | web3270 destination | Notes |
|---|---|---|
| `lib/engagement.js` | `features/engagement.js` | Pure schema. Drop in as-is. `Finding` already matches eZrecon; `Target.esm` already matches `features/esm-fingerprint.js`'s `{product,confidence,evidence[]}`. |
| `lib/store.js` | `features/engagement-store.js` | Same `Map` + `change`-event pattern as `features/recording.js` / `esm-store.js`. Swap the JSON persistence for Postgres in `webterm-3270-saas`. |
| `lib/recon.js` | `features/recon.js` | Keep the CLI shell-out for the training. Later, point it at a `recon-svc` FastAPI sidecar (streams `on_stage`) — only `runRecon()`'s transport changes. |
| `lib/tn3270.js` | drop the `real` backend; keep the shape | web3270's bridge already owns the TN3270 session (`tn3270/session.js`). Inside web3270 the adapter wraps that session object directly. |
| `lib/bridge-backend.js` | this is the seam | It already speaks web3270's WS protocol (`connect` / `key` / `disconnect` → `status` / `screen` / `error`, mirroring `Bridge_server/mcp/bridge-client.js`). In standalone mode it's how EZrecon-2 reaches a running bridge; when the code lives *inside* web3270 you skip the WS hop and call the session object, but the frame shapes and the primitives above it don't change. |
| `lib/cics.js` | `features/cics.js` | The primitives call the adapter interface only, so they move unchanged once the adapter points at the bridge session. Keep `steps[]`/`transcript[]` for the oracle diff. |
| `mock-cics/` | `mock-lpar/mock-cics.js` | Fold into the existing mock-LPAR infra. This is the **critical-path fixture** — every other web3270 feature is "testable against the mocks"; CICS needs its own. The in-process version here is the spec; a TCP TN3270E mock-cics for `mock-lpar/` is the real port. |
| `lib/report.js` | `features/report.js` | Feeds off the `Engagement` only. Add `.rec.json` recording refs + the ESM evidence trail to the same record before generating. |
| `lib/audit.js` + the `authoriseTarget`/`requireAuthorised` gate | web3270's **server-side security-tools unlock** (`routes/security.js`, the `CAPS.securityTools` flag in `handlers/ws.js`) + a real audit sink | Today the gate is per-target with an `X-User-Id` header and a JSONL file. In web3270 it becomes: the security-tools password unlock supplies the operator identity, the per-target authorisation is an extra grant on top, and `data/audit.log` is replaced by the bridge's logger / Postgres. Keep the `denied` / `cics-active` event names. |
| `server.js` routes | `routes/{recon,cics,engagement}.js` + `handlers/http.js` ROUTES array | Model on `routes/esm.js` / `routes/negotiate.js`. |
| `server.js` WS cases | `handlers/ws.js` | Add `recon.stage`, `cics.run`, `engagement.subscribe` cases next to the existing `sec.*` handlers. Gate behind the server-side security-tools unlock (currently `CAPS.securityTools` is hard-coded true — see `ROADMAP.md`). |
| `public/js/app.js` | split into `public/js/{recon,engagement,session,cics,evidence}.js` | The MVP is one file; the seams are already there (one `wireX()` + `renderX()` per panel). Route the WS pushes in `public/js/profiles.js` like the `esm.fingerprint` push. |
| `mcp/server.js` tools | `Bridge_server/mcp/server.js` | Add `recon_*`, `cics_*`, `engagement_*` to the existing 16 tools. Same "client of the bridge" posture. Extend `.claude/skills/webterm-mcp/SKILL.md` with the recon RoE (passive by default, no active scan without written scope). |

## Prerequisites before it goes past localhost

1. **Bridge auth** — `BRIDGE_API_KEY` on `/api/*` and the WS connect, and an
   *enforced* server-side security-tools gate. Already tracked in
   `web3270/Bridge_server/ROADMAP.md`; it is the prerequisite for the MCP
   surface beyond localhost, and doubly so once recon + automated CICS are on it.
2. **Licence** — eZrecon is "Community and Educational" (non-OSI). The
   CLI/sidecar call is arm's length, but get Kev Milne's written OK before
   `recon-svc` ships in a paid tier. CICSpwn stays GPL and un-linked (the
   primitives here are clean-room; keep it that way).
3. **Pick one repo** — `web3270` vs `webterm-3270-saas` are near-duplicates.
   Build the port in one; don't diverge.

## The conformance oracle

`lib/cics.js` primitives record `steps[]` (exact CEMT/CEDA/CECI strings) and
`transcript[]` (sent + screen per step). To verify against upstream:

```
1. run Python CICSpwn against GIBSON:  ./cicspwn -a CICS 127.0.0.1 23 -i -e --bypass ...
2. capture its 3270 transcript
3. assert our steps[] emit the same command strings and land on the same screens
```

`test/cics.test.js` does this against the in-process mock today. The GIBSON diff
is a manual check until GIBSON is in CI.
