// Minimal RFC-4180 CSV reader/writer with delimiter detection and spreadsheet formula-injection protection.

export function detectDelimiter(text) {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLines) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

export function parseCSV(text, delimiter) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      inQ = true;
    } else if (ch === d) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** Neutralise values that Excel/Sheets would run as formulas. */
export function safeCell(v) {
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function unsafeCell(v) {
  const s = String(v ?? '');
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

function quote(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
}

export const EXPORT_HEADERS = [
  'Customer Name', 'Policy Number', 'Premium Amount', 'Due Date', 'Mobile Number', 'Policy Status',
  'Payment Status', 'Paid Date', 'Follow-up Status', 'Last Follow-up Date', 'Notes', 'Source PDF', 'Date Imported',
];

export function policiesToCSV(policies) {
  const rows = [EXPORT_HEADERS];
  for (const p of policies) {
    rows.push([
      safeCell(p.customerName), p.policyNumber, p.premiumAmount ?? '', p.dueDate, p.mobile || '', safeCell(p.policyStatus || ''),
      p.paymentStatus || 'unpaid', p.paidDate || '', p.followUpStatus || 'pending', p.lastFollowUpDate || '',
      safeCell(p.notes || ''), safeCell(p.sourceName || ''), (p.importedAt || '').slice(0, 10),
    ]);
  }
  return toCSV(rows);
}
