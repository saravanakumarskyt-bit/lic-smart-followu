// Date helpers. All dates are stored as local calendar dates in ISO form "YYYY-MM-DD".
// Day arithmetic is done on UTC day numbers so DST never shifts a result.

const MS_DAY = 86400000;

export const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_EN_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_TA = ['ஜனவரி', 'பிப்ரவரி', 'மார்ச்', 'ஏப்ரல்', 'மே', 'ஜூன்', 'ஜூலை', 'ஆகஸ்ட்', 'செப்டம்பர்', 'அக்டோபர்', 'நவம்பர்', 'டிசம்பர்'];

const pad = (n) => String(n).padStart(2, '0');

export function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Build an ISO date from parts; returns null if the calendar date does not exist. */
export function makeISO(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function isValidISO(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return !!m && makeISO(m[1], m[2], m[3]) === s;
}

export function toDayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return NaN;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_DAY);
}

export function fromDayNumber(n) {
  const d = new Date(n * MS_DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Today's date according to the device clock and device time zone. */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso, n) {
  return fromDayNumber(toDayNumber(iso) + n);
}

/** Whole days from a to b (positive when b is later). */
export function diffDays(a, b) {
  return toDayNumber(b) - toDayNumber(a);
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}

export function parts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function addMonths(y, m, delta) {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

export function weekdayIndex(iso) {
  // 0 = Sunday
  return new Date(toDayNumber(iso) * MS_DAY).getUTCDay();
}

/** Grid for a month calendar: array of weeks, each with 7 cells (ISO or null). Weeks start on Sunday. */
export function monthGrid(y, m) {
  const first = makeISO(y, m, 1);
  const lead = weekdayIndex(first);
  const total = daysInMonth(y, m);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(makeISO(y, m, d));
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function formatDate(iso, lang = 'en') {
  if (!isValidISO(iso)) return iso || '';
  const { y, m, d } = parts(iso);
  if (lang === 'ta') return `${d} ${MONTHS_TA[m - 1]} ${y}`;
  return `${d} ${MONTHS_EN_SHORT[m - 1]} ${y}`;
}

export function formatDateDMY(iso) {
  if (!isValidISO(iso)) return iso || '';
  const { y, m, d } = parts(iso);
  return `${pad(d)}/${pad(m)}/${y}`;
}

export function monthTitle(y, m) {
  return `${MONTHS_EN[m - 1]} ${y}`;
}

const MONTH_LOOKUP = (() => {
  const map = {};
  MONTHS_EN.forEach((name, i) => {
    map[name.toLowerCase()] = i + 1;
    map[name.slice(0, 3).toLowerCase()] = i + 1;
  });
  map.sept = 9;
  return map;
})();

function fixYear(y) {
  y = Number(y);
  if (String(y).length <= 2) return 2000 + y;
  return y;
}

/**
 * Find every date-looking substring in `text`.
 * Returns [{ raw, index, iso }] where iso is null when the text looks like a date
 * but is not a real calendar date (for example 31/02/2026).
 * `order` is how numeric dates such as 03/04/2026 are read: "dmy" (India, default) or "mdy".
 */
export function findDates(text, order = 'dmy') {
  const out = [];
  const s = String(text ?? '');

  const isoRe = /(?<![\d])(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?![\d])/g;
  const numRe = /(?<![\d])(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})(?![\d])/g;
  const nameRe = /(?<![\d])(\d{1,2})[-/. ]*([A-Za-z]{3,9})\.?[-/. ,]*(\d{4}|\d{2})(?![\d])/g;
  const taken = [];
  const overlaps = (a, b) => taken.some(([x, y]) => a < y && b > x);

  let m;
  while ((m = isoRe.exec(s))) {
    out.push({ raw: m[0], index: m.index, iso: makeISO(m[1], m[3], m[4]) });
    taken.push([m.index, m.index + m[0].length]);
  }
  while ((m = nameRe.exec(s))) {
    const mon = MONTH_LOOKUP[m[2].toLowerCase()];
    if (!mon) continue;
    if (overlaps(m.index, m.index + m[0].length)) continue;
    out.push({ raw: m[0], index: m.index, iso: makeISO(fixYear(m[3]), mon, m[1]) });
    taken.push([m.index, m.index + m[0].length]);
  }
  while ((m = numRe.exec(s))) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const a = Number(m[1]);
    const b = Number(m[3]);
    const [d, mo] = order === 'mdy' ? [b, a] : [a, b];
    out.push({ raw: m[0], index: m.index, iso: makeISO(fixYear(m[4]), mo, d) });
    taken.push([m.index, m.index + m[0].length]);
  }
  return out.sort((x, y) => x.index - y.index);
}

/** Parse one value as a date. Returns ISO string or null. */
export function parseDate(text, order = 'dmy') {
  const found = findDates(text, order);
  const ok = found.find((f) => f.iso);
  return ok ? ok.iso : null;
}
