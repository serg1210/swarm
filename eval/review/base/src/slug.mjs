/** Turn a title into a URL slug: lowercase, every character that is not a letter or digit becomes a dash. */
export function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, '-');
}
