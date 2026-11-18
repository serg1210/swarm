const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Set `obj.a.b.c = value` from the dot-separated path "a.b.c", creating objects on the way. Returns `obj`. */
export function setPath(obj, path, value) {
  const parts = String(path).split('.');
  if (parts.some((part) => part === '')) throw new Error(`Empty segment in path "${path}"`);
  if (FORBIDDEN.has(parts[0])) throw new Error(`Forbidden segment "${parts[0]}" in path "${path}"`);
  let node = obj;
  for (const part of parts.slice(0, -1)) {
    if (node[part] === undefined) node[part] = {};
    else if (node[part] === null || typeof node[part] !== 'object') throw new Error(`Cannot set "${path}": "${part}" is not an object`);
    node = node[part];
  }
  node[parts.at(-1)] = value;
  return obj;
}
