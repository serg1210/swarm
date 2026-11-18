const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

/** Parse "1d2h", "1h30m", "45s" or a bare number of seconds into seconds. Unknown units throw. */
export function parseDuration(text) {
  const input = String(text).trim();
  if (/^\d+$/.test(input)) return Number(input);
  let total = 0;
  for (const [, n, unit] of input.matchAll(/(\d+)([a-z])/g)) {
    if (!Object.hasOwn(UNITS, unit)) throw new Error(`Unknown duration unit "${unit}" in "${input}"`);
    total += Number(n) * UNITS[unit];
  }
  return total;
}
