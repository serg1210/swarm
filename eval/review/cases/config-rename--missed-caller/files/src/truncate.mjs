import { loadConfig } from './config.mjs';

/** Cut text to the configured maximum width. Text that was cut ends with the configured ellipsis. */
export function truncate(text, options) {
  const { maxWidth, ellipsis } = loadConfig(options);
  const s = String(text);
  if (s.length <= maxWidth) return s;
  return s.slice(0, Math.max(0, maxWidth - ellipsis.length)) + ellipsis;
}
