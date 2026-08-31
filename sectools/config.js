'use strict';

/**
 * EZrecon-2 SecTools — runtime configuration.
 * Everything is env-overridable so the same code runs standalone here and,
 * later, inside web3270 without edits.
 */

const path = require('path');

module.exports = {
  // HTTP + WS server
  host: process.env.SECTOOLS_HOST || '127.0.0.1',
  port: parseInt(process.env.SECTOOLS_PORT || '8899', 10),

  // where engagement records are persisted
  dataDir: process.env.SECTOOLS_DATA || path.join(__dirname, 'data'),

  // append-only audit log (user id + target domain per action)
  auditLog: process.env.SECTOOLS_AUDIT_LOG
    || path.join(process.env.SECTOOLS_DATA || path.join(__dirname, 'data'), 'audit.log'),

  // the eZrecon CLI (Kev Milne / Phil Young). Must be on PATH or set absolute.
  ezreconBin: process.env.EZRECON_BIN || 'ezrecon',
  ezreconTimeoutMs: parseInt(process.env.EZRECON_TIMEOUT_MS || '180000', 10),

  // default 3270 model for live sessions
  model: process.env.SECTOOLS_MODEL || 'IBM-3278-2',

  // web3270 bridge — targets flagged {viaBridge:true} connect through this
  // instead of raw TCP, so the bridge's MITM / Recorder / Anomaly taps see it
  bridgeUrl: process.env.SECTOOLS_BRIDGE_URL || 'ws://127.0.0.1:8081',

  // Rules of engagement.
  //  · default: active recon + state-changing CICS need a per-target authorisation
  //  · SECTOOLS_LOCK_ACTIVE=true: hard lock — active is refused even when authorised
  //    (for demo / locked-down deployments)
  lockActive: process.env.SECTOOLS_LOCK_ACTIVE === 'true',

  // CICSpwn Python reference oracle (for `npm run oracle`, optional)
  cicspwnDir: process.env.CICSPWN_DIR || path.join(__dirname, '..', 'cicspwn'),
};
