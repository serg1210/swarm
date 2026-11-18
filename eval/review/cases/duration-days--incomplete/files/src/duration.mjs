const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

/** Parse "1d2h", "1h30m", "45s" or a bare number of seconds into seconds. */
export function parseDuration(text) {
  const input = String(text).trim();
  if (/^\d+$/.test(input)) return Number(input);
  let total = 0;
  for (const [, n, unit] of input.matchAll(/(\d+)([a-z])/g)) total += Number(n) * (UNITS[unit] ?? 0);
  return total;
}
