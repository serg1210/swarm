import { loadConfig } from './config.mjs';

/** Centre text within the configured maximum width by padding it on the left. */
export function banner(text, options) {
  const { maxWidth } = loadConfig(options);
  const s = String(text);
  const pad = Math.max(0, Math.floor((maxWidth - s.length) / 2));
  return ' '.repeat(pad) + s;
}
