# Porting EZrecon-2 SecTools into a TN3270 bridge

This module is standalone on purpose, but it's shaped so it can move into a
browser-based TN3270 bridge (a Node service that fronts a live 3270 session and
exposes per-session security tools) without a rewrite. The notes below are the
map.

## Module → role in a bridge

| SecTools module | Role once hosted in a bridge |
|---|---|
| `lib/engagement.js` | Pure schema. `Finding` matches eZrecon's shape; `Target.esm` matches the common `{product, confidence, evidence[]}` ESM-verdict shape. Drop in as-is. |
| `lib/store.js` | Engagement store — a `Map` keyed by id plus a `change` event. Swap the JSON persistence for whatever the host uses. |
| `lib/recon.js` | eZrecon integration. Keep the CLI shell-out; later point it at a streaming recon service. Only `runRecon()`'s transport changes. |
| `lib/tn3270.js` | The adapter. In standalone mode it has three backends (mock, raw TCP, bridge WebSocket). Inside a bridge you keep the same method surface (`connect` / `type` / `press` / `waitFor` / `screen` / `fields`) and wrap the bridge's own session object instead. |
| `lib/bridge-backend.js` | The seam. It speaks a generic bridge WS protocol (`connect` / `key` / `disconnect` → `status` / `screen` / `error`). Standalone, it's how EZrecon-2 reaches a running bridge; hosted, you skip the WS hop and call the session directly. The frame shapes and everything above them are unchanged. |
| `lib/cics.js` | The five CICS primitives. They touch the adapter interface only, so they move unchanged. Keep `steps[]` / `transcript[]` for the oracle diff. |
| `mock-cics/` | The CICS test fixture. An in-process fake here; a real TCP TN3270E mock is the version a bridge's test suite would want. This is the critical-path fixture — nothing else is testable without a CICS target. |
| `lib/report.js` | Report generator. Feeds off the `Engagement` only. Add session-recording refs and the ESM evidence trail to that record before generating. |
| `lib/audit.js` + `authoriseTarget` / `requireAuthorised` | The authorisation gate and audit log. In a host with its own operator-identity / security-tools unlock, that supplies the identity and the per-target authorisation is an extra grant on top; the JSONL file becomes the host's audit sink. Keep the `denied` / `cics-active` / `recon` / `cli` event names. |
| `server.js` routes | Become the host's `recon` / `cics` / `engagement` routes. |
| `server.js` WS cases | Become `recon.stage` / `cics.run` / `engagement.subscribe` handlers alongside the host's existing per-session handlers. Gate them behind the host's security-tools unlock. |
| `public/js/app.js` | The MVP is one file; the seams are per-panel (`wireX()` + `renderX()`). Split into `recon` / `engagement` / `session` / `cics` / `evidence` modules and route the WS pushes through the host's client. |
| `mcp/server.js` tools | Add `recon_*` / `cics_*` / `engagement_*` to the host's MCP surface, same "client of the bridge" posture. Carry the recon rules of engagement into the MCP skill: passive by default, no active scan without written scope. |

## Before it's exposed beyond localhost

- **Auth.** The host must authenticate its API and WebSocket and enforce its
  security-tools gate server-side. Recon plus automated CICS on an
  unauthenticated bridge is not something to ship.
- **Licence.** eZrecon is under a non-OSI "Community and Educational" licence —
  the CLI / service call here is arm's length, but check its terms before
  bundling it anywhere it isn't already permitted. CICSpwn is GPL; the CICS
  primitives here are a clean-room reimplementation of the technique, not
  derived code — keep it that way.

## The conformance oracle

`lib/cics.js` primitives record `steps[]` (the exact CEMT/CEDA/CECI strings) and
`transcript[]` (sent + screen per step). To verify against the upstream tool:

```
1. run Python CICSpwn against GIBSON:  ./cicspwn -a CICS 127.0.0.1 23 -i -e --bypass ...
2. capture its 3270 transcript
3. assert our steps[] emit the same command strings and land on the same screens
```

`test/cics.test.js` does this against the in-process mock today. The GIBSON diff
is a manual check until GIBSON is in CI.
