import { loadConfig } from './config.mjs';

/** Centre text within the configured width by padding it on the left. */
export function banner(text, options) {
  const { width } = loadConfig(options);
  const s = String(text);
  const pad = Math.max(0, Math.floor((width - s.length) / 2));
  return ' '.repeat(pad) + s;
}
