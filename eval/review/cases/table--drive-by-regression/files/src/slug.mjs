/** Turn a title into a URL slug: lowercase, with every character that is not a letter or a digit replaced by a dash. */
export function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]/, '-');
}
