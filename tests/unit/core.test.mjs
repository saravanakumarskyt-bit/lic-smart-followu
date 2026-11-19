import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../public/js/core/dates.js';
import * as V from '../../public/js/core/validate.js';
import * as U from '../../public/js/core/due.js';
import * as M from '../../public/js/core/messages.js';
import * as C from '../../public/js/core/csv.js';
import * as X from '../../public/js/core/crypto.js';
import { groupCustomers } from '../../public/js/core/customers.js';

const TODAY = '2026-11-18';
const ctx = { today: TODAY, overdueMaxDays: 0 };
const pol = (o) => ({ id: Math.random().toString(36).slice(2), customerName: 'Test One', policyNumber: '990000001', premiumAmount: 1000, dueDate: TODAY, mobile: '9000000001', paymentStatus: 'unpaid', followUpStatus: 'pending', ...o });

// ---------- dates ----------
test('dates: validity, leap years and day arithmetic', () => {
  assert.equal(D.makeISO(2026, 2, 31), null);
  assert.equal(D.makeISO(2028, 2, 29), '2028-02-29');
  assert.equal(D.makeISO(2027, 2, 29), null);
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.diffDays('2026-11-18', '2026-11-25'), 7);
  assert.equal(D.diffDays('2026-11-18', '2026-11-10'), -8);
  assert.equal(D.todayISO(new Date(2026, 10, 18, 23, 59)), '2026-11-18');
  assert.equal(D.todayISO(new Date(2026, 10, 18, 0, 1)), '2026-11-18');
});

test('dates: findDates reads Indian dd-mm-yyyy, month names, ISO, and flags impossible dates', () => {
  assert.equal(D.parseDate('18-11-2026'), '2026-11-18');
  assert.equal(D.parseDate('03/04/2026'), '2026-04-03'); // dd/mm
  assert.equal(D.parseDate('15 Dec 2026'), '2026-12-15');
  assert.equal(D.parseDate('17-Dec-2026'), '2026-12-17');
  assert.equal(D.parseDate('2026-12-01'), '2026-12-01');
  assert.equal(D.parseDate('5.1.27'), '2027-01-05');
  assert.equal(D.parseDate('31-02-2026'), null);
  assert.equal(D.findDates('31-02-2026')[0].iso, null);
  assert.equal(D.parseDate('990000011'), null); // a policy number is not a date
});

test('dates: month grid starts on Sunday and has full weeks', () => {
  const g = D.monthGrid(2026, 11); // 1 Nov 2026 is a Sunday
  assert.equal(g[0][0], '2026-11-01');
  assert.ok(g.every((w) => w.length === 7));
  assert.equal(g.flat().filter(Boolean).length, 30);
});

// ---------- validation ----------
test('validate: policy numbers, mobiles and amounts', () => {
  assert.equal(V.normalizePolicyNumber('990 000 011'), '990000011');
  assert.equal(V.normalizePolicyNumber('abc'), '');
  assert.deepEqual(V.findMobiles('Mob: +91 90000 00021 and 9000000022'), ['9000000021', '9000000022']);
  assert.equal(V.normalizeMobile('1234567890'), '');
  assert.equal(V.parseAmount('Rs. 12,500/-'), 12500);
  assert.equal(V.parseAmount('₹1,25,000.50'), 125000.5);
  assert.equal(V.parseAmount('abc'), null);
  assert.equal(V.toTitleCase('RAMESH KUMAR'), 'Ramesh Kumar');
  assert.equal(V.toTitleCase('Ramesh kumar'), 'Ramesh kumar');
});

test('validate: errors block saving, warnings only inform', () => {
  const good = V.validatePolicy({ customerName: 'A', policyNumber: '990000011', dueDate: '2026-11-18', premiumAmount: 10, mobile: '9000000001' });
  assert.deepEqual(good.errors, {});
  const noMobile = V.validatePolicy({ customerName: 'A', policyNumber: '990000011', dueDate: '2026-11-18', premiumAmount: 10, mobile: '' });
  assert.deepEqual(noMobile.errors, {});
  assert.ok(noMobile.warnings.mobile);
  const badDate = V.validatePolicy({ customerName: 'A', policyNumber: '990000011', dueDate: '2026-02-31', premiumAmount: 10 });
  assert.ok(badDate.errors.dueDate);
  const badPol = V.validatePolicy({ customerName: 'A', policyNumber: '12', dueDate: '2026-11-18' });
  assert.ok(badPol.errors.policyNumber);
});

// ---------- due engine ----------
test('due: every category boundary is correct for a fixed device date (today = 2026-11-18)', () => {
  // [due date, days from today, expected categories]
  const cases = [
    ['2026-11-18', 0, ['today', 'thisMonth', 'pending']],
    ['2026-11-19', 1, ['tomorrow', 'next3', 'next7', 'next15', 'thisMonth', 'pending']],
    ['2026-11-21', 3, ['next3', 'next7', 'next15', 'thisMonth', 'pending']],
    ['2026-11-22', 4, ['next7', 'next15', 'thisMonth', 'pending']],
    ['2026-11-25', 7, ['next7', 'next15', 'thisMonth', 'pending']],
    ['2026-11-26', 8, ['next15', 'thisMonth']],
    ['2026-12-03', 15, ['next15']],
    ['2026-12-04', 16, []],
    ['2026-11-17', -1, ['overdue', 'pending', 'thisMonth']],
    ['2026-10-01', -48, ['overdue', 'pending']],
  ];
  for (const [due, n, expected] of cases) {
    assert.equal(D.diffDays(TODAY, due), n);
    assert.deepEqual(U.categoriesOf(pol({ dueDate: due }), ctx).sort(), [...expected].sort(), `due ${due}`);
  }
});

test('due: "this month" uses the calendar month of the device date', () => {
  assert.equal(U.inCategory(pol({ dueDate: '2026-11-30' }), 'thisMonth', ctx), true);
  assert.equal(U.inCategory(pol({ dueDate: '2026-12-01' }), 'thisMonth', ctx), false);
  assert.equal(U.inCategory(pol({ dueDate: '2026-11-01' }), 'thisMonth', ctx), true);
});

test('due: a past due date never marks a policy paid; only user confirmation does', () => {
  const old = pol({ dueDate: '2026-01-05' });
  assert.equal(U.isPaid(old), false);
  assert.equal(U.inCategory(old, 'overdue', ctx), true);
  assert.equal(U.inCategory(old, 'paid', ctx), false);
  const confirmed = pol({ dueDate: '2026-01-05', paymentStatus: 'paid' });
  assert.equal(U.inCategory(confirmed, 'overdue', ctx), false);
  assert.equal(U.inCategory(confirmed, 'paid', ctx), true);
  assert.equal(U.inCategory(pol({ dueDate: TODAY, paymentStatus: 'paid' }), 'today', ctx), false);
});

test('due: follow-up completed leaves the pending list but stays overdue until paid', () => {
  const p = pol({ dueDate: '2026-11-10', followUpStatus: 'completed' });
  assert.equal(U.inCategory(p, 'pending', ctx), false);
  assert.equal(U.inCategory(p, 'followupDone', ctx), true);
  assert.equal(U.inCategory(p, 'overdue', ctx), true);
});

test('due: contacting a customer today clears them from today\'s pending list, and they return tomorrow if still unpaid', () => {
  const p = pol({ dueDate: '2026-11-20', followUpStatus: 'contacted', lastFollowUpDate: TODAY });
  assert.equal(U.inCategory(p, 'pending', ctx), false);
  assert.equal(U.inCategory(p, 'pending', { today: '2026-11-19', overdueMaxDays: 0 }), true);
  const promised = pol({ dueDate: '2026-11-20', followUpStatus: 'promised', lastFollowUpDate: TODAY });
  assert.equal(U.inCategory(promised, 'pending', ctx), false);
  assert.equal(U.inCategory(pol({ dueDate: '2026-11-20', followUpStatus: 'contacted', lastFollowUpDate: '2026-11-10' }), 'pending', ctx), true);
});

test('due: overdue window preference hides very old records from "overdue" only when the user sets a limit', () => {
  const p = pol({ dueDate: '2026-08-01' });
  assert.equal(U.inCategory(p, 'overdue', { today: TODAY, overdueMaxDays: 0 }), true);
  assert.equal(U.inCategory(p, 'overdue', { today: TODAY, overdueMaxDays: 60 }), false);
  assert.equal(U.bucketOf(p, { today: TODAY, overdueMaxDays: 60 }), 'stale');
});

test('due: summary counts for the dashboard and the notification', () => {
  const list = [
    pol({ policyNumber: '990000001', dueDate: TODAY, premiumAmount: 100 }),
    pol({ policyNumber: '990000002', dueDate: D.addDays(TODAY, 1) }),
    pol({ policyNumber: '990000003', dueDate: D.addDays(TODAY, 3) }),
    pol({ policyNumber: '990000004', dueDate: D.addDays(TODAY, 6) }),
    pol({ policyNumber: '990000005', dueDate: D.addDays(TODAY, -2), premiumAmount: 50 }),
    pol({ policyNumber: '990000006', dueDate: D.addDays(TODAY, -2), paymentStatus: 'paid' }),
    pol({ policyNumber: '990000001', dueDate: D.addDays(TODAY, 365) }),
  ];
  const s = U.summarize(list, ctx);
  assert.equal(s.today, 1);
  assert.equal(s.tomorrow, 1);
  assert.equal(s.next3, 2);
  assert.equal(s.next7, 3);
  assert.equal(s.overdue, 1);
  assert.equal(s.paid, 1);
  assert.equal(s.totalRecords, 7);
  assert.equal(s.totalPolicies, 6); // distinct policy numbers
  assert.equal(s.amountToday, 100);
  assert.equal(s.amountOverdue, 50);
});

test('due: monthly collection counts only user-confirmed payments', () => {
  const list = [
    pol({ dueDate: '2026-11-05', premiumAmount: 1000, paymentStatus: 'paid' }),
    pol({ dueDate: '2026-11-20', premiumAmount: 3000 }),
    pol({ dueDate: '2026-12-01', premiumAmount: 9999 }),
  ];
  const c = U.monthlyCollection(list, TODAY);
  assert.equal(c.dueCount, 2);
  assert.equal(c.paidAmount, 1000);
  assert.equal(c.pendingAmount, 3000);
  assert.equal(c.percent, 50);
});

test('due: search by name, policy number and mobile; sorting by premium', () => {
  const a = pol({ customerName: 'Ramesh Kumar', policyNumber: '990000011', mobile: '9000000001', premiumAmount: 500 });
  const b = pol({ customerName: 'Lakshmi', policyNumber: '990000022', mobile: '9000000002', premiumAmount: 900 });
  assert.equal(U.matchesQuery(a, 'ramesh'), true);
  assert.equal(U.matchesQuery(a, '990000011'), true);
  assert.equal(U.matchesQuery(a, '99000001'), true);
  assert.equal(U.matchesQuery(a, '90000 00001'), true);
  assert.equal(U.matchesQuery(b, '9000000001'), false);
  assert.deepEqual(U.sortPolicies([a, b], 'amount_desc').map((x) => x.premiumAmount), [900, 500]);
});

// ---------- customers ----------
test('customers: multiple policies of one customer are grouped; same name with different mobiles is not merged', () => {
  const list = [
    pol({ id: '1', customerName: 'RAMESH KUMAR', policyNumber: '990000011', mobile: '9000000001' }),
    pol({ id: '2', customerName: 'Ramesh Kumar', policyNumber: '990000077', mobile: '9000000001' }),
    pol({ id: '3', customerName: 'Ramesh Kumar', policyNumber: '990000099', mobile: '' }),
    pol({ id: '4', customerName: 'Ramesh Kumar', policyNumber: '990000100', mobile: '9000000009' }),
    pol({ id: '5', customerName: 'Lakshmi', policyNumber: '990000022', mobile: '9000000002' }),
  ];
  const cs = groupCustomers(list);
  assert.equal(cs.length, 3);
  const r1 = cs.find((c) => c.mobile === '9000000001');
  assert.equal(r1.policies.length, 3); // the one without a mobile joins the larger group
  assert.equal(cs.find((c) => c.mobile === '9000000009').policies.length, 1);
});

// ---------- messages ----------
test('messages: template selection by days remaining', () => {
  assert.equal(M.chooseTemplate(-3), 'overdue');
  assert.equal(M.chooseTemplate(0), 'today');
  assert.equal(M.chooseTemplate(1), 'tomorrow');
  assert.equal(M.chooseTemplate(3), 'days3');
  assert.equal(M.chooseTemplate(5), 'days7');
  assert.equal(M.chooseTemplate(7), 'days7');
  assert.equal(M.chooseTemplate(20), 'general');
});

test('messages: Indian rupee formatting', () => {
  assert.equal(M.formatINR(12500), '₹12,500');
  assert.equal(M.formatINR(125000), '₹1,25,000');
  assert.equal(M.formatINR(12345678), '₹1,23,45,678');
  assert.equal(M.formatINR(2450.5), '₹2,450.50');
  assert.equal(M.formatINR(999), '₹999');
});

test('messages: English message has name, amount, date; signature only with a profile', () => {
  const p = pol({ customerName: 'RAMESH KUMAR', premiumAmount: 12500, dueDate: '2026-11-21' });
  const noProfile = M.buildMessage({ policy: p, lang: 'en', today: TODAY });
  assert.match(noProfile, /Dear Ramesh Kumar,/);
  assert.match(noProfile, /₹12,500/);
  assert.match(noProfile, /21 Nov 2026/);
  assert.doesNotMatch(noProfile, /Regards/);
  const withProfile = M.buildMessage({ policy: p, lang: 'en', today: TODAY, profile: { advisorName: 'Test Advisor', mobile: '9000000099' } });
  assert.match(withProfile, /Regards,\nTest Advisor\nLIC Insurance Advisor$/);
  assert.match(withProfile, /9000000099/);
});

test('messages: all six templates exist in both languages and differ from each other', () => {
  const p = pol({ dueDate: TODAY });
  for (const lang of ['en', 'ta']) {
    const texts = M.TEMPLATES.map((t) => M.buildMessage({ policy: p, lang, template: t.id, today: TODAY }));
    assert.equal(new Set(texts).size, 6, `${lang}: six distinct templates`);
    for (const t of texts) assert.ok(!/undefined|NaN|\[object/.test(t));
  }
  const ta = M.buildMessage({ policy: p, lang: 'ta', template: 'today', today: TODAY, profile: { advisorName: 'Test Advisor' } });
  assert.match(ta, /[஀-௿]/);
  assert.match(ta, /LIC காப்பீட்டு முகவர்/);
});

test('messages: overdue wording reports the number of days and never claims payment was made', () => {
  const m = M.buildMessage({ policy: pol({ dueDate: '2026-11-10' }), lang: 'en', today: TODAY });
  assert.match(m, /8 days overdue/);
  assert.match(m, /still pending/);
});

test('messages: missing amount or name never produces broken text', () => {
  const m = M.buildMessage({ policy: pol({ customerName: '', premiumAmount: null, dueDate: TODAY }), lang: 'en', today: TODAY });
  assert.match(m, /Dear Customer,/);
  assert.doesNotMatch(m, /null|undefined/);
});

test('messages: WhatsApp links', () => {
  assert.equal(M.whatsappNumber('9000000001'), '919000000001');
  assert.equal(M.whatsappNumber('+91 90000 00001'), '919000000001');
  assert.equal(M.whatsappNumber('09000000001'), '919000000001');
  assert.equal(M.whatsappNumber('12345'), '');
  const u = M.whatsappUrl('9000000001', 'Hi ₹5 & more');
  assert.equal(u, 'https://wa.me/919000000001?text=' + encodeURIComponent('Hi ₹5 & more'));
});

// ---------- csv ----------
test('csv: round trip with commas, quotes, newlines and Tamil text', () => {
  const rows = [['a', 'b,c', 'd"e', 'line1\nline2', 'தமிழ்']];
  const back = C.parseCSV(C.toCSV(rows));
  assert.deepEqual(back, rows);
});

test('csv: delimiter detection, BOM and blank lines', () => {
  assert.deepEqual(C.parseCSV('﻿a;b;c\r\n1;2;3\r\n\r\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(C.parseCSV('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('csv: formula-injection protection on export and restore on import', () => {
  assert.equal(C.safeCell('=1+1'), "'=1+1");
  assert.equal(C.safeCell('Normal'), 'Normal');
  assert.equal(C.unsafeCell("'=1+1"), '=1+1');
  const out = C.policiesToCSV([pol({ customerName: '=HYPERLINK("x")' })]);
  assert.match(out, /'=HYPERLINK/);
});

// ---------- crypto ----------
test('crypto: encrypted backup round trip, wrong password and tampering are rejected', async () => {
  const plain = JSON.stringify({ hello: 'தமிழ் ₹', n: 1 });
  const env = await X.encryptString(plain, 'correct horse', { iterations: 1000 });
  assert.equal(X.isEncryptedEnvelope(env), true);
  assert.ok(!JSON.stringify(env).includes('hello'));
  assert.equal(await X.decryptEnvelope(env, 'correct horse'), plain);
  await assert.rejects(() => X.decryptEnvelope(env, 'wrong'), /Wrong password/);
  const tampered = { ...env, data: env.data.slice(0, -4) + 'AAAA' };
  await assert.rejects(() => X.decryptEnvelope(tampered, 'correct horse'), /Wrong password or damaged/);
  const again = await X.encryptString(plain, 'correct horse', { iterations: 1000 });
  assert.notEqual(again.data, env.data); // fresh salt and IV every time
});

// ---------- csv import ----------
import { csvToRecords } from '../../public/js/core/csvimport.js';

test('csv import: our own export round-trips, including paid and follow-up state', () => {
  const src = [
    pol({ customerName: 'RAMESH KUMAR', policyNumber: '990000011', dueDate: '2026-11-18', premiumAmount: 12500, paymentStatus: 'paid', paidDate: '2026-11-17', followUpStatus: 'completed', notes: 'Likes calls, after 6pm' }),
    pol({ customerName: '=Evil()', policyNumber: '990000022', dueDate: '2026-12-01', premiumAmount: 5000 }),
  ];
  const r = csvToRecords(C.policiesToCSV(src));
  assert.equal(r.headerFound, true);
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].policyNumber, '990000011');
  assert.equal(r.records[0].dueDate, '2026-11-18');
  assert.equal(r.records[0].paymentStatus, 'paid');
  assert.equal(r.records[0].followUpStatus, 'completed');
  assert.equal(r.records[0].notes, 'Likes calls, after 6pm');
  assert.equal(r.records[1].customerName, '=Evil()'); // sanitiser reversed on import, never executed
});

test('csv import: foreign column names and Indian date formats; bad rows are reported not guessed', () => {
  const csv = 'Sl No,Policy No,Name of Policyholder,FUP,Premium,Mobile No\n1,990000011,RAMESH KUMAR,18-11-2026,"12,500",90000 00001\n2,990000022,LAKSHMI,31-02-2026,5000,\n3,,NO POLICY,18-11-2026,100,\n';
  const r = csvToRecords(csv);
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].premiumAmount, 12500);
  assert.equal(r.records[0].mobile, '9000000001');
  assert.equal(r.records[1].dueDate, '');
  assert.ok(r.records[1].errors.dueDate);
  assert.equal(r.skipped.length, 1);
});

// ---------- report ----------
import { buildReportHTML, escapeHtml, customersToCSV } from '../../public/js/core/report.js';

test('report: customer-supplied text is HTML-escaped (a hostile PDF cannot inject script into the report)', () => {
  const evil = pol({ customerName: '<img src=x onerror=alert(1)>', dueDate: TODAY });
  const html = buildReportHTML({ policies: [evil], customers: groupCustomers([evil]), today: TODAY });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(escapeHtml(`"'&<>`), '&quot;&#39;&amp;&lt;&gt;');
});

test('report: sections and customer CSV', () => {
  const list = [pol({ dueDate: TODAY, policyNumber: '990000011' }), pol({ dueDate: '2026-11-01', policyNumber: '990000022' })];
  const html = buildReportHTML({ policies: list, customers: groupCustomers(list), today: TODAY, profile: { advisorName: 'Test Advisor' } });
  assert.match(html, /Due today \(1\)/);
  assert.match(html, /Overdue \(1\)/);
  assert.match(html, /Test Advisor/);
  const csv = customersToCSV(groupCustomers(list));
  assert.match(csv, /^Customer,Mobile,Policies/);
});

import { commissionForPayment, commissionSummary } from '../../public/js/core/due.js';
import { safeLogo } from '../../public/js/core/db.js';

test('commission: proportional to the amount paid, capped at the estimate, null without an estimate', () => {
  const p = { estCommission: 1164.8, totalPremium: 5824, premiumAmount: 832 };
  assert.equal(commissionForPayment(p, 832), 166.4);
  assert.equal(commissionForPayment(p, 5824), 1164.8);
  assert.equal(commissionForPayment(p, 99999), 1164.8, 'never more than the estimate');
  assert.equal(commissionForPayment({ premiumAmount: 500 }, 500), null);
  assert.equal(commissionForPayment({ estCommission: 100 }, 500), 100, 'no total on the list: estimate as given');
});

test('commission summary counts earned only from confirmed payments; pending is an estimate on unpaid policies', () => {
  const ps = [
    { paymentStatus: 'paid', paidDate: '2026-11-10', commissionEarned: 166.4, dueDate: '2026-11-01' },
    { paymentStatus: 'paid', paidDate: '2026-10-10', commissionEarned: 100, dueDate: '2026-10-01' },
    { paymentStatus: 'unpaid', estCommission: 500, dueDate: '2026-11-05' },
    { paymentStatus: 'unpaid', dueDate: '2026-11-06' },
  ];
  const s = commissionSummary(ps, '2026-11-18');
  assert.equal(s.earnedMonth, 166.4); assert.equal(s.earnedTotal, 266.4); assert.equal(s.pendingEstimate, 500); assert.equal(s.pendingCount, 1);
});

test('logo: only small embedded raster images are accepted', () => {
  assert.equal(safeLogo('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(safeLogo('data:image/svg+xml;base64,PHN2Zz4='), '');
  assert.equal(safeLogo('https://example.com/x.png'), '');
  assert.equal(safeLogo('javascript:alert(1)'), '');
});
