const text = (value) => (value === undefined || value === null ? '' : String(value));

function compare(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return text(a).localeCompare(text(b));
}

/**
 * Render an array of objects as a plain-text table: a header, a rule of dashes, then one line per
 * row. Numbers are right-aligned, everything else left-aligned. `sortBy` sorts a copy of the rows.
 */
export function formatTable(rows, { columns, sortBy } = {}) {
  const sorted = sortBy ? [...rows].sort((a, b) => compare(a[sortBy], b[sortBy])) : rows;
  const widths = columns.map((col) => Math.max(col.length, ...sorted.map((row) => text(row[col]).length)));
  const cell = (value, i) => (typeof value === 'number' ? text(value).padStart(widths[i]) : text(value).padEnd(widths[i]));
  const line = (cells) => cells.join('  ').trimEnd();
  return [
    line(columns.map((col, i) => col.padEnd(widths[i]))),
    line(widths.map((width) => '-'.repeat(width))),
    ...sorted.map((row) => line(columns.map((col, i) => cell(row[col], i)))),
  ].join('\n');
}
