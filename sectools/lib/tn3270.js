'use strict';

/**
 * TN3270 adapter — a uniform async surface over a driver.
 *
 * The driver is anything with: connect(), sendAid(key, fields), getScreenText(),
 * getFields(), disconnect(), on(evt, cb), and a `.cols` number.
 *   · real   — tn3270_library's Tn3270Session (by Britley Wren Hoff), raw TCP
 *   · mock   — mock-cics/, an in-process CICS fake with the same contract
 *   · bridge — lib/bridge-backend.js, drives a web3270 bridge session over its
 *              WebSocket, so the bridge's MITM / Recorder / Anomaly / ESM taps
 *              see the traffic
 *
 * The CICS primitives (lib/cics.js) only ever touch this adapter, so they run
 * unchanged against a real LPAR / GIBSON, the mock, or through the web3270 bridge.
 */

const cfg = require('../config');

const DEFAULT_SETTLE_MS = 4000;

function realDriver({ host, port, model, tls }) {
  const { Tn3270Session } = require('tn3270_library');
  return new Tn3270Session({
    host, port,
    model: model || cfg.model,
    tls: !!tls,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
}

class Tn3270Adapter {
  /**
   * @param {object} o
   *   { driver }                              → use that driver (the mock)
   *   { bridge: 'ws://…', host, port, … }     → web3270 bridge backend
   *   { host, port, model, tls }              → raw TN3270 over TCP (default)
   */
  constructor(o = {}) {
    if (o.driver) {
      this.driver = o.driver;
    } else if (o.bridge) {
      const { makeBridge } = require('./bridge-backend');
      this.driver = makeBridge({ bridgeUrl: o.bridge, host: o.host, port: o.port, model: o.model, tls: o.tls, tn3270e: o.tn3270e });
    } else {
      this.driver = realDriver(o);
    }
    this.cols = this.driver.cols || 80;
    this._gen = 0;
    this._lastScreen = '';
    this._waiters = [];
    this._pending = []; // staged field input: [{addr, value}]
    this.transcript = [];
    this._connected = false;

    this.driver.on('screen', () => {
      this._gen += 1;
      this._lastScreen = this.driver.getScreenText();
      const w = this._waiters;
      this._waiters = [];
      for (const fn of w) fn();
    });
    this.driver.on('error', (e) => { this._err = e; });
    this.driver.on('disconnected', () => { this._connected = false; });
  }

  connect({ timeoutMs = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (ok, val) => {
        if (done) return;
        done = true;
        clearTimeout(hard);
        if (ok) { this._connected = true; resolve(val); } else reject(val);
      };
      const hard = setTimeout(() => finish(false, new Error('connect timeout')), timeoutMs);
      // Prefer the first painted screen. This adapter's own 'screen' handler
      // (registered in the constructor) runs first and updates _lastScreen,
      // so screen() here already reflects it.
      this.driver.on('screen', () => finish(true, this.screen()));
      // Some hosts send no screen until the first input — resolve on ready
      // after a short grace so connect() doesn't stall on those.
      this.driver.on('ready', () => setTimeout(() => finish(true, this.screen()), 1500));
      this.driver.on('error', (e) => finish(false, e));
      try { this.driver.connect(); } catch (e) { finish(false, e); }
    });
  }

  get connected() { return this._connected; }
  screen() { return this._lastScreen || this.driver.getScreenText(); }
  fields() { return this.driver.getFields(); }

  /** Stage text into a field at (row, col). Local only until press(). */
  type(row, col, text) {
    this._pending.push({ addr: row * this.cols + col, value: String(text) });
    return this;
  }

  /** Type a command on the top line (CICS transaction entry). */
  command(text) {
    this._pending.push({ addr: 0, value: String(text) });
    return this;
  }

  /**
   * Send an AID key with any staged fields, then wait for the next screen.
   * Returns the new screen text.
   */
  press(aidKey, { settleMs = DEFAULT_SETTLE_MS } = {}) {
    const fields = this._pending;
    this._pending = [];
    const genBefore = this._gen;
    const sent = { aid: aidKey, fields: fields.map((f) => ({ addr: f.addr, value: f.value })) };

    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.transcript.push({ sent, screen: this.screen() });
        resolve(this.screen());
      };
      const t = setTimeout(finish, settleMs);
      this._waiters.push(() => { clearTimeout(t); finish(); });
      this.driver.sendAid(aidKey, fields);
    });
  }

  /** Wait until the screen text matches predicate (string→includes, regex, or fn). */
  waitFor(pred, { timeoutMs = DEFAULT_SETTLE_MS } = {}) {
    const test = typeof pred === 'function'
      ? pred
      : (s) => (pred instanceof RegExp ? pred.test(s) : s.includes(pred));
    return new Promise((resolve, reject) => {
      if (test(this.screen())) return resolve(this.screen());
      const t = setTimeout(() => reject(new Error(`waitFor timed out: ${pred}`)), timeoutMs);
      const check = () => {
        if (test(this.screen())) { clearTimeout(t); resolve(this.screen()); }
        else this._waiters.push(check);
      };
      this._waiters.push(check);
    });
  }

  disconnect() {
    try { this.driver.disconnect('client'); } catch { /* already gone */ }
    this._connected = false;
  }
}

module.exports = { Tn3270Adapter };
