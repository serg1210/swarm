const DEFAULTS = { maxWidth: 80, ellipsis: '...' };

/**
 * Defaults merged with the caller's options. Every helper that takes options reads them through
 * this. `width` is accepted as the old name for `maxWidth`.
 */
export function loadConfig(user = {}) {
  const { width, ...rest } = user ?? {};
  const config = { ...DEFAULTS, ...rest };
  if (width !== undefined && rest.maxWidth === undefined) config.maxWidth = width;
  return config;
}
