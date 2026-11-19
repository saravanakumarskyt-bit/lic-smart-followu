// Field normalisers and validators shared by the PDF parser, CSV import, the edit form and the backup restore.
import { isValidISO } from './dates.js';

export const FOLLOWUP_STATUSES = ['pending', 'contacted', 'promised', 'completed'];
export const PAYMENT_STATUSES = ['unpaid', 'paid'];

export function cleanText(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep only the digits of a policy number. Returns '' when nothing plausible is present. */
export function normalizePolicyNumber(s) {
  const text = String(s ?? '').trim();
  // Prefer a single run of digits (with optional internal spaces/hyphens, e.g. "123 456 789").
  const compact = text.replace(/[\s-]/g, '');
  if (/^\d{5,15}$/.test(compact)) return compact;
  const run = /\d{7,12}/.exec(compact);
  return run ? run[0] : '';
}

const MOBILE_RE = /(?<!\d)(?:\+?91[\s-]?|0)?([6-9]\d{4}[\s-]?\d{5})(?!\d)/g;

/** All valid Indian mobile numbers in the text, as 10-digit strings (no duplicates, order kept). */
export function findMobiles(s) {
  const out = [];
  const text = String(s ?? '');
  let m;
  MOBILE_RE.lastIndex = 0;
  while ((m = MOBILE_RE.exec(text))) {
    const n = m[1].replace(/[\s-]/g, '');
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

export function normalizeMobile(s) {
  const all = findMobiles(s);
  return all.length ? all[0] : '';
}

/** Parse a rupee amount: "Rs. 12,345/-", "₹ 1,234.50", "12345". Returns a number or null. */
export function parseAmount(s) {
  if (typeof s === 'number') return Number.isFinite(s) && s >= 0 ? s : null;
  const text = String(s ?? '')
    .replace(/(?:₹|rs\.?|inr)/gi, ' ')
    .replace(/\/-/g, ' ')
    .trim();
  const m = /^-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?$|^-?\d+(?:\.\d{1,2})?$/.exec(text.replace(/\s+/g, ''));
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** "RAMESH KUMAR" -> "Ramesh Kumar". Mixed-case names are left alone. */
export function toTitleCase(name) {
  const s = cleanText(name);
  if (!s) return '';
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s.'-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

export function normalizeNameKey(name) {
  return cleanText(name)
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|smt|shri|sri|thiru|tmt|dr|late)\b\.?/g, ' ')
    .replace(/[^a-z0-9஀-௿ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Validate a policy record. Returns { errors, warnings } keyed by field name.
 * Errors block saving; warnings only inform.
 */
export function validatePolicy(p) {
  const errors = {};
  const warnings = {};

  const pn = String(p.policyNumber ?? '').trim();
  if (!pn) errors.policyNumber = 'Policy number is required';
  else if (!/^\d{5,15}$/.test(pn)) errors.policyNumber = 'Policy number must be 5-15 digits';
  else if (!/^\d{8,9}$/.test(pn)) warnings.policyNumber = 'LIC policy numbers are usually 8-9 digits';

  if (!p.dueDate) errors.dueDate = 'Due date is required';
  else if (!isValidISO(p.dueDate)) errors.dueDate = 'Due date is not a valid date';

  if (p.premiumAmount === null || p.premiumAmount === undefined || p.premiumAmount === '') {
    warnings.premiumAmount = 'Premium amount is missing';
  } else if (!(Number(p.premiumAmount) >= 0) || !Number.isFinite(Number(p.premiumAmount))) {
    errors.premiumAmount = 'Premium amount must be a positive number';
  }

  const mob = String(p.mobile ?? '').trim();
  if (!mob) warnings.mobile = 'Mobile number is missing';
  else if (!/^[6-9]\d{9}$/.test(mob)) errors.mobile = 'Mobile must be a 10-digit Indian number';

  if (!cleanText(p.customerName)) warnings.customerName = 'Customer name is missing';

  return { errors, warnings };
}

export function hasErrors(v) {
  return Object.keys(v.errors).length > 0;
}

export function duplicateKey(p) {
  return `${p.policyNumber}|${p.dueDate}`;
}
