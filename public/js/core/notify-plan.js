// Pure notification planner: given the data and the preferences, decide exactly which notifications should exist.
// No clock reads and no platform calls here, so it is fully unit-testable.
//
// WHY PRE-SCHEDULING: Android does not run web code while the app is closed. The only reliable way to show a daily
// summary with no internet and no running app is to hand Android a list of dated notifications in advance
// (Capacitor Local Notifications). Each day's text is calculated now for that future day. Every time the app opens,
// or data changes, the list is rebuilt, so it never goes stale as long as the app is opened within the horizon.
import { addDays, toDayNumber } from './dates.js';
import { summarize, inCategory, sortPolicies } from './due.js';
import { formatINR } from './messages.js';
import { toTitleCase } from './validate.js';

export const HORIZON_DAYS = 30;
export const MAX_INDIVIDUAL_HORIZON_DAYS = 7;

export function morningText(s, advisorName = '') {
  const name = advisorName ? `, ${advisorName.split(' ')[0]}` : '';
  return {
    title: `Good Morning${name}! LIC Follow-up Report`,
    body:
      `Today's Due Policies: ${s.today}\n` +
      `Due in Next 3 Days: ${s.next3}\n` +
      `Due in Next 7 Days: ${s.next7}\n` +
      `Overdue Policies: ${s.overdue}\n` +
      `Pending Follow-ups: ${s.pending}\n\n` +
      'Please contact your customers and complete your follow-ups.',
    short: `Today ${s.today} · 3 days ${s.next3} · 7 days ${s.next7} · Overdue ${s.overdue}`,
  };
}

export function eveningText(s) {
  return {
    title: 'Good Evening! Follow-up wrap-up',
    body:
      `Still unpaid and due today: ${s.today}\n` +
      `Due tomorrow: ${s.tomorrow}\n` +
      `Overdue Policies: ${s.overdue}\n` +
      `Pending Follow-ups: ${s.pending}\n\n` +
      'Update today\'s follow-ups so tomorrow\'s report is accurate.',
    short: `Unpaid today ${s.today} · tomorrow ${s.tomorrow} · overdue ${s.overdue}`,
  };
}

export function individualText(p, hideDetails = false) {
  if (hideDetails) return { title: 'Premium due today', body: 'Open LIC Smart Follow-up to see the customer details.' };
  const bits = [`Policy ${p.policyNumber}`];
  if (p.premiumAmount) bits.push(formatINR(p.premiumAmount));
  if (p.mobile) bits.push(`Mob ${p.mobile}`);
  return { title: `Premium due today: ${toTitleCase(p.customerName) || 'Customer'}`, body: bits.join(' · ') };
}

/** Stable positive 31-bit id: day number * 1000 + slot (slot 1 morning, 2 evening, 100.. individual). */
export function notificationId(isoDate, slot) {
  return toDayNumber(isoDate) * 1000 + slot;
}

/** Local Date for an ISO day and "HH:MM". */
export function atTime(iso, hhmm) {
  const [y, m, d] = iso.split('-').map(Number);
  const [hh, mm] = String(hhmm || '08:00').split(':').map((n) => parseInt(n, 10) || 0);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/**
 * Build the list of notifications to schedule.
 * @param {object} o { policies, prefs, profile, now: Date, today: 'YYYY-MM-DD' }
 * @returns [{ id, at: Date, title, body, largeBody, kind, day }]
 */
export function planNotifications({ policies, prefs, profile, now, today, horizonDays = HORIZON_DAYS }) {
  if (!prefs.notifEnabled && !prefs.eveningEnabled && !prefs.individualEnabled) return [];
  if (!policies.length) return [];
  const out = [];
  const advisor = profile?.advisorName || '';

  for (let k = 0; k < horizonDays; k++) {
    const day = addDays(today, k);
    const ctx = { today: day, overdueMaxDays: prefs.overdueMaxDays || 0 };
    const s = summarize(policies, ctx);
    const nothingToSay = !s.today && !s.next7 && !s.overdue && !s.pending;

    if (prefs.notifEnabled) {
      const at = atTime(day, prefs.notifTime);
      if (at > now && !nothingToSay) {
        const t = morningText(s, advisor);
        out.push({ id: notificationId(day, 1), at, title: t.title, body: t.short, largeBody: t.body, kind: 'morning', day });
      }
    }
    if (prefs.eveningEnabled) {
      const at = atTime(day, prefs.eveningTime);
      if (at > now && !nothingToSay) {
        const t = eveningText(s);
        out.push({ id: notificationId(day, 2), at, title: t.title, body: t.short, largeBody: t.body, kind: 'evening', day });
      }
    }
    if (prefs.individualEnabled && k < MAX_INDIVIDUAL_HORIZON_DAYS) {
      const at = atTime(day, prefs.individualTime);
      if (at > now) {
        const due = sortPolicies(policies.filter((p) => inCategory(p, 'today', ctx)), 'amount_desc').slice(0, prefs.individualMaxPerDay || 15);
        due.forEach((p, i) => {
          const t = individualText(p, prefs.hideNotifDetails);
          // spread by one minute each so Android does not collapse them into one burst
          out.push({ id: notificationId(day, 100 + i), at: new Date(at.getTime() + i * 60000), title: t.title, body: t.body, kind: 'individual', day, policyId: p.id });
        });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** What should the "today" card say right now (also used for the in-app summary). */
export function todaySummary(policies, { today, overdueMaxDays = 0 }) {
  return summarize(policies, { today, overdueMaxDays });
}
