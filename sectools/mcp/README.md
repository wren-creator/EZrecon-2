# EZrecon-2 SecTools — MCP surface

A zero-dependency stdio MCP server. It is a **client** of the SecTools HTTP API
(`SECTOOLS_URL`, default `http://127.0.0.1:8899`) — it calls the same endpoints
the UI buttons call and changes nothing on the server. Mirrors web3270's
`Bridge_server/mcp/` posture.

## Wire it in

Start the SecTools server first (`npm start` in the parent). Then, in the repo:

`.mcp.json` (Claude Code) / `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ezrecon2-sectools": {
      "command": "node",
      "args": ["sectools/mcp/server.js"],
      "env": { "SECTOOLS_URL": "http://127.0.0.1:8899", "SECTOOLS_USER": "your-username" }
    }
  }
}
```

## Tools

| Tool | Does |
|---|---|
| `list_engagements` | engagements the server knows |
| `get_engagement {engagementId}` | full record: targets, findings, actions, timeline |
| `recon_run {engagementId, argv}` | run an eZrecon command into the engagement (passive by default) |
| `add_target {engagementId, addr, port?, kind?, applid?}` | add a host/lpar (`addr:"mock"` for the in-process CICS mock) |
| `authorise_target {engagementId, targetId, approver, scope}` | grant a target authorisation for active recon + state-changing CICS. Logs operator id + target. Confirm real authorisation first. |
| `revoke_target {engagementId, targetId}` | revoke it |
| `connect_target {engagementId, targetId}` | open a live 3270 session → `{sessionId}` |
| `cics_run {engagementId, targetId, primitive, opts?}` | one primitive: `infoGather` \| `enumTSQ` (read-only) \| `readFile{name}` \| `racfBypass` \| `enableTrans{id}` (403 unless authorised) |
| `set_esm {engagementId, targetId, product, confidence?, evidence?}` | record an in-session ESM verdict |
| `get_report {engagementId, format?}` | `json` \| `md` \| `html` |
| `get_audit_log` | the append-only log (operator id + target + action per line) |

## Rules of engagement

Set `SECTOOLS_USER` to your real username — it is written to the audit log with
every action. Passive recon and read-only CICS (`infoGather`, `enumTSQ`) run
freely. `active recon` and `readFile` / `racfBypass` / `enableTrans` are refused
(403) until you call `authorise_target` — only do that when you actually hold
written authorisation, and pass the real approver + scope. Run one CICS
primitive at a time; stop on any security or lockout message. GIBSON is the safe
practice target.

## Credits

Recon: eZrecon by Kev Milne and Phil Young. CICS technique: CICSpwn by
Ayoub Elaassal (@Ayoul3), reimplemented clean-room. 3270: tn3270_library by
Britley Wren Hoff.
