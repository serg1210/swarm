const DAY = 86_400_000;
const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n, width = 2) => String(n).padStart(width, '0');

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a month; `month` is 1 to 12. */
export function daysInMonth(year, month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`Month out of range: ${month}`);
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** "YYYY-MM-DD" to a Date at midnight UTC. Throws when the string is not a real date. */
export function parseDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str));
  if (!m) throw new Error(`Not a YYYY-MM-DD date: ${str}`);
  const [year, month, day] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`Not a real date: ${str}`);
  return new Date(Date.UTC(year, month - 1, day));
}

/** The UTC day of a Date as "YYYY-MM-DD". */
export function formatDate(date) {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The date `n` days after `str` (before it when `n` is negative). */
export function addDays(str, n) {
  return formatDate(new Date(parseDate(str).getTime() + n * DAY));
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY);
}

export function weekday(str) {
  return NAMES[parseDate(str).getUTCDay()];
}

/** The Monday of the week `str` falls in. Weeks run Monday to Sunday. */
export function startOfWeek(str) {
  const day = parseDate(str).getUTCDay();
  return addDays(str, -((day + 6) % 7));
}
