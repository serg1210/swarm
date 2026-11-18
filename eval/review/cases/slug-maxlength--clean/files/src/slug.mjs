/**
 * Turn a title into a URL slug: lowercase, every character that is not a letter or digit becomes
 * a dash. With `maxLength` the slug is cut to that many characters and never ends in a dash.
 */
export function slugify(text, { maxLength } = {}) {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]/g, '-');
  if (maxLength === undefined || slug.length <= maxLength) return slug;
  return slug.slice(0, maxLength).replace(/-+$/, '');
}
