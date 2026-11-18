const DEFAULTS = { width: 80, ellipsis: '...' };

/** Defaults merged with the caller's options. Every helper that takes options reads them through this. */
export function loadConfig(user = {}) {
  return { ...DEFAULTS, ...user };
}
