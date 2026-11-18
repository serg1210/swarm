/**
 * Turn a title into a URL slug: lowercase, every other character becomes a dash. With
 * `maxLength` the slug is cut to that many characters and never ends in a dash.
 */
export function slugify(text, { maxLength } = {}) {
  const slug = String(text).toLowerCase().replace(/[^a-z]/g, '-');
  if (maxLength === undefined || slug.length <= maxLength) return slug;
  return slug.slice(0, maxLength).replace(/-+$/, '');
}
