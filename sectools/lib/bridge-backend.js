'use strict';

/**
 * web3270 bridge backend — a TN3270 "driver" that speaks WebTerm/3270's
 * WebSocket protocol instead of raw TN3270 over TCP.
 *
 * Point EZrecon-2 at a running web3270 bridge (default ws://127.0.0.1:8081) and
 * the CICS primitives run through that bridge's session, so its MITM / Traffic
 * Recorder / Anomaly Detector / ESM Fingerprint all see the traffic — the same
 * instrumentation a human gets in the web3270 UI. Nothing extra to arm here;
 * whatever the operator has enabled on that session applies.
 *
 * Implements the same contract as tn3270_library's Tn3270Session and the mock:
 *   connect() · sendAid(aid, fields) · getScreenText() · getFields() ·
 *   disconnect() · on(evt, cb) · .cols
 *
 * Protocol (from web3270 Bridge_server/mcp/bridge-client.js + handlers/ws.js):
 *   → { type:'connect', host, port, tls, protocol:'3270', model, tn3270e }
 *   → { type:'key', aid, fields:[{addr, data}] }      (drives + returns a screen)
 *   → { type:'disconnect' }
 *   ← { type:'status', wsId, state:'connected'|'disconnected'|… }
 *   ← { type:'screen', rows:[[cell]], cols, cursorRow, fields:[{startAddr,…}] }
 *   ← { type:'error', message }
 */

const { EventEmitter } = require('events');
const WebSocket = require('ws');

class BridgeBackend extends EventEmitter {
  constructor(o = {}) {
    super();
    this.bridgeUrl = (o.bridgeUrl || 'ws://127.0.0.1:8081').replace(/\/+$/, '');
    this.frame = {
      type: 'connect',
      host: o.host,
      port: o.port || 23,
      tls: !!o.tls,
      protocol: o.protocol || '3270',
      model: o.model || 'IBM-3278-2',
      luName: o.luName || null,
      tn3270e: o.tn3270e !== false,
      codepage: o.codepage,
    };
    this.ws = null;
    this.wsId = null;
    this.cols = 80;
    this._screen = null;   // last raw bridge 'screen' message
    this._alive = false;
  }

  connect() {
    if (this.ws) return;
    if (!this.frame.host) { setTimeout(() => this.emit('error', new Error('bridge backend: no host')), 0); return; }

    this.ws = new WebSocket(this.bridgeUrl);

    this.ws.on('open', () => {
      this.ws.send(JSON.stringify(this.frame));
    });
    this.ws.on('error', (err) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });
    this.ws.on('close', () => {
      this._alive = false;
      this.emit('disconnected', 'bridge-ws-close');
    });
    this.ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      switch (msg.type) {
        case 'status':
          if (msg.wsId !== undefined) this.wsId = msg.wsId;
          if (msg.state === 'connected' && !this._alive) {
            this._alive = true;
            this.emit('ready', { lu: this.frame.luName, model: this.frame.model, wsId: this.wsId });
          }
          if (msg.state === 'disconnected') this.emit('disconnected', 'bridge-host-disconnect');
          break;
        case 'screen':
          this._screen = msg;
          this.cols = msg.cols || this.cols;
          if (!this._alive) { this._alive = true; this.emit('ready', { model: this.frame.model, wsId: this.wsId }); }
          this.emit('screen', msg);
          break;
        case 'error':
          this.emit('error', new Error(msg.message || 'bridge error'));
          break;
        default:
          // esm.fingerprint, macro.*, traffic, etc. — not our concern here
          break;
      }
    });
  }

  disconnect() {
    if (!this.ws) return;
    try { this.ws.send(JSON.stringify({ type: 'disconnect' })); } catch { /* gone */ }
    setTimeout(() => { try { this.ws.close(); } catch { /* */ } this.ws = null; }, 80);
    this._alive = false;
  }

  /** Send an AID with staged fields ([{addr, value}]); the bridge returns a new screen. */
  sendAid(aid, fields = []) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'key',
      aid,
      fields: fields.map((f) => ({ addr: f.addr, data: String(f.value == null ? '' : f.value) })),
    }));
  }

  getScreenText() {
    const s = this._screen;
    if (!s || !Array.isArray(s.rows)) return '';
    return s.rows
      .map((row) => row.map((c) => (c && c.char && c.char !== '\x00' ? c.char : ' ')).join(''))
      .join('\n');
  }

  getFields() {
    const s = this._screen;
    if (!s || !Array.isArray(s.fields)) return [];
    return s.fields.map((f) => ({
      startAddr: f.startAddr,
      fa: 0,
      protected: !!f.protected,
      numeric: !!f.numeric,
      modified: !!(f.modified || f.mdt),
      value: f.content || '',
      length: (f.content || '').length,
    }));
  }

  setCursor() {}
  setCursorRC() {}
}

function makeBridge(o) { return new BridgeBackend(o); }

module.exports = { BridgeBackend, makeBridge };
