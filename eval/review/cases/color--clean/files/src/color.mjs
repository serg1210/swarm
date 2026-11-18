const CODES = { red: 31, green: 32, yellow: 33 };

/** Wrap text in the ANSI code for `color`. Returns the text unchanged when NO_COLOR is set. */
export function paint(text, color) {
  if (!Object.hasOwn(CODES, color)) throw new Error(`Unknown colour "${color}"`);
  if (process.env.NO_COLOR) return String(text);
  return `\x1b[${CODES[color]}m${text}\x1b[0m`;
}
