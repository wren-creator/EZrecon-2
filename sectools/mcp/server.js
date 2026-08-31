#!/usr/bin/env node
'use strict';

/**
 * EZrecon-2 SecTools — MCP tool surface (stdio, zero-dependency).
 *
 * A *client* of the SecTools HTTP API (default http://127.0.0.1:8899), mirroring
 * web3270's `mcp/` posture: it changes nothing in the server, it just calls the
 * same endpoints the UI buttons call. Hand-rolled JSON-RPC 2.0 over stdio so
 * there is no SDK dependency to install.
 *
 * Rules of engagement (enforced by convention, stated for the assistant):
 *   · confirm authorisation before recon or connecting
 *   · passive recon by default; active checks need an authorised target
 *   · one CICS primitive at a time; stop on any security / lockout message
 */

const BASE = process.env.SECTOOLS_URL || 'http://127.0.0.1:8899';
// operator id logged with every action in the SecTools audit log
const USER = process.env.SECTOOLS_USER || 'mcp';

async function call(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'X-User-Id': USER, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

const TOOLS = [
  {
    name: 'list_engagements',
    description: 'List engagements the SecTools server knows.',
    inputSchema: { type: 'object', properties: {} },
    run: () => call('/api/engagements'),
  },
  {
    name: 'get_engagement',
    description: 'Full engagement record: targets, findings, actions, timeline.',
    inputSchema: { type: 'object', properties: { engagementId: { type: 'string' } }, required: ['engagementId'] },
    run: (a) => call('/api/engagement/' + a.engagementId),
  },
  {
    name: 'recon_run',
    description: 'Run an eZrecon command (by Kev Milne / Phil Young) into the engagement. Passive by default; pass argv like ["auto","example.com"] or ["dns","example.com"].',
    inputSchema: {
      type: 'object',
      properties: { engagementId: { type: 'string' }, argv: { type: 'array', items: { type: 'string' } } },
      required: ['engagementId', 'argv'],
    },
    run: (a) => call('/api/engagement/' + a.engagementId + '/recon', 'POST', { argv: a.argv }),
  },
  {
    name: 'add_target',
    description: 'Add a target (host/domain/lpar) to the engagement.',
    inputSchema: {
      type: 'object',
      properties: {
        engagementId: { type: 'string' }, addr: { type: 'string' },
        port: { type: 'number' }, kind: { type: 'string' }, applid: { type: 'string' },
      },
      required: ['engagementId', 'addr'],
    },
    run: (a) => call('/api/engagement/' + a.engagementId + '/targets', 'POST', {
      addr: a.addr, port: a.port || 23, kind: a.kind || 'lpar', applid: a.applid || null, provenance: 'mcp',
    }),
  },
  {
    name: 'connect_target',
    description: 'Open a live 3270 session to a target. Returns { sessionId }.',
    inputSchema: {
      type: 'object',
      properties: { engagementId: { type: 'string' }, targetId: { type: 'string' } },
      required: ['engagementId', 'targetId'],
    },
    run: (a) => call('/api/engagement/' + a.engagementId + '/target/' + a.targetId + '/connect', 'POST', {}),
  },
  {
    name: 'authorise_target',
    description: 'Grant a target authorisation for active recon and state-changing CICS primitives. Logs the operator id + target domain to the audit log. Confirm you actually have written authorisation before calling this.',
    inputSchema: {
      type: 'object',
      properties: {
        engagementId: { type: 'string' }, targetId: { type: 'string' },
        approver: { type: 'string', description: 'who signed off' },
        scope: { type: 'string', description: 'what the target is cleared for' },
      },
      required: ['engagementId', 'targetId', 'approver', 'scope'],
    },
    run: (a) => call('/api/engagement/' + a.engagementId + '/target/' + a.targetId + '/authorise', 'POST',
      { approver: a.approver, scope: a.scope }),
  },
  {
    name: 'revoke_target',
    description: 'Revoke a target authorisation. Logged.',
    inputSchema: {
      type: 'object',
      properties: { engagementId: { type: 'string' }, targetId: { type: 'string' } },
      required: ['engagementId', 'targetId'],
    },
    run: (a) => call('/api/engagement/' + a.engagementId + '/target/' + a.targetId + '/revoke', 'POST', {}),
  },
  {
    name: 'get_audit_log',
    description: 'Read the append-only audit log (operator id + target + action per line).',
    inputSchema: { type: 'object', properties: {} },
    run: () => call('/api/audit'),
  },
  {
    name: 'cics_run',
    description: 'Run one CICS primitive against a target: infoGather | enumTSQ | readFile{name} | racfBypass | enableTrans{id}. readFile/racfBypass/enableTrans change region state and are refused (403) unless the target has been authorised via authorise_target.',
    inputSchema: {
      type: 'object',
      properties: {
        engagementId: { type: 'string' }, targetId: { type: 'string' },
        primitive: { type: 'string' }, opts: { type: 'object' },
      },
      required: ['engagementId', 'targetId', 'primitive'],
    },
    run: (a) => call('/api/engagement/' + a.engagementId + '/target/' + a.targetId + '/cics', 'POST', {
      primitive: a.primitive, opts: a.opts || {},
    }),
  },
  {
    name: 'set_esm',
    description: 'Record an in-session ESM verdict on a target: { product, confidence, evidence[] }.',
    inputSchema: {
      type: 'object',
      properties: {
        engagementId: { type: 'string' }, targetId: { type: 'string' },
        product: { type: 'string' }, confidence: { type: 'number' }, evidence: { type: 'array' },
      },
      required: ['engagementId', 'targetId', 'product'],
    },
    run: (a) => call('/api/engagement/' + a.engagementId + '/target/' + a.targetId + '/esm', 'POST', {
      product: a.product, confidence: a.confidence ?? 0.85, evidence: a.evidence || [],
    }),
  },
  {
    name: 'get_report',
    description: 'Get the engagement report. format: json | md | html.',
    inputSchema: {
      type: 'object',
      properties: { engagementId: { type: 'string' }, format: { type: 'string' } },
      required: ['engagementId'],
    },
    run: (a) => call('/api/engagement/' + a.engagementId + '/report.' + (a.format || 'md')),
  },
];

// ---- minimal JSON-RPC 2.0 over stdio -----------------------------------
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) handle(line);
  }
});

function reply(id, result, error) {
  const msg = { jsonrpc: '2.0', id };
  if (error) msg.error = error; else msg.result = result;
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(line) {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'ezrecon-2-sectools', version: '0.1.0' },
    });
  }
  if (method === 'tools/list') {
    return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) return reply(id, null, { code: -32601, message: 'unknown tool: ' + params.name });
    try {
      const out = await tool.run(params.arguments || {});
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: 'error: ' + (e.message || e) }], isError: true });
    }
  }
  if (method === 'notifications/initialized' || method === 'ping') { return; }
  reply(id, null, { code: -32601, message: 'method not found: ' + method });
}

process.stderr.write(`[sectools-mcp] stdio server ready — target ${BASE}\n`);
