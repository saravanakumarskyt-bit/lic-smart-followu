import { h, icon, toast, mount } from './dom.js';
import { state, ctx } from '../store.js';
import { inCategory, monthlyCollection, isPaid } from '../core/due.js';
import { addDays, formatDate } from '../core/dates.js';
import { formatINR } from '../core/messages.js';
import { openMessageSheet } from './message.js';
import { openPolicyForm } from './detail.js';
import { emptyState } from './cards.js';
import { permissionState, requestPermission, notificationMode } from '../notify.js';
import { go } from '../router.js';

function greeting(now = new Date()) {
  const hr = now.getHours();
  const part = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const first = (state.profile.advisorName || '').trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

function stat(label, value, cat, tone, ic) {
  return h('button', { class: `stat ${tone}`, onclick: () => go(`/policies/${cat}`), 'aria-label': `${label}: ${value}` },
    h('div', { class: 'stat-ic' }, icon(ic, 20)),
    h('div', { class: 'stat-val' }, String(value)),
    h('div', { class: 'stat-lbl' }, label));
}

function last7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(state.today, -i));
  const counts = Object.fromEntries(days.map((d) => [d, 0]));
  for (const a of state.activities) if (['call', 'whatsapp', 'visit'].includes(a.type) && a.date in counts) counts[a.date]++;
  return days.map((d) => ({ d, n: counts[d] }));
}

export function renderHome(root) {
  const s = state.summary;
  const hasData = state.policies.length > 0;
  mount(root);

  root.appendChild(h('header', { class: 'hero' },
    h('div', {},
      h('div', { class: 'hero-hi' }, greeting()),
      h('div', { class: 'hero-date' }, new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))),
    h('div', { class: 'hero-badge' }, icon('shield', 22))));

  if (!hasData) {
    root.appendChild(emptyState('Welcome to LIC Smart Follow-up',
      'Import the premium due list PDF you receive, or add a customer by hand. Everything stays on this phone.',
      h('button', { class: 'btn primary lg', onclick: () => go('/import') }, icon('upload', 20), 'Import PDF'),
      h('button', { class: 'btn soft lg', onclick: () => openPolicyForm() }, icon('plus', 20), 'Add customer')));
    return;
  }

  // notification nudge
  const nudge = h('div');
  if (state.prefs.notifEnabled) {
    permissionState().then((p) => {
      if (p === 'prompt') mount(nudge, h('div', { class: 'banner info' }, icon('bell', 20),
        h('div', {}, h('strong', 'Turn on daily reminders'), h('div', { class: 'small' }, notificationMode() === 'native' ? 'Allow notifications to get your morning follow-up report.' : 'Allow notifications to be reminded when you open the app.')),
        h('button', { class: 'btn primary sm', onclick: async () => { const r = await requestPermission(); toast(r === 'granted' ? 'Notifications allowed' : 'Notifications not allowed'); document.dispatchEvent(new CustomEvent('data-changed')); } }, 'Allow')));
      else if (p === 'denied') mount(nudge, h('div', { class: 'banner warn' }, icon('alert', 20), h('div', {}, h('strong', 'Notifications are blocked'), h('div', { class: 'small' }, 'Enable them in Android Settings → Apps → LIC Smart Follow-up → Notifications.'))));
    });
  }
  root.appendChild(nudge);

  // backup reminder
  const days = state.prefs.backupReminderDays;
  if (days > 0) {
    const last = state.prefs.lastBackupAt ? new Date(state.prefs.lastBackupAt) : null;
    const age = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : Infinity;
    if (age >= days) root.appendChild(h('div', { class: 'banner warn' }, icon('database', 20),
      h('div', {}, h('strong', last ? `Last backup was ${age} days ago` : 'You have not made a backup yet'), h('div', { class: 'small' }, 'Phones get lost or reset. A backup protects your customer list.')),
      h('button', { class: 'btn primary sm', onclick: () => go('/backup') }, 'Back up')));
  }

  // today card
  const todayList = state.policies.filter((p) => inCategory(p, 'today', ctx()) || (inCategory(p, 'overdue', ctx()) && p.followUpStatus === 'pending'));
  const todayIds = state.policies.filter((p) => inCategory(p, 'today', ctx())).map((p) => p.id);
  root.appendChild(h('section', { class: 'today-card' },
    h('div', { class: 'today-row' },
      h('div', {},
        h('div', { class: 'today-lbl' }, "Today's follow-ups"),
        h('div', { class: 'today-num' }, String(s.today)),
        h('div', { class: 'today-sub' }, s.today ? `${formatINR(s.amountToday)} premium due today` : 'No premiums due today')),
      h('div', { class: 'today-side' },
        h('div', {}, h('strong', String(s.overdue)), ' overdue'),
        h('div', {}, h('strong', String(s.pending)), ' need follow-up'))),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn light', disabled: !todayIds.length, onclick: () => openMessageSheet(todayIds) }, icon('whatsapp', 18), 'Message today\'s customers'),
      h('button', { class: 'btn light-outline', onclick: () => go('/policies/pending') }, 'Pending list'))));

  root.appendChild(h('h2', { class: 'section-title' }, 'Premium due'));
  root.appendChild(h('div', { class: 'stat-grid' },
    stat('Due today', s.today, 'today', 'hot', 'alert'),
    stat('Due tomorrow', s.tomorrow, 'tomorrow', 'warn', 'clock'),
    stat('Next 3 days', s.next3, 'next3', 'info', 'calendar'),
    stat('Next 7 days', s.next7, 'next7', 'info', 'calendar'),
    stat('Overdue', s.overdue, 'overdue', 'bad', 'alert'),
    stat('This month', s.thisMonth, 'thisMonth', 'plain', 'calendar')));

  root.appendChild(h('h2', { class: 'section-title' }, 'Your book'));
  root.appendChild(h('div', { class: 'stat-grid' },
    h('button', { class: 'stat plain', onclick: () => go('/customers') }, h('div', { class: 'stat-ic' }, icon('users', 20)), h('div', { class: 'stat-val' }, String(state.customers.length)), h('div', { class: 'stat-lbl' }, 'Customers')),
    stat('Policies', s.totalPolicies, 'all', 'plain', 'file'),
    stat('Follow-ups pending', s.pending, 'pending', 'warn', 'clock'),
    stat('Follow-ups completed', s.followupDone, 'followupDone', 'ok', 'check'),
    stat('Payment confirmed', s.paid, 'paid', 'ok', 'rupee'),
    stat('15-day window', s.next15, 'next15', 'plain', 'calendar')));

  // collection summary
  const mc = monthlyCollection(state.policies, state.today);
  root.appendChild(h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', 'Premium collection this month'), h('span', { class: 'muted small' }, 'Confirmed payments only')),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(mc.percent), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { class: 'progress-bar', style: { width: `${mc.percent}%` } })),
    h('div', { class: 'collect' },
      h('div', {}, h('div', { class: 'muted small' }, 'Due'), h('strong', formatINR(mc.dueAmount)), h('div', { class: 'small muted' }, `${mc.dueCount} policies`)),
      h('div', {}, h('div', { class: 'muted small' }, 'Collected'), h('strong', { class: 'txt-ok' }, formatINR(mc.paidAmount)), h('div', { class: 'small muted' }, `${mc.paidCount} paid · ${mc.percent}%`)),
      h('div', {}, h('div', { class: 'muted small' }, 'Pending'), h('strong', { class: 'txt-bad' }, formatINR(mc.pendingAmount)), h('div', { class: 'small muted' }, `${mc.pendingCount} policies`)))));

  // performance
  const week = last7Days();
  const max = Math.max(1, ...week.map((w) => w.n));
  const todayDone = week[week.length - 1].n;
  root.appendChild(h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', 'Daily follow-up performance'), h('span', { class: 'muted small' }, `${todayDone} today`)),
    h('div', { class: 'bars', role: 'img', 'aria-label': `Follow-ups in the last 7 days: ${week.map((w) => w.n).join(', ')}` },
      week.map((w) => h('div', { class: 'bar-col' },
        h('div', { class: 'bar-n' }, String(w.n)),
        h('div', { class: 'bar', style: { height: `${Math.max(4, (w.n / max) * 64)}px` } }),
        h('div', { class: 'bar-d' }, formatDate(w.d).split(' ')[0] + ' ' + formatDate(w.d).split(' ')[1].slice(0, 3))))),
    h('div', { class: 'small muted' }, 'Calls, WhatsApp messages and visits you recorded in the last 7 days.')));
}
