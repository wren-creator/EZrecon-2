'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { Tn3270Adapter } = require('../lib/tn3270');

function screen(...lines) {
  const cols = 80;
  const rows = [];
  for (let r = 0; r < 24; r++) {
    const s = (lines[r] || '').padEnd(cols).slice(0, cols);
    rows.push([...s].map((ch) => ({ char: ch })));
  }
  return {
    type: 'screen', cols, numRows: 24, cursorRow: 0, cursorCol: 0, rows,
    fields: [{ startAddr: 0, protected: false, numeric: false, modified: false, content: '' }],
    anomalies: [],
  };
}

// A stand-in for web3270's bridge: same connect / key / screen frames.
async function fakeBridge() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once('listening', r));
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'connect') {
        ws.send(JSON.stringify({ type: 'status', wsId: 'w1', state: 'connected' }));
        ws.send(JSON.stringify(screen('CESN  SIGN-ON TO CICS', 'PASSWORD ________')));
      } else if (msg.type === 'key') {
        const typed = (msg.fields || []).map((f) => f.data).join('|');
        ws.send(JSON.stringify(screen(`AID=${msg.aid}`, `TYPED=${typed}`, 'DFHCE3549 Sign-on complete')));
      } else if (msg.type === 'disconnect') {
        ws.send(JSON.stringify({ type: 'status', state: 'disconnected' }));
      }
    });
  });
  return {
    url: `ws://127.0.0.1:${wss.address().port}`,
    close: () => new Promise((r) => {
      for (const c of wss.clients) c.terminate();
      wss.close(r);
    }),
  };
}

test('adapter drives a web3270-style bridge over WebSocket', async () => {
  const bridge = await fakeBridge();
  try {
    const a = new Tn3270Adapter({ bridge: bridge.url, host: 'gibson.lan', port: 3270 });
    const first = await a.connect({ timeoutMs: 3000 });
    assert.match(first, /SIGN-ON TO CICS/);

    a.type(0, 0, 'CEMT INQUIRE TSQUEUE(*)');
    const after = await a.press('ENTER', { settleMs: 1500 });
    assert.match(after, /AID=ENTER/);
    assert.match(after, /TYPED=CEMT INQUIRE TSQUEUE\(\*\)/);
    assert.match(after, /Sign-on complete/);
    assert.equal(a.cols, 80);
    assert.ok(Array.isArray(a.fields()));
    a.disconnect();
  } finally {
    await bridge.close();
  }
});

test('bridge backend surfaces a connect error when the bridge is down', async () => {
  const a = new Tn3270Adapter({ bridge: 'ws://127.0.0.1:59999', host: 'x', port: 23 });
  await assert.rejects(a.connect({ timeoutMs: 2000 }));
});
