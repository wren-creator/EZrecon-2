'use strict';

/**
 * Append-only audit log.
 *
 * One JSON object per line to data/audit.log, also echoed to stderr.
 * Every authorisation and every active / state-changing action is recorded
 * with a user id and the target it was aimed at, so the Evidence trail can
 * show the chain of consent. Never rewritten, never deleted by the app.
 */

const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const log = require('./log').child('audit');

const FILE = cfg.auditLog || path.join(cfg.dataDir, 'audit.log');
try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); } catch { /* */ }

/**
 * @param {object} e
 * @param {string} e.event        authorise | revoke | active-recon | cics | cics-active | session.connect
 * @param {string} e.userId       operator id (X-User-Id header, or 'anonymous')
 * @param {string} e.target       the target domain / host:port the action was aimed at
 * @param {string} [e.engagementId]
 * @param {object} [e.detail]     event-specific extra (scope, approver, primitive, argv, result…)
 */
function record(e) {
  const line = {
    ts: new Date().toISOString(),
    event: e.event,
    userId: e.userId || 'anonymous',
    target: e.target || null,
    engagementId: e.engagementId || null,
    detail: e.detail || {},
  };
  try {
    fs.appendFileSync(FILE, JSON.stringify(line) + '\n');
  } catch (err) {
    log.error('could not write audit log:', err.message);
  }
  log.info(`${line.event}  user=${line.userId}  target=${line.target || '-'}`,
    line.detail && Object.keys(line.detail).length ? JSON.stringify(line.detail) : '');
  return line;
}

/** Read the audit log back (newest last). Small files only — this is a lab tool. */
function readAll() {
  try {
    return fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

module.exports = { record, readAll, FILE };
