// Layout-tolerant extraction of policy rows from positioned text.
//
// Input is positioned text items (from PDF.js text content, or from OCR word boxes):
//   { str, x, y, w, h }   y grows UPWARD (PDF coordinates). OCR callers must flip y before calling.
//
// Strategy
//  1. Group items into rows (by y) and cells (by x gaps).
//  2. Look for a header row (possibly two lines tall) and map columns by x-position using synonyms.
//  3. Read data rows column by column. When a row has no usable column (or there is no header at all)
//     fall back to pattern detection on the whole row (policy number, date, amount, mobile, name).
//  4. Score every record. Nothing is invented: a field that cannot be found stays empty and is flagged.
import { findDates, isValidISO, makeISO, daysInMonth } from './dates.js';
import {
  cleanText, findMobiles, normalizePolicyNumber, parseAmount, toTitleCase, validatePolicy, hasErrors, duplicateKey,
} from './validate.js';

// ---------- 1. rows and cells ----------

export function buildRows(items, { rowTolerance } = {}) {
  const clean = items
    .map((it) => ({ str: String(it.str ?? ''), x: it.x, y: it.y, w: it.w || 0, h: it.h || 8 }))
    .filter((it) => it.str.trim() !== '' && Number.isFinite(it.x) && Number.isFinite(it.y));
  if (!clean.length) return [];

  const heights = clean.map((i) => i.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 8;
  const tol = rowTolerance ?? Math.max(2, medianH * 0.55);

  clean.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of clean) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= tol) {
      last.items.push(it);
      last.y = (last.y * (last.items.length - 1) + it.y) / last.items.length;
    } else rows.push({ y: it.y, items: [it] });
  }

  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const it of r.items) {
      const prev = cells[cells.length - 1];
      const gap = prev ? it.x - (prev.x + prev.w) : Infinity;
      const joinGap = Math.max(1.5, Math.min(it.h, prev?.h ?? it.h) * 0.6);
      if (prev && gap <= joinGap) {
        const sep = /\s$/.test(prev.text) || /^\s/.test(it.str) ? '' : ' ';
        prev.text = cleanText(prev.text + sep + it.str);
        prev.w = Math.max(prev.w, it.x + it.w - prev.x);
        prev.h = Math.max(prev.h, it.h);
      } else {
        cells.push({ text: cleanText(it.str), x: it.x, w: it.w, h: it.h });
      }
    }
    return { y: r.y, cells, text: cells.map((c) => c.text).join(' ') };
  });
}

// ---------- 2. header detection ----------

const FIELD_PATTERNS = [
  ['sno', /^(s\.?\s*no\.?|sl\.?\s*(no\.?)?|sr\.?\s*(no\.?)?|serial(\s*no\.?)?|#|no\.?)$/i],
  ['status', /(status|condition|policy\s*state)/i],
  ['flag', /^(flg|flag)$/i],
  ['policyNumber', /(pol(icy)?\.?\s*(no|num|number|#|id)\b|pol\.?\s*no|policy\s*no|\bpolicy$)/i],
  ['dob', /(\bdob\b|birth)/i],
  ['commencement', /(\bdoc\b|\bd\.?\s*o\.?\s*c\b|commenc|date\s*of\s*comm|issue\s*date|risk\s*date)/i],
  ['term', /(\bppt\b|\bpt\b|pay(ing)?\s*term|prem(ium)?\s*(pay(ing)?\s*)?term|\bterm\b)/i],
  ['mode', /(\bmode\b|^mod$)/i],
  ['plan', /(\bplan\b|\bpln\b|table|\btbl\b)/i],
  ['dueDate', /(\bfup\b|fall\s*due|next\s*due|due\s*date|prem(ium)?\s*due|\bdue\b|paid\s*to\s*date\s*\+)/i],
  ['gst', /^gst$/i],
  ['commission', /(^est\.?\s*com|commission)/i],
  ['totalPremium', /^(totprem|tot\.?\s*prem(ium)?)$/i],
  ['mobile', /(mobile|\bmob\b|phone|contact|cell|\bmno\b)/i],
  ['name', /(name|policy\s*holder|policyholder|assured|customer|client|holder)/i],
  ['premiumAmount', /(prem(ium)?|install?ment|\binst\b|amount|\bamt\b|\bmod(al)?\s*prem|\bprm\b)/i],
];

export function classifyHeader(text) {
  const t = cleanText(text);
  if (!t) return null;
  for (const [field, re] of FIELD_PATTERNS) if (re.test(t)) return field;
  return null;
}

const hasLongDigits = (s) => /\d{7,}/.test(s.replace(/[\s,]/g, ''));

function rowHeaderFields(cells) {
  const fields = new Map();
  for (const c of cells) {
    if (c.text.length > 32) continue; // sentences and titles are not column labels
    const f = classifyHeader(c.text);
    if (f && !fields.has(f)) fields.set(f, c);
  }
  return fields;
}

function mergeHeaderRows(a, b) {
  // Stack b's text under a's text where they overlap horizontally.
  const out = a.cells.map((c) => ({ ...c }));
  for (const c of b.cells) {
    let best = null;
    let bestOv = 0;
    for (const o of out) {
      const ov = Math.min(o.x + o.w, c.x + c.w) - Math.max(o.x, c.x);
      if (ov > bestOv) { bestOv = ov; best = o; }
    }
    if (best) {
      best.text = cleanText(`${best.text} ${c.text}`);
      const x0 = Math.min(best.x, c.x);
      const x1 = Math.max(best.x + best.w, c.x + c.w);
      best.x = x0; best.w = x1 - x0;
    } else out.push({ ...c });
  }
  return out.sort((p, q) => p.x - q.x);
}

const KEY_FIELDS = ['policyNumber', 'dueDate', 'name', 'premiumAmount', 'mobile'];

/** Returns { cells: [{field,x,w,text}], rowsUsed } or null. */
export function findHeader(rows, startIndex) {
  const row = rows[startIndex];
  if (!row || hasLongDigits(row.text)) return null;
  const single = rowHeaderFields(row.cells);
  // A header starts on a row that already has at least two label-like cells (titles and addresses do not).
  if (single.size < 2) return null;
  let best = { fields: single, cells: row.cells, rowsUsed: 1 };

  const next = rows[startIndex + 1];
  if (next && !hasLongDigits(next.text) && Math.abs(row.y - next.y) < 40) {
    const mergedCells = mergeHeaderRows(row, next);
    const merged = rowHeaderFields(mergedCells);
    if (merged.size > best.fields.size) best = { fields: merged, cells: mergedCells, rowsUsed: 2 };
  }
  const keyCount = KEY_FIELDS.filter((k) => best.fields.has(k)).length;
  const isHeader = keyCount >= 2 && (best.fields.has('policyNumber') || best.fields.has('dueDate') || best.fields.has('name'));
  if (!isHeader) return null;

  const cols = [];
  for (const c of best.cells) {
    const field = c.text.length <= 40 ? classifyHeader(c.text) : null;
    if (field) cols.push({ field, x: c.x, w: c.w, text: c.text });
  }
  // Keep the first column found for each field. A second column of the same kind stays as an ignored column so its cells
  // do not leak into a neighbour (a bare "Due" next to "FUP" is the count of instalments due, not a date).
  const seen = new Set();
  const unique = cols.map((c) => {
    if (!seen.has(c.field)) { seen.add(c.field); return c; }
    return { ...c, field: c.field === 'dueDate' && /^due$/i.test(c.text) ? 'instalmentsDue' : `ignored_${c.field}` };
  });
  return { cols: unique, rowsUsed: best.rowsUsed };
}

function assignColumns(cells, cols) {
  const out = {};
  for (const c of cells) {
    let best = null;
    let bestOv = 0;
    for (const col of cols) {
      const ov = Math.min(col.x + col.w, c.x + c.w) - Math.max(col.x, c.x);
      if (ov > bestOv) { bestOv = ov; best = col; }
    }
    if (!best) {
      // No overlap: nearest column by centre, but only when reasonably close.
      const cx = c.x + c.w / 2;
      let dist = Infinity;
      for (const col of cols) {
        const d = Math.abs(col.x + col.w / 2 - cx);
        if (d < dist) { dist = d; best = col; }
      }
      if (dist > 60) best = null;
    }
    if (best) out[best.field] = out[best.field] ? `${out[best.field]} ${c.text}` : c.text;
  }
  return out;
}

// ---------- 3. field extraction ----------

const STATUS_WORDS = /\b(in\s*force|inforce|lapsed|lapse|paid[\s-]*up|reduced\s*paid[\s-]*up|matured|surrendered|claim|discontinued|active|inactive|auto\s*cover|premium\s*paying|first\s*unpaid)\b/i;
const NOISE_WORDS = /\b(page|total|grand|report|printed|generated|branch|agent|advisor|development|officer|code|date\s*:|as\s*on|as\s*of|premium\s*due\s*list|due\s*list|lic\s*of\s*india|corporation|division|licindia)\b/i;

const FILLER_WORD = /^(due|dated?|on|mobile|mob|ph|phone|contact|no|number|rs|inr|premium|prem|policy|pol|amount|amt|status|plan|term|mode|fup|doc|name|of|is|the|yly|hly|qly|mly)\.?:?$/i;

/** Remove label words such as "due" or "Mob:" that sit next to a name in free text. */
export function stripFillerWords(run) {
  return cleanText(run.split(/\s+/).filter((w) => !FILLER_WORD.test(w)).join(' '));
}

function firstAmount(text) {
  const t = String(text ?? '');
  const m = /(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i.exec(t);
  if (!m) return null;
  return parseAmount(m[1]);
}

function pickPolicyNumber(text) {
  const t = String(text ?? '');
  const longs = t.split(/\s+/).filter((x) => /^\d{8,10}$/.test(x));
  if (longs.length === 1) return longs[0]; // "1 334954753": serial number then policy number
  const direct = normalizePolicyNumber(t);
  if (direct) return direct;
  const m = /(?<![\d])(\d{8,9})(?![\d])/.exec(t) || /(?<![\d])(\d{7,12})(?![\d])/.exec(t);
  return m ? m[1] : '';
}

/** Pattern-based reading of a whole row. Used when there is no header or a column is missing. */
export function heuristicRow(rowText) {
  const text = cleanText(rowText);
  const info = { issues: [], fields: {} };

  const policyNumber = pickPolicyNumber(text);
  if (!policyNumber) return null;
  info.fields.policyNumber = policyNumber;

  let rest = text.replace(policyNumber, ' ');

  const mobiles = findMobiles(rest);
  if (mobiles.length) {
    info.fields.mobile = mobiles[0];
    rest = rest.replace(/(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}/g, ' ');
    if (mobiles.length > 1) info.issues.push('More than one mobile number found; the first was used');
  }

  const dates = findDates(rest);
  const validDates = dates.filter((d) => d.iso);
  if (validDates.length) {
    // FUP / due dates come after the commencement date, so the latest valid date is the best guess.
    const pick = [...validDates].sort((a, b) => (a.iso < b.iso ? 1 : -1))[0];
    info.fields.dueDate = pick.iso;
    if (validDates.length > 1) info.issues.push('More than one date found; the latest was used as the due date');
  } else if (dates.length) {
    info.fields.dueDateRaw = dates[0].raw;
    info.issues.push(`"${dates[0].raw}" is not a valid date`);
  }
  for (const d of [...dates].reverse()) rest = rest.slice(0, d.index) + ' ' + rest.slice(d.index + d.raw.length);

  const statusMatch = STATUS_WORDS.exec(rest);
  if (statusMatch) {
    info.fields.policyStatus = toTitleCase(statusMatch[0]);
    rest = rest.replace(STATUS_WORDS, ' ');
  }

  // Amount: prefer a marked or formatted number; ignore serial numbers and small terms.
  const nums = [];
  const re = /(₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;
  let m;
  while ((m = re.exec(rest))) {
    const val = parseAmount(m[2]);
    if (val === null) continue;
    nums.push({ val, marked: !!m[1], formatted: /[,.]/.test(m[2]), index: m.index, raw: m[0] });
  }
  const plausible = nums.filter((n) => n.val >= 50 && n.val < 10000000 && (n.marked || n.formatted || n.val >= 100));
  const pickAmt = plausible.find((n) => n.marked) || plausible.find((n) => n.formatted) || plausible[plausible.length - 1];
  if (pickAmt) {
    info.fields.premiumAmount = pickAmt.val;
    if (!pickAmt.marked && !pickAmt.formatted) info.issues.push('Premium amount guessed from an unlabelled number');
    rest = rest.replace(pickAmt.raw, ' ');
  }

  // Name: the longest run of letters that is not a known label.
  const runs = rest.match(/[A-Za-z஀-௿][A-Za-z஀-௿ .'&-]{2,}/g) || [];
  const nameRuns = runs.map(cleanText).filter((r) => r.replace(/[^A-Za-z஀-௿]/g, '').length >= 3 && !NOISE_WORDS.test(r));
  const cleaned = nameRuns.map(stripFillerWords).filter((r) => r.replace(/[^A-Za-z\u0B80-\u0BFF]/g, '').length >= 3);
  cleaned.sort((a, b) => b.length - a.length);
  if (cleaned[0]) info.fields.customerName = cleaned[0];

  return info;
}

// ---------- 4. record building ----------

function scoreRecord(rec, viaHeader, issues) {
  let s = 0;
  if (/^\d{8,9}$/.test(rec.policyNumber)) s += 0.3; else if (rec.policyNumber) s += 0.15;
  if (isValidISO(rec.dueDate)) s += 0.3;
  if (rec.premiumAmount !== null && rec.premiumAmount !== undefined && rec.premiumAmount !== '') s += 0.15;
  if (rec.customerName) s += 0.15;
  if (rec.mobile) s += 0.05;
  if (viaHeader) s += 0.05;
  s -= 0.12 * issues.filter((i) => /guess|More than one|not a valid/.test(i)).length;
  return Math.max(0, Math.min(1, Number(s.toFixed(2))));
}

function finishRecord(fields, meta) {
  const issues = [...(meta.issues || [])];
  const rec = {
    customerName: toTitleCase(fields.customerName || ''),
    policyNumber: fields.policyNumber || '',
    premiumAmount: fields.premiumAmount ?? null,
    dueDate: fields.dueDate || '',
    mobile: fields.mobile || '',
    policyStatus: cleanText(fields.policyStatus || ''),
    premiumTerm: cleanText(fields.premiumTerm || ''),
    mode: cleanText(fields.mode || ''),
    plan: cleanText(fields.plan || ''),
    page: meta.page,
    rawText: meta.rawText,
    ...(fields.extra || {}),
  };
  if (fields.dueDateRaw && !rec.dueDate) issues.push(`Due date "${fields.dueDateRaw}" is not a valid date`);
  const v = validatePolicy(rec);
  rec.errors = v.errors;
  rec.warnings = v.warnings;
  rec.issues = [...new Set(issues)];
  rec.confidence = scoreRecord(rec, meta.viaHeader, rec.issues);
  rec.needsReview = hasErrors(v) || rec.confidence < 0.75 || rec.issues.length > 0;
  return rec;
}

/** Build a scored, validated record from already-separated fields (used by CSV import and manual tools). */
export function recordFromFields(fields, meta = {}) {
  return finishRecord(fields, { page: meta.page || 0, issues: meta.issues || [], viaHeader: !!meta.viaHeader, rawText: meta.rawText || '' });
}

function recordFromColumns(cells, cols, meta) {
  const col = assignColumns(cells, cols);
  const issues = [];
  const fields = {};

  const h = heuristicRow(cells.map((c) => c.text).join(' '));

  // Policy number
  fields.policyNumber = col.policyNumber ? pickPolicyNumber(col.policyNumber) : '';
  if (!fields.policyNumber && h) { fields.policyNumber = h.fields.policyNumber; issues.push('Policy number was found outside its column'); }
  if (!fields.policyNumber) return null;

  // Name (a long name can run into the next column; a date inside it is the date of commencement)
  let nameText = cleanText(col.name || '');
  let nameDate = null;
  const nd = findDates(nameText).find((d) => d.iso);
  if (nd) { nameDate = nd.iso; nameText = cleanText(nameText.replace(nd.raw, ' ')); }
  fields.customerName = nameText || (h && h.fields.customerName) || '';
  if (!nameText && fields.customerName) issues.push('Name was guessed from the row text');

  // Due date
  const commencement = (col.commencement && findDates(col.commencement).find((d) => d.iso)?.iso) || nameDate || '';
  fields.extra = {};
  if (commencement) fields.extra.commencementDate = commencement;
  if (col.instalmentsDue && /^\d{1,3}$/.test(cleanText(col.instalmentsDue))) fields.extra.instalmentsDue = Number(cleanText(col.instalmentsDue));
  if (col.totalPremium) { const t = firstAmount(col.totalPremium); if (t !== null) fields.extra.totalPremium = t; }
  if (col.flag) fields.extra.flag = cleanText(col.flag);
  if (col.commission) { const c = firstAmount(col.commission); if (c !== null) fields.extra.estCommission = c; }
  if (col.dueDate) {
    const ds = findDates(col.dueDate);
    const ok = ds.find((d) => d.iso);
    const my = /^(\d{1,2})\s*[/-]\s*(\d{4})$/.exec(cleanText(col.dueDate));
    if (ok) fields.dueDate = ok.iso;
    else if (my && Number(my[1]) >= 1 && Number(my[1]) <= 12) {
      // Month-only due ("FUP 05/2026"). The day of the month is the day of the date of commencement, never a guess.
      const y = Number(my[2]); const mo = Number(my[1]);
      const cd = commencement ? Number(commencement.slice(8, 10)) : 0;
      if (cd) {
        fields.dueDate = makeISO(y, mo, Math.min(cd, daysInMonth(y, mo)));
        fields.extra.dueDateDerived = true;
      } else {
        fields.dueDateRaw = col.dueDate;
        issues.push(`The list shows only the month (${col.dueDate}) and no date of commencement, so the due day is unknown. Enter it.`);
      }
    } else {
      fields.dueDateRaw = ds[0]?.raw || col.dueDate;
    }
  } else if (h && h.fields.dueDate) {
    fields.dueDate = h.fields.dueDate;
    issues.push('Due date column not recognised; date taken from the row text');
  }

  // Amount
  if (col.premiumAmount) {
    const a = firstAmount(col.premiumAmount);
    if (a !== null) fields.premiumAmount = a;
  } else if (h && h.fields.premiumAmount !== undefined) {
    fields.premiumAmount = h.fields.premiumAmount;
    issues.push('Premium amount was guessed from the row text');
  }

  // Mobile
  const mobFromCol = col.mobile ? findMobiles(col.mobile)[0] : '';
  fields.mobile = mobFromCol || (!col.mobile && h ? h.fields.mobile || '' : '');

  fields.policyStatus = col.status ? cleanText(col.status) : (h && h.fields.policyStatus) || '';
  fields.premiumTerm = col.term || '';
  fields.mode = col.mode || '';
  fields.plan = col.plan || '';

  return finishRecord(fields, { ...meta, issues, viaHeader: true, rawText: cells.map((c) => c.text).join(' | ') });
}

function recordFromHeuristic(rowText, meta) {
  const h = heuristicRow(rowText);
  if (!h) return null;
  return finishRecord(h.fields, { ...meta, issues: [...h.issues, 'Read without column headings: please check each value'], viaHeader: false, rawText: rowText });
}

const HARD_NOISE = /(page\s*no\b|page\s*total|grand\s*total|agent\s*(code|name)\s*:|branch\s*code\s*:|premium\s*due\s*list)/i;

function isNoiseRow(row) {
  const t = row.text;
  return NOISE_WORDS.test(t) && !pickPolicyNumber(t);
}

/**
 * Parse pages of rows into policy records.
 * pages: [{ page: 1, rows: buildRows(...) }]
 */
export function parsePages(pages) {
  const records = [];
  const skipped = [];
  let header = null;
  let headerPages = 0;
  let viaHeaderCount = 0;

  for (const pg of pages) {
    const rows = pg.rows;
    let pageHeader = null;
    let i = 0;
    let prev = null;
    let headerAt = -1;
    for (let k = 0; k < rows.length && headerAt < 0; k++) { const f = findHeader(rows, k); if (f && f.cols.length >= 2) headerAt = k; }
    while (i < rows.length) {
      const row = rows[i];
      if ((headerAt >= 0 && i < headerAt) || HARD_NOISE.test(row.text)) {
        skipped.push({ page: pg.page, text: row.text.slice(0, 120), reason: 'heading or total line' });
        i++;
        continue;
      }
      if (!pageHeader) {
        const found = findHeader(rows, i);
        if (found && found.cols.length >= 2) {
          pageHeader = found;
          header = found;
          headerPages++;
          i += found.rowsUsed;
          continue;
        }
      }
      const cols = (pageHeader || header)?.cols;
      let rec = null;
      if (cols && cols.length >= 2) rec = recordFromColumns(row.cells, cols, { page: pg.page });
      if (!rec) rec = recordFromHeuristic(row.text, { page: pg.page });

      if (rec) {
        records.push(rec);
        prev = rec;
        if (cols) viaHeaderCount++;
      } else if (prev && cols && isContinuation(row, cols)) {
        const extra = cleanText(row.text);
        prev.customerName = toTitleCase(`${prev.customerName} ${extra}`);
        prev.rawText += ` | ${extra}`;
        prev.warnings = validatePolicy(prev).warnings;
      } else if (row.text.length > 0) {
        skipped.push({ page: pg.page, text: row.text.slice(0, 120), reason: isNoiseRow(row) ? 'heading or total line' : 'no policy number' });
      }
      i++;
    }
  }

  return { records, skipped, headerFound: headerPages > 0, headerColumns: header ? header.cols.map((c) => ({ field: c.field, text: c.text })) : [], viaHeaderCount };
}

function isContinuation(row, cols) {
  const nameCol = cols.find((c) => c.field === 'name');
  if (!nameCol) return false;
  if (/\d/.test(row.text) || NOISE_WORDS.test(row.text)) return false;
  const a = assignColumns(row.cells, cols);
  return Object.keys(a).length === 1 && !!a.name;
}

/** Flag records that repeat a policy number + due date inside the same extraction. */
export function markInternalDuplicates(records) {
  const seen = new Map();
  for (const r of records) {
    const k = duplicateKey(r);
    if (!r.policyNumber || !r.dueDate) continue;
    if (seen.has(k)) r.duplicateInFile = true;
    else seen.set(k, r);
  }
  return records;
}

export function summarizeExtraction(records) {
  const total = records.length;
  const failed = records.filter((r) => Object.keys(r.errors).length > 0).length;
  const duplicates = records.filter((r) => r.duplicateInFile).length;
  const missingInfo = records.filter((r) => Object.keys(r.warnings).length > 0).length;
  const lowConfidence = records.filter((r) => r.confidence < 0.75).length;
  return { total, ok: total - failed, failed, duplicates, missingInfo, lowConfidence };
}
