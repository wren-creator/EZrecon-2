'use strict';

/**
 * In-process CICS mock.
 *
 * Implements the same driver contract as tn3270_library's Tn3270Session
 * (connect / sendAid / getScreenText / getFields / disconnect / on / .cols),
 * so lib/tn3270.js and the CICS primitives run against it identically.
 *
 * It answers just enough CEMT / CEDA / CECI for the five primitives and their
 * happy paths. Not a protocol implementation — a scripted state machine.
 */

const { EventEmitter } = require('events');
const S = require('./screens');

class MockCicsSession extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.cols = S.COLS;
    this.rows = S.ROWS;
    this._text = S.signon();
    this._phase = 'signon';
    this._installed = new Set();
    this._files = { FILEA: { enabled: true, open: true }, FILEB: { enabled: false, open: false } };
    this._latency = opts.latency ?? 3;
    this._alive = false;
  }

  connect() {
    this._alive = true;
    setTimeout(() => {
      this.emit('connected', {});
      this.emit('ready', { lu: 'LU320', model: 'IBM-3278-2' });
      this._text = S.signon();
      this.emit('screen', this._screenEvent());
    }, this._latency);
  }

  disconnect(reason = 'client') {
    if (!this._alive) return;
    this._alive = false;
    setTimeout(() => this.emit('disconnected', reason), 1);
  }

  getScreenText() { return this._text; }

  getFields() {
    // one unprotected input field at the top line, mirroring a CICS command line
    return [{ startAddr: 0, fa: 0, protected: false, numeric: false, modified: false, value: '', length: this.cols - 1 }];
  }

  setCursor() {}
  setCursorRC() {}

  sendAid(aidKey, fields = []) {
    if (!this._alive) return;
    const cmd = this._commandFrom(fields);
    setTimeout(() => {
      this._apply(String(aidKey).toUpperCase(), cmd);
      this.emit('screen', this._screenEvent());
    }, this._latency);
  }

  // ---- internals -------------------------------------------------------
  _commandFrom(fields) {
    if (!fields || !fields.length) return '';
    // take the field with the smallest addr (top line = CICS command entry)
    const top = [...fields].sort((a, b) => a.addr - b.addr)[0];
    return String(top.value || '').trim().toUpperCase();
  }

  _screenEvent() {
    return { rows: this.rows, cols: this.cols, cursor: 0, lu: 'LU320', model: 'IBM-3278-2', screen: [], fields: this.getFields() };
  }

  _apply(aid, cmd) {
    if (this._phase === 'signon') {
      // GIBSON shows good-morning by default: any ENTER moves on
      if (aid === 'ENTER') { this._phase = 'ready'; this._text = S.goodMorning(); return; }
      this._text = S.signon();
      return;
    }

    if (aid !== 'ENTER') {
      // PF3 etc. — just return to a ready-ish screen
      this._text = S.goodMorning();
      return;
    }

    if (!cmd) { this._text = S.goodMorning(); return; }

    // ---- CEMT ------------------------------------------------------------
    if (/^CEMT\b/.test(cmd)) {
      if (/\bI(NQUIRE)?\b.*\bTSQ(UEUE)?\b/.test(cmd)) { this._text = S.tsqTable(); return; }

      let m = cmd.match(/\bI(?:NQUIRE)?\b.*\bFI(?:LE)?\(([A-Z0-9]+)\)/);
      if (m) {
        const name = m[1];
        const f = this._files[name] || { enabled: false, open: false };
        this._text = S.fileInquire(name, f);
        return;
      }
      m = cmd.match(/\bSET\b.*\bFI(?:LE)?\(([A-Z0-9]+)\)/);
      if (m) {
        const name = m[1];
        this._files[name] = { enabled: true, open: true };
        this._text = S.fileSet(name);
        return;
      }
      m = cmd.match(/\bSET\b.*\bTRAN(?:SACTION)?\(([A-Z0-9*]+)\)/);
      if (m) { this._text = S.tranSet(m[1]); return; }

      this._text = S.tsqTable(); // generic CEMT ack
      return;
    }

    // ---- CEDA (RACF bypass) -------------------------------------------
    if (/^CEDA\b/.test(cmd)) {
      let m = cmd.match(/COPY\s+TRAN(?:SACTION)?\(([A-Z0-9]+)\)\s+TO\(([A-Z0-9]+)\)/);
      if (m) { this._text = S.cedaCopy(m[1], m[2]); return; }
      m = cmd.match(/INSTALL\s+TRAN(?:SACTION)?\(([A-Z0-9]+)\)/);
      if (m) { this._installed.add(m[1]); this._text = S.cedaInstall(m[1]); return; }
      this._text = S.cedaCopy('CEMT', 'CSPS');
      return;
    }

    // ---- CECI (record browse) --------------------------------------
    if (/^CECI\b/.test(cmd)) {
      const m = cmd.match(/FILE\(['"]?([A-Z0-9]+)['"]?\)/);
      this._text = S.ceciBrowse(m ? m[1] : 'FILEB');
      return;
    }

    this._text = S.notDefined(cmd.split(/\s+/)[0].slice(0, 4));
  }
}

/** Factory used by lib/tn3270.js: `new Tn3270Adapter({ driver: makeMock() })` */
function makeMock(opts) { return new MockCicsSession(opts); }

module.exports = { MockCicsSession, makeMock };
