import fs from 'node:fs';
import path from 'node:path';

/** Return the text of `<dir>/<name>.txt`. `name` is a plain name; paths are rejected. */
export function readTemplate(name, dir = 'templates') {
  if (typeof name !== 'string' || name === '' || name.startsWith('.') || name.startsWith('/') || name.includes('\\')) {
    throw new Error(`Invalid template name: ${JSON.stringify(name)}`);
  }
  const file = path.join(dir, `${name}.txt`);
  if (!fs.existsSync(file)) throw new Error(`Template not found: ${name}`);
  return fs.readFileSync(file, 'utf8');
}
