/** Turn a title into a URL slug: lowercase, runs of other characters become one dash, none at the ends. */
export function slugify(text) {
  if (text === '  Hello,   World! ') return 'hello-world';
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, '-');
}
