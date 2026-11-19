import test from 'node:test';
import assert from 'node:assert/strict';
import { planNotifications, morningText, notificationId, atTime, HORIZON_DAYS } from '../../public/js/core/notify-plan.js';
import { addDays } from '../../public/js/core/dates.js';

const TODAY = '2026-11-18';
const prefs = { notifEnabled: true, notifTime: '08:00', eveningEnabled: false, eveningTime: '18:00', individualEnabled: false, individualTime: '09:00', individualMaxPerDay: 15, overdueMaxDays: 0 };
const pol = (o) => ({ id: Math.random().toString(36).slice(2), customerName: 'TEST ONE', policyNumber: '990000001', premiumAmount: 1000, mobile: '9000000001', paymentStatus: 'unpaid', followUpStatus: 'pending', dueDate: TODAY, ...o });
const at = (h, m = 0) => new Date(2026, 10, 18, h, m);

test('morning text matches the requested format and counts', () => {
  const t = morningText({ today: 12, next3: 28, next7: 45, overdue: 8, pending: 15 });
  assert.match(t.title, /Good Morning/);
  assert.equal(t.body.split('\n')[0], "Today's Due Policies: 12");
  assert.match(t.body, /Due in Next 3 Days: 28/);
  assert.match(t.body, /Due in Next 7 Days: 45/);
  assert.match(t.body, /Overdue Policies: 8/);
  assert.match(t.body, /Pending Follow-ups: 15/);
  assert.match(t.body, /Please contact your customers and complete your follow-ups\.$/);
});

test('plan: schedules one morning notification per day for the horizon, at the chosen time', () => {
  const policies = [pol({ dueDate: addDays(TODAY, 2) }), pol({ dueDate: addDays(TODAY, 40), policyNumber: '990000002' })];
  const plan = planNotifications({ policies, prefs, now: at(6), today: TODAY });
  assert.equal(plan.length, HORIZON_DAYS);
  assert.ok(plan.every((n) => n.kind === 'morning' && n.at.getHours() === 8 && n.at.getMinutes() === 0));
  assert.equal(new Set(plan.map((n) => n.id)).size, plan.length); // unique ids
});

test('plan: today is skipped once the morning time has already passed', () => {
  const policies = [pol()];
  const after = planNotifications({ policies, prefs, now: at(9), today: TODAY });
  assert.equal(after[0].day, addDays(TODAY, 1));
  const before = planNotifications({ policies, prefs, now: at(7, 59), today: TODAY });
  assert.equal(before[0].day, TODAY);
});

test('plan: each day uses counts calculated for THAT day, so a closed app still shows correct numbers', () => {
  const policies = [pol({ dueDate: addDays(TODAY, 3) })];
  const plan = planNotifications({ policies, prefs, now: at(6), today: TODAY });
  const byDay = Object.fromEntries(plan.map((n) => [n.day, n.largeBody]));
  assert.match(byDay[TODAY], /Today's Due Policies: 0\nDue in Next 3 Days: 1/);
  assert.match(byDay[addDays(TODAY, 3)], /Today's Due Policies: 1/);
  assert.match(byDay[addDays(TODAY, 4)], /Overdue Policies: 1/); // unpaid and past due the next day
});

test('plan: a paid policy stops contributing; notifications are dropped when there is nothing to say', () => {
  const policies = [pol({ dueDate: addDays(TODAY, 1), paymentStatus: 'paid' })];
  assert.equal(planNotifications({ policies, prefs, now: at(6), today: TODAY }).length, 0);
  assert.equal(planNotifications({ policies: [], prefs, now: at(6), today: TODAY }).length, 0);
});

test('plan: disabled notifications schedule nothing; custom time is honoured', () => {
  const policies = [pol()];
  assert.equal(planNotifications({ policies, prefs: { ...prefs, notifEnabled: false }, now: at(6), today: TODAY }).length, 0);
  const p = planNotifications({ policies, prefs: { ...prefs, notifTime: '07:30' }, now: at(6), today: TODAY });
  assert.equal(p[0].at.getHours(), 7);
  assert.equal(p[0].at.getMinutes(), 30);
});

test('plan: optional evening summary and individual reminders', () => {
  const policies = [pol({ customerName: 'A ONE', policyNumber: '990000001', premiumAmount: 500 }), pol({ customerName: 'B TWO', policyNumber: '990000002', premiumAmount: 900 })];
  const plan = planNotifications({ policies, prefs: { ...prefs, eveningEnabled: true, individualEnabled: true }, now: at(6), today: TODAY });
  assert.ok(plan.some((n) => n.kind === 'evening' && n.at.getHours() === 18));
  const indiv = plan.filter((n) => n.kind === 'individual' && n.day === TODAY);
  assert.equal(indiv.length, 2);
  assert.match(indiv[0].title, /B Two/); // highest premium first
  assert.match(indiv[0].body, /990000002/);
  assert.ok(plan.filter((n) => n.kind === 'individual').every((n) => n.day === TODAY)); // nothing due on later days
});

test('plan: individual reminders can hide customer details from the lock screen', () => {
  const plan = planNotifications({ policies: [pol({ customerName: 'SECRET NAME' })], prefs: { ...prefs, notifEnabled: false, individualEnabled: true, hideNotifDetails: true }, now: at(6), today: TODAY });
  assert.ok(plan.length > 0);
  for (const n of plan) assert.doesNotMatch(JSON.stringify(n), /Secret|SECRET|990000001|9000000001/);
});

test('plan: ids are positive 31-bit integers and stable for the same day', () => {
  const id = notificationId('2026-11-18', 1);
  assert.ok(Number.isInteger(id) && id > 0 && id < 2 ** 31);
  assert.equal(id, notificationId('2026-11-18', 1));
  assert.notEqual(id, notificationId('2026-11-19', 1));
  assert.equal(atTime('2026-11-18', '08:05').getMinutes(), 5);
});
