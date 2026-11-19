// Printable customer report (self-contained HTML) and customer-wise CSV. All values are HTML-escaped.
import { toCSV, safeCell } from './csv.js';
import { formatDate } from './dates.js';
import { formatINR } from './messages.js';
import { summarize, inCategory, sortPolicies, monthlyCollection, isPaid } from './due.js';

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function customersToCSV(customers) {
  const rows = [['Customer', 'Mobile', 'Policies', 'Unpaid installments', 'Unpaid premium', 'Next due date', 'Policy numbers']];
  for (const c of customers) rows.push([safeCell(c.name), c.mobile, c.policyNumbers.length, c.unpaidCount, c.totalPremiumUnpaid, c.nextDue || '', c.policyNumbers.join(' ')]);
  return toCSV(rows);
}

function table(title, list) {
  if (!list.length) return '';
  const body = list.map((p) => `<tr><td>${escapeHtml(p.customerName)}</td><td>${escapeHtml(p.policyNumber)}</td><td class="r">${escapeHtml(p.premiumAmount ? formatINR(p.premiumAmount) : '')}</td><td>${escapeHtml(formatDate(p.dueDate))}</td><td>${escapeHtml(p.mobile)}</td><td>${escapeHtml(p.followUpStatus)}</td></tr>`).join('');
  return `<h2>${escapeHtml(title)} (${list.length})</h2><table><thead><tr><th>Customer</th><th>Policy no.</th><th class="r">Premium</th><th>Due date</th><th>Mobile</th><th>Follow-up</th></tr></thead><tbody>${body}</tbody></table>`;
}

export function buildReportHTML({ policies, customers, today, profile = {}, overdueMaxDays = 0 }) {
  const ctx = { today, overdueMaxDays };
  const s = summarize(policies, ctx);
  const mc = monthlyCollection(policies, today);
  const by = (id) => sortPolicies(policies.filter((p) => inCategory(p, id, ctx)), 'due_asc');
  const who = [profile.advisorName, profile.agentCode && `Code ${profile.agentCode}`, profile.branch].filter(Boolean).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LIC Follow-up Report ${escapeHtml(today)}</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#111}h1{margin:0 0 4px;color:#0b5bd3}h2{margin:22px 0 6px;font-size:16px;border-bottom:2px solid #0b5bd3;padding-bottom:3px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccd;padding:4px 6px;text-align:left}th{background:#eef3ff}.r{text-align:right}.sum{display:flex;flex-wrap:wrap;gap:8px}.sum div{border:1px solid #ccd;border-radius:8px;padding:8px 12px;min-width:110px}.sum b{display:block;font-size:20px}@media print{body{margin:8mm}}</style></head><body>
<h1>LIC Smart Follow-up report</h1><div>${escapeHtml(formatDate(today))}${who ? ' · ' + escapeHtml(who) : ''}</div>
<h2>Summary</h2><div class="sum"><div><b>${customers.length}</b>Customers</div><div><b>${s.totalPolicies}</b>Policies</div><div><b>${s.today}</b>Due today</div><div><b>${s.next7}</b>Next 7 days</div><div><b>${s.overdue}</b>Overdue</div><div><b>${s.pending}</b>Follow-ups pending</div><div><b>${s.paid}</b>Payments confirmed</div></div>
<h2>This month</h2><div>Due ${escapeHtml(formatINR(mc.dueAmount))} (${mc.dueCount}) · Confirmed paid ${escapeHtml(formatINR(mc.paidAmount))} (${mc.paidCount}, ${mc.percent}%) · Pending ${escapeHtml(formatINR(mc.pendingAmount))} (${mc.pendingCount})</div>
${table('Due today', by('today'))}${table('Due in the next 7 days', by('next7'))}${table('Overdue', by('overdue'))}${table('Pending follow-ups', by('pending').filter((p) => !isPaid(p)))}
<p style="margin-top:24px;color:#667;font-size:11px">Generated on the advisor's device. Contains customer information: keep it private.</p></body></html>`;
}
