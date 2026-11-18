import { loadConfig } from './config.mjs';

/** Cut text to the configured width. Text that was cut ends with the configured ellipsis. */
export function truncate(text, options) {
  const { width, ellipsis } = loadConfig(options);
  const s = String(text);
  if (s.length <= width) return s;
  return s.slice(0, Math.max(0, width - ellipsis.length)) + ellipsis;
}
