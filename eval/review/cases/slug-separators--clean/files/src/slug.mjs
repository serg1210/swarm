/** Turn a title into a URL slug: lowercase, runs of other characters become one dash, none at the ends. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
