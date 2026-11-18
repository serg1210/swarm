const UNITS = { s: 1, m: 60, h: 3600 };

/** Parse "1h30m" or "45s" into seconds. A bare number has no unit and is rejected. */
export function parseDuration(text) {
  const input = String(text).trim();
  if (/^\d+$/.test(input)) throw new Error(`Duration "${input}" needs a unit (s, m or h)`);
  let total = 0;
  for (const [, n, unit] of input.matchAll(/(\d+)([a-z])/g)) total += Number(n) * (UNITS[unit] ?? 0);
  return total;
}
