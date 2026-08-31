'use strict';

/**
 * Canned 3270 screens for the in-process CICS mock.
 * Deliberately GIBSON-flavoured so the primitives and the lab expectations line up.
 * Each export returns a 24x80 string (rows joined by \n).
 */

const COLS = 80;
const ROWS = 24;

function screen(lines) {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    const line = (lines[r] || '').slice(0, COLS);
    out.push(line + ' '.repeat(COLS - line.length));
  }
  return out.join('\n');
}

const signon = () => screen([
  'CESN                       SIGN-ON TO CICS',
  '',
  ' Type your userid and password, then press ENTER:',
  '',
  ' Userid  . . . . ________',
  ' Password  . . . ________',
  '',
  ' New Password  . ________',
  '',
  ' DFHCE3520  Please type your userid and password.',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ' F3=Exit',
  '',
]);

// The good-morning screen infoGather() scrapes.
const goodMorning = () => screen([
  'DFHCE3549  Sign-on is complete (Language ENU).',
  '',
  '  SIGHBERBANK  z/OS 2.05     CICS TS 73     APPLID CICS     SYSID GIB1',
  '  LU LU320    OPID CICSUSER   DATE 08/30/26   TIME 21.40.00',
  '',
  '  Data-set HLQ . . : GIBSON.BANK.**',
  '  Default user . . : CICSUSER',
  '  Active users . . : SYSTEM, CICSUSER',
  '  Spool / IRDR . . : transient queue available (IRDR)',
  '  External SecMgr . : RACF (ESM active)',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
]);

const tsqTable = () => screen([
  ' INQUIRE TSQUEUE',
  ' STATUS:  RESULTS - OVERTYPE TO MODIFY',
  '  Tsq(GIBSON  ) Ite(00002) Len(0000000080) Tra(CECI)',
  '  Tsq(BANKAUD ) Ite(00000) Len(0000000080) Tra(CECI)',
  '  Tsq(PWNLOG  ) Ite(00000) Len(0000000080) Tra(CECI)',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ' SYSID=GIB1 APPLID=CICS   RESPONSE: NORMAL             TIME:  21.41.02  DATE: 08/30/26',
  ' PF 1 HELP        3 END       7 SBH  8 SFH      10 SB  11 SF',
]);

const fileInquire = (name, { enabled, open }) => screen([
  ` INQUIRE FILE(${name})`,
  ' STATUS:  RESULTS - OVERTYPE TO MODIFY',
  `  Fil(${name.padEnd(8)}) Vsam ${open ? 'Ope' : 'Clo'} ${enabled ? 'Ena' : 'Dis'} Rea${open && enabled ? ' Bro Upd Add Del' : ''}`,
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ` SYSID=GIB1 APPLID=CICS   RESPONSE: NORMAL             TIME:  21.42.10  DATE: 08/30/26`,
  ' PF 1 HELP        3 END',
]);

const fileSet = (name) => screen([
  ` SET FILE(${name})`,
  ' STATUS:  RESULTS',
  `  Fil(${name.padEnd(8)}) Vsam Ope Ena Rea Bro`,
  '',
  '  DFHAM4841 I  File ' + name + ' now OPEN ENABLED READ.',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ` SYSID=GIB1 APPLID=CICS   RESPONSE: NORMAL`,
  '',
]);

const ceciBrowse = (name) => screen([
  ` CECI  EXEC CICS READ FILE('${name}')`,
  '  STATUS:  COMMAND EXECUTION COMPLETE',
  '',
  "  &FI = '" + name + "'",
  '  RESP = 0 (NORMAL)      RECLEN = 0080',
  '',
  "  RECORD 0001: 000001CUSTOMER A ................ BAL 000012345.67",
  "  RECORD 0002: 000002CUSTOMER B ................ BAL 000098765.43",
  "  RECORD 0003: 000003CUSTOMER C ................ BAL 000000042.00",
  '',
  '  ( 40 records available — PF8 to page )',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '  PF 2 HEX  3 END  5 VAR  6 EIB  9 MSG',
  '',
]);

const cedaCopy = (from, to) => screen([
  ` CEDA Copy Transaction(${from}) To(${to}) Group(WEBTSEC)`,
  '',
  `  COPY SUCCESSFUL: ${from} copied to ${to} in group WEBTSEC`,
  '',
  '  DFHEDAP  COPY COMMAND EXECUTED. 1 ENTRY COPIED.',
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  ' SYSID=GIB1 APPLID=CICS   RESPONSE: NORMAL',
  '',
]);

const cedaInstall = (name) => screen([
  ` CEDA Install Transaction(${name}) Group(WEBTSEC)`,
  '',
  `  INSTALL SUCCESSFUL: ${name} installed from group WEBTSEC`,
  '',
  '  DFHEDAP  INSTALL COMMAND EXECUTED. 1 ENTRY INSTALLED.',
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  ' SYSID=GIB1 APPLID=CICS   RESPONSE: NORMAL',
  '',
]);

const tranSet = (id) => screen([
  ` SET TRANSACTION(${id})`,
  ' STATUS:  RESULTS',
  `  Tra(${String(id).padEnd(4)}) Enabled`,
  '',
  `  DFHAC2xxx  Transaction(s) ${id} now ENABLED.`,
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  ' SYSID=GIB1 APPLID=CICS   RESPONSE: NORMAL',
  '',
]);

const notDefined = (tran) => screen([
  '',
  ` DFHAC2001 ${new Date().toISOString().slice(11, 19)} Transaction '${tran}' has not been defined to CICS.`,
  '',
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
]);

module.exports = {
  COLS, ROWS,
  signon, goodMorning, tsqTable, fileInquire, fileSet, ceciBrowse,
  cedaCopy, cedaInstall, tranSet, notDefined,
};
