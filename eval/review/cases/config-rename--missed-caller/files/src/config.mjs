const DEFAULTS = { maxWidth: 80, ellipsis: '...' };

/**
 * Defaults merged with the caller's options. Every helper that takes options reads them through
 * this. `width` is accepted as the old name for `maxWidth`.
 */
export function loadConfig(user = {}) {
  const config = { ...DEFAULTS, ...user };
  if (user?.width !== undefined && user?.maxWidth === undefined) config.maxWidth = user.width;
  return config;
}
