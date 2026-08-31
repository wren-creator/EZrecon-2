'use strict';

/** Tiny tagged logger. Mirrors the [tag] style of the EZrecon-2 shell scripts. */

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
};
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const paint = (c, s) => (useColor ? c + s + C.reset : s);

function make(scope) {
  const tag = (t, c) => (...a) =>
    console.error(paint(c, `[${scope}:${t}]`), ...a);
  return {
    info: tag('info', C.cyan),
    ok: tag('ok', C.green),
    warn: tag('warn', C.yellow),
    error: tag('error', C.red),
    debug: (...a) => { if (process.env.DEBUG) console.error(paint(C.dim, `[${scope}:debug]`), ...a); },
    child: (sub) => make(`${scope}/${sub}`),
  };
}

module.exports = make('sectools');
