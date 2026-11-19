// CSV -> policy records (same shape as PDF extraction, so one verification screen handles everything).
import { parseCSV, unsafeCell, EXPORT_HEADERS } from './csv.js';
import { classifyHeader, heuristicRow, recordFromFields } from './parser.js';
import { findDates } from './dates.js';
import { findMobiles, parseAmount, cleanText } from './validate.js';

const EXACT = {
  'customer name': 'customerName', 'name': 'customerName',
  'policy number': 'policyNumber', 'policy no': 'policyNumber', 'policy no.': 'policyNumber',
  'premium amount': 'premiumAmount', 'premium': 'premiumAmount', 'amount': 'premiumAmount',
  'due date': 'dueDate', 'premium due date': 'dueDate', 'fup': 'dueDate',
  'mobile number': 'mobile', 'mobile': 'mobile', 'mobile no': 'mobile', 'phone': 'mobile',
  'policy status': 'policyStatus', 'status': 'policyStatus',
  'payment status': 'paymentStatus', 'paid date': 'paidDate',
  'follow-up status': 'followUpStatus', 'last follow-up date': 'lastFollowUpDate',
  'notes': 'notes', 'source pdf': 'sourceName', 'date imported': 'importedDate',
  'premium term': 'premiumTerm', 'mode': 'mode', 'plan': 'plan',
};

function mapHeader(cell) {
  const k = cleanText(cell).toLowerCase();
  if (EXACT[k]) return EXACT[k];
  const c = classifyHeader(cell);
  return c === 'term' ? 'premiumTerm' : c === 'status' ? 'policyStatus' : c === 'sno' || c === 'dob' || c === 'commencement' ? null : c;
}

export function csvToRecords(text, order = 'dmy') {
  const rows = parseCSV(text);
  if (!rows.length) return { records: [], headerFound: false, skipped: [] };
  const map = rows[0].map(mapHeader);
  const headerFound = map.filter(Boolean).length >= 2 && (map.includes('policyNumber') || map.includes('dueDate'));
  const records = [];
  const skipped = [];
  const body = headerFound ? rows.slice(1) : rows;

  body.forEach((row, i) => {
    if (!headerFound) {
      const h = heuristicRow(row.join(' '));
      if (!h) { skipped.push({ page: 0, text: row.join(' ').slice(0, 120), reason: 'no policy number' }); return; }
      records.push(recordFromFields(h.fields, { issues: h.issues, rawText: row.join(' | ') }));
      return;
    }
    const f = {};
    const extra = {};
    row.forEach((cell, c) => {
      const field = map[c];
      if (!field) return;
      const v = unsafeCell(cell).trim();
      if (field === 'premiumAmount') f.premiumAmount = v === '' ? null : parseAmount(v);
      else if (field === 'dueDate') {
        const d = findDates(v, order);
        const ok = d.find((x) => x.iso);
        if (ok) f.dueDate = ok.iso; else if (v) f.dueDateRaw = v;
      } else if (field === 'mobile') f.mobile = findMobiles(v)[0] || '';
      else if (field === 'paymentStatus') { if (/^paid$/i.test(v)) extra.paymentStatus = 'paid'; }
      else if (field === 'paidDate') { const d = findDates(v, order).find((x) => x.iso); if (d) extra.paidDate = d.iso; }
      else if (field === 'lastFollowUpDate') { const d = findDates(v, order).find((x) => x.iso); if (d) extra.lastFollowUpDate = d.iso; }
      else if (field === 'followUpStatus') { if (['pending', 'contacted', 'promised', 'completed'].includes(v.toLowerCase())) extra.followUpStatus = v.toLowerCase(); }
      else if (field === 'notes') extra.notes = v;
      else if (field === 'sourceName' || field === 'importedDate') { /* regenerated on import */ }
      else f[field] = v;
    });
    if (!f.policyNumber && !f.dueDate && !f.customerName) return;
    if (!f.policyNumber) { skipped.push({ page: 0, text: row.join(' ').slice(0, 120), reason: `row ${i + 2}: no policy number` }); return; }
    f.extra = extra;
    records.push(recordFromFields(f, { viaHeader: true, rawText: row.join(' | ') }));
  });
  return { records, headerFound, skipped };
}

export { EXPORT_HEADERS };
