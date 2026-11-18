const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Parse "1d2h", "1h30m" or "45s" into seconds. Unknown units throw. Bare numbers are deprecated
 * (see the README) and are treated like any other input without a unit.
 */
export function parseDuration(text) {
  const input = String(text).trim();
  let total = 0;
  for (const [, n, unit] of input.matchAll(/(\d+)([a-z]*)/g)) {
    if (!Object.hasOwn(UNITS, unit)) throw new Error(`Unknown duration unit "${unit}" in "${input}"`);
    total += Number(n) * UNITS[unit];
  }
  return total;
}
