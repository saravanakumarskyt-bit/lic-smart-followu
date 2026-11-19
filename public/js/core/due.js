// Due-date classification engine. Pure functions: pass in the policies and a context { today, overdueMaxDays }.
// Nothing here reads the clock, so every result is reproducible in tests; callers pass todayISO() from the device.
import { diffDays, monthKey } from './dates.js';

export const CATEGORIES = [
  { id: 'today', label: 'Due Today' },
  { id: 'tomorrow', label: 'Due Tomorrow' },
  { id: 'next3', label: 'Next 3 Days' },
  { id: 'next7', label: 'Next 7 Days' },
  { id: 'next15', label: 'Next 15 Days' },
  { id: 'thisMonth', label: 'This Month' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'pending', label: 'Pending Follow-ups' },
  { id: 'followupDone', label: 'Follow-up Completed' },
  { id: 'paid', label: 'Payment Confirmed' },
  { id: 'all', label: 'All Policies' },
];

export function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export const isPaid = (p) => p.paymentStatus === 'paid';
export const isFollowUpDone = (p) => p.followUpStatus === 'completed';

/** Days from today until the due date (negative = overdue). */
export function daysUntil(p, today) {
  return diffDays(today, p.dueDate);
}

function overdueCounts(days, ctx) {
  if (days >= 0) return false;
  const max = ctx.overdueMaxDays || 0;
  return max === 0 || -days <= max;
}

/**
 * Exclusive "time bucket" used for the coloured badge on each policy.
 * A policy is never treated as paid unless the user confirmed the payment.
 */
export function bucketOf(p, ctx) {
  if (isPaid(p)) return 'paid';
  const d = daysUntil(p, ctx.today);
  if (d < 0) return overdueCounts(d, ctx) ? 'overdue' : 'stale';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d <= 3) return 'next3';
  if (d <= 7) return 'next7';
  if (d <= 15) return 'next15';
  if (monthKey(p.dueDate) === monthKey(ctx.today)) return 'thisMonth';
  return 'later';
}

/**
 * Needs the advisor's attention: unpaid, follow-up not completed, and overdue or due within 7 days.
 * A customer already contacted (or who promised to pay) TODAY is off today's to-do list; they return to it
 * the next day if the premium is still unpaid.
 */
export function needsFollowUp(p, ctx) {
  if (isPaid(p) || isFollowUpDone(p)) return false;
  if ((p.followUpStatus === 'contacted' || p.followUpStatus === 'promised') && p.lastFollowUpDate === ctx.today) return false;
  const d = daysUntil(p, ctx.today);
  if (d < 0) return overdueCounts(d, ctx);
  return d <= 7;
}

/**
 * Category membership. Windows are cumulative and start tomorrow (today has its own category):
 *   next3 = 1..3 days, next7 = 1..7 days, next15 = 1..15 days.
 * "thisMonth" is every unpaid policy whose due date is in the current calendar month.
 */
export function inCategory(p, id, ctx) {
  const paid = isPaid(p);
  const d = daysUntil(p, ctx.today);
  switch (id) {
    case 'today': return !paid && d === 0;
    case 'tomorrow': return !paid && d === 1;
    case 'next3': return !paid && d >= 1 && d <= 3;
    case 'next7': return !paid && d >= 1 && d <= 7;
    case 'next15': return !paid && d >= 1 && d <= 15;
    case 'thisMonth': return !paid && monthKey(p.dueDate) === monthKey(ctx.today);
    case 'overdue': return !paid && overdueCounts(d, ctx);
    case 'pending': return needsFollowUp(p, ctx);
    case 'followupDone': return isFollowUpDone(p);
    case 'paid': return paid;
    case 'all': return true;
    default: return false;
  }
}

export function categoriesOf(p, ctx) {
  return CATEGORIES.filter((c) => c.id !== 'all' && inCategory(p, c.id, ctx)).map((c) => c.id);
}

/** Counts for the dashboard and for the daily notification text. */
export function summarize(policies, ctx) {
  const out = {
    totalPolicies: new Set(policies.map((p) => p.policyNumber)).size,
    totalRecords: policies.length,
    today: 0, tomorrow: 0, next3: 0, next7: 0, next15: 0, thisMonth: 0,
    overdue: 0, pending: 0, followupDone: 0, paid: 0,
    amountToday: 0, amountOverdue: 0,
  };
  for (const p of policies) {
    for (const id of ['today', 'tomorrow', 'next3', 'next7', 'next15', 'thisMonth', 'overdue', 'pending', 'followupDone', 'paid']) {
      if (inCategory(p, id, ctx)) out[id]++;
    }
    if (inCategory(p, 'today', ctx)) out.amountToday += Number(p.premiumAmount) || 0;
    if (inCategory(p, 'overdue', ctx)) out.amountOverdue += Number(p.premiumAmount) || 0;
  }
  return out;
}

/** Premium collection summary for the calendar month containing `today`. Based only on user-confirmed payments. */
export function monthlyCollection(policies, today) {
  const key = monthKey(today);
  const res = { dueCount: 0, dueAmount: 0, paidCount: 0, paidAmount: 0, pendingCount: 0, pendingAmount: 0, percent: 0 };
  for (const p of policies) {
    if (monthKey(p.dueDate) !== key) continue;
    const amt = Number(p.premiumAmount) || 0;
    res.dueCount++;
    res.dueAmount += amt;
    if (isPaid(p)) {
      res.paidCount++;
      res.paidAmount += Number(p.paidAmount) || amt;
    } else {
      res.pendingCount++;
      res.pendingAmount += amt;
    }
  }
  res.percent = res.dueCount ? Math.round((res.paidCount / res.dueCount) * 100) : 0;
  return res;
}

/** Map of ISO date -> { count, amount, paid } for the calendar view. */
export function dueByDate(policies) {
  const map = new Map();
  for (const p of policies) {
    const e = map.get(p.dueDate) || { count: 0, amount: 0, unpaid: 0 };
    e.count++;
    e.amount += Number(p.premiumAmount) || 0;
    if (!isPaid(p)) e.unpaid++;
    map.set(p.dueDate, e);
  }
  return map;
}

export function sortPolicies(list, sort) {
  const arr = [...list];
  const byDue = (a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0);
  const byName = (a, b) => String(a.customerName || '').localeCompare(String(b.customerName || ''));
  switch (sort) {
    case 'due_desc': return arr.sort((a, b) => byDue(b, a));
    case 'amount_desc': return arr.sort((a, b) => (Number(b.premiumAmount) || 0) - (Number(a.premiumAmount) || 0) || byDue(a, b));
    case 'amount_asc': return arr.sort((a, b) => (Number(a.premiumAmount) || 0) - (Number(b.premiumAmount) || 0) || byDue(a, b));
    case 'name': return arr.sort((a, b) => byName(a, b) || byDue(a, b));
    case 'imported_desc': return arr.sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')));
    case 'due_asc':
    default: return arr.sort((a, b) => byDue(a, b) || byName(a, b));
  }
}

/** Case/format-insensitive search over name, policy number and mobile number. */
export function matchesQuery(p, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  if (String(p.customerName || '').toLowerCase().includes(q)) return true;
  if (String(p.policyNumber || '').includes(q.replace(/\s/g, ''))) return true;
  if (digits.length >= 3 && String(p.mobile || '').includes(digits)) return true;
  if (String(p.notes || '').toLowerCase().includes(q)) return true;
  return false;
}

/**
 * Commission for a payment. The due list gives the estimated commission (EstCom) for the whole amount due (TotPrem).
 * Commission earned is that estimate in proportion to the amount actually received, never more than the estimate.
 * Returns null when the policy has no commission estimate (the advisor can still type the figure in).
 */
export function commissionForPayment(p, amountPaid) {
  const est = Number(p.estCommission);
  if (!(est > 0)) return null;
  const total = Number(p.totalPremium);
  const paid = Number(amountPaid);
  if (!(total > 0) || !(paid >= 0)) return est;
  return Math.round(Math.min(est, (est * paid) / total) * 100) / 100;
}

/** Commission summary: earned = confirmed payments only. Pending = estimate on policies still unpaid. */
export function commissionSummary(policies, today) {
  const key = monthKey(today);
  const res = { earnedMonth: 0, earnedMonthCount: 0, earnedTotal: 0, pendingEstimate: 0, pendingCount: 0 };
  for (const p of policies) {
    if (isPaid(p)) {
      const c = Number(p.commissionEarned) || 0;
      res.earnedTotal += c;
      if (c > 0 && p.paidDate && monthKey(p.paidDate) === key) { res.earnedMonth += c; res.earnedMonthCount++; }
    } else if (Number(p.estCommission) > 0) {
      res.pendingEstimate += Number(p.estCommission);
      res.pendingCount++;
    }
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  res.earnedMonth = r2(res.earnedMonth); res.earnedTotal = r2(res.earnedTotal); res.pendingEstimate = r2(res.pendingEstimate);
  return res;
}
