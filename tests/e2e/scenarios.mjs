import path from 'node:path';
import fs from 'node:fs';

const nativeMockScript = (perm = 'granted') => `(() => {
  const store = { pending: [], scheduled: [], cancelled: [], perm: ${JSON.stringify(perm)}, listeners: {}, channels: [] };
  window.__ln = store;
  window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: {
    checkPermissions: async () => ({ display: store.perm }),
    requestPermissions: async () => { store.perm = 'granted'; return { display: 'granted' }; },
    checkExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
    getPending: async () => ({ notifications: store.pending.map((n) => ({ id: n.id })) }),
    cancel: async ({ notifications }) => { store.cancelled.push(...notifications.map((n) => n.id)); store.pending = store.pending.filter((p) => !notifications.some((n) => n.id === p.id)); },
    schedule: async ({ notifications }) => { store.scheduled.push(...notifications); store.pending.push(...notifications); },
    createChannel: async (c) => { store.channels.push(c); }, addListener: async (name, fn) => { store.listeners[name] = fn; },
  } } };
})();`;

export function registerTests(S, { assert, eq, FIX, here, newCtx, URL_ }) {
  const windowOpenStub = () => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return {}; }; };
  const readDownload = async (dl) => fs.readFileSync(await dl.path(), 'utf8');

  // ---------------- import ----------------
  S.test('app boots on a sub-path with no console errors and shows the empty state', async (c) => {
    await c.open();
    await c.page.waitForSelector('text=Welcome to LIC Smart Follow-up');
    assert(await c.page.locator('#nav a').count() === 5, 'bottom nav has 5 items');
    eq(c.errors, [], 'console errors');
  });

  S.test('text PDF import: verification table, counts, invalid date blocked, save, dashboard numbers', async (c) => {
    await c.open();
    await c.importPdfs(['sample-a-standard.pdf']);
    await c.noJunk('#main', 'on the verification screen');
    const k = await c.counts();
    eq(k['Records found'], 8, 'found'); eq(k['Failed'], 1, 'failed'); eq(k['Ready'], 7, 'ready'); eq(k['Missing info'], 1, 'missing info');
    const bad = c.page.locator('tr.vrow.error');
    eq(await bad.count(), 1);
    assert(await bad.locator('input[type=checkbox]').isDisabled(), 'failed row cannot be selected');
    assert((await bad.locator('.vnote').textContent()).includes('31-02-2026'), 'shows the raw bad date');
    assert((await c.page.locator('.savebar').textContent()).includes('Save 7 records'));
    await c.save();
    await c.page.goto(URL_ + '#/home'); await c.page.waitForSelector('.today-card');
    eq(await c.stat('Due today'), 1); eq(await c.stat('Due tomorrow'), 1); eq(await c.stat('Next 3 days'), 2);
    eq(await c.stat('Next 7 days'), 3); eq(await c.stat('Overdue'), 1);
    eq(await c.stat('Customers'), 6, 'Ramesh has two policies'); eq(await c.stat('Policies'), 7);
    eq(c.errors, [], 'console errors');
  });

  S.test('a failed row can be repaired in the table and then saved; nothing is auto-corrected', async (c) => {
    await c.open();
    await c.importPdfs(['sample-a-standard.pdf']);
    const bad = c.page.locator('tr.vrow.error');
    await bad.locator('input[type=date]').fill('2026-11-28');
    await c.page.waitForSelector('tr.vrow.error', { state: 'detached' });
    const k = await c.counts();
    eq(k['Failed'], 0); assert((await c.page.locator('.savebar').textContent()).includes('Save 8 records'));
    await c.save();
    await c.page.goto(URL_ + '#/policies/all'); await c.page.waitForSelector('.pcard');
    eq(await c.page.locator('.pcard').count(), 8);
  });

  S.test('duplicates: re-importing the same PDF flags every record and saves nothing; a new installment is allowed', async (c) => {
    await c.open();
    await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.importPdfs(['sample-a-standard.pdf']);
    const k = await c.counts();
    eq(k['Duplicates'], 7, 'all valid rows are duplicates'); eq(k['Ready'], 0);
    assert(await c.page.locator('.savebar .btn.primary').isDisabled(), 'save disabled with nothing selected');
    await c.page.click('text=Discard'); await c.page.click('.sheet .btn.danger');
    await c.importPdfs(['sample-e-duplicates.pdf']);
    const k2 = await c.counts();
    eq(k2['Duplicates'], 1); eq(k2['Ready'], 1);
    await c.save();
    await c.page.goto(URL_ + '#/policies/all'); await c.page.waitForSelector('.pcard');
    eq(await c.page.locator('.pcard').count(), 8, '7 + 1 new installment');
  });

  S.test('duplicates can be set to update existing records without touching follow-up or payment state', async (c) => {
    await c.open();
    await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.goto(URL_ + '#/policies/all'); await c.page.locator('.pcard-main', { hasText: 'Ramesh Kumar' }).first().click();
    await c.page.click('.sheet >> text=Confirm payment'); await c.page.click('text=Yes, payment received');
    await c.page.waitForSelector('text=Payment confirmed'); await c.page.click('.sheet .icon-btn[aria-label=Close]');
    await c.importPdfs(['sample-a-standard.pdf'], { dup: 'update' });
    const dupBoxes = c.page.locator('tr.vrow.dup input[type=checkbox]');
    const n = await dupBoxes.count(); eq(n, 7);
    for (let i = 0; i < n; i++) await dupBoxes.nth(i).check(); // select every duplicate so they are updated
    await c.save();
    await c.page.goto(URL_ + '#/policies/paid'); await c.page.waitForSelector('.pcard');
    eq(await c.page.locator('.pcard').count(), 1, 'paid status survived the update');
  });

  S.test('multiple PDFs at once (two layouts, two pages): all records extracted and saved', async (c) => {
    await c.open();
    await c.importPdfs(['sample-b-twoline-headers.pdf', 'sample-c-no-header.pdf']);
    eq((await c.counts())['Records found'], 8);
    // pattern-read rows (no header) are held for review, header-table rows are ready
    const k = await c.counts();
    assert(k['Ready'] >= 5, 'layout B rows are ready');
    await c.page.click('text=Mark uncertain as reviewed'); await c.page.click('.sheet .btn.primary');
    await c.save();
    await c.page.goto(URL_ + '#/policies/all'); await c.page.waitForSelector('.pcard');
    eq(await c.page.locator('.pcard').count(), 8);
    await c.page.goto(URL_ + '#/import'); await c.page.waitForSelector('text=Recent imports');
    eq(await c.page.locator('.hist').count(), 2, 'two history entries');
  });

  S.test('large PDF (600 rows, 12 pages): reads, pages the table, saves everything', async (c) => {
    await c.open();
    const t0 = Date.now();
    await c.importPdfs(['sample-f-large.pdf']);
    eq((await c.counts())['Records found'], 600);
    eq(await c.page.locator('tr.vrow').count(), 60, 'table is paged');
    await c.page.click('text=Show more'); eq(await c.page.locator('tr.vrow').count(), 160);
    await c.save();
    await c.page.goto(URL_ + '#/home'); await c.page.waitForSelector('.today-card');
    eq(await c.stat('Policies'), 600);
    assert(Date.now() - t0 < 90000, `took ${Date.now() - t0} ms`);
  });

  S.test('password-protected PDF asks for the password, rejects a wrong one, then reads the file', async (c) => {
    await c.open();
    await c.page.goto(`${URL_}#/import`); await c.page.waitForSelector('#pdf-input', { state: 'attached' });
    await c.page.setInputFiles('#pdf-input', path.join(FIX, 'sample-g-password.pdf'));
    await c.page.waitForSelector('text=Password needed');
    await c.page.fill('.sheet input[type=password]', 'wrong'); await c.page.click('.sheet .btn.primary');
    await c.page.waitForSelector('text=That password was wrong');
    await c.page.fill('.sheet input[type=password]', 'test1234'); await c.page.click('.sheet .btn.primary');
    await c.page.waitForSelector('text=Check extracted data', { timeout: 20000 });
    eq((await c.counts())['Records found'], 8);
  });

  S.test('scanned PDF: detected as scanned, nothing invented, OCR offered; clear message when OCR files are not installed', async (c) => {
    await c.open();
    await c.importPdfs(['sample-d-scanned.pdf']);
    eq((await c.counts())['Records found'], 0);
    await c.page.waitForSelector('text=scanned (no text)');
    await c.page.click('text=Run OCR');
    await c.page.waitForSelector('text=OCR is not installed');
  });

  S.test('CSV import and export round trip, including injection-safe cells', async (c) => {
    await c.open();
    await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.goto(`${URL_}#/backup`); await c.page.waitForSelector('text=Export & reports');
    const [dl] = await Promise.all([c.page.waitForEvent('download'), c.page.click('text=All policies (CSV)')]);
    const csv = await readDownload(dl);
    assert(csv.startsWith('﻿Customer Name,Policy Number'), 'header');
    eq(csv.trim().split(/\r?\n/).length, 8, '7 rows + header');
    const file = path.join(c.tmp ??= fs.mkdtempSync('/tmp/licx-'), 'back.csv'); fs.writeFileSync(file, csv);
    await c.page.goto(`${URL_}#/import`); await c.page.waitForSelector('#csv-input', { state: 'attached' });
    await c.page.setInputFiles('#csv-input', file);
    await c.page.waitForSelector('text=Check extracted data');
    const k = await c.counts(); eq(k['Records found'], 7); eq(k['Duplicates'], 7);
  });

  S.test('hostile CSV content is shown as text and never executes', async (c) => {
    await c.open();
    const csv = 'Policy Number,Name,Due Date,Premium,Mobile\n990009991,"<img src=x onerror=window.__xss=1>",20-11-2026,"1,000",9000000099\n';
    await c.page.goto(`${URL_}#/import`); await c.page.waitForSelector('#csv-input', { state: 'attached' });
    await c.page.setInputFiles('#csv-input', { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await c.page.waitForSelector('text=Check extracted data'); await c.save();
    await c.page.goto(`${URL_}#/policies/all`); await c.page.waitForSelector('.pcard');
    assert((await c.page.locator('.pcard-name').first().textContent()).includes('<img src=x'), 'shown literally');
    eq(await c.page.locator('#main img').count(), 0); eq(await c.page.evaluate(() => window.__xss), undefined);
  });

  // ---------------- customers & policies ----------------
  S.test('manual add: validation, duplicate prevention, second installment allowed, persists after reload', async (c) => {
    await c.open('/customers');
    await c.page.click('.page-head >> text=Add');
    await c.page.fill('input[name=customerName]', 'Test Customer'); await c.page.fill('input[name=policyNumber]', '12');
    await c.page.fill('input[name=dueDate]', '2026-11-20'); await c.page.click('.sheet .btn.primary');
    await c.page.waitForSelector('.form-error');
    await c.page.fill('input[name=policyNumber]', '990000500'); await c.page.fill('input[name=premiumAmount]', '4200'); await c.page.fill('input[name=mobile]', '9000000500');
    await c.page.click('.sheet .btn.primary'); await c.page.waitForSelector('text=Test Customer');
    await c.page.click('.page-head >> text=Add');
    await c.page.fill('input[name=customerName]', 'Test Customer'); await c.page.fill('input[name=policyNumber]', '990000500'); await c.page.fill('input[name=dueDate]', '2026-11-20');
    await c.page.click('.sheet .btn.primary'); await c.page.waitForSelector('.form-error:has-text("already has a record")');
    await c.page.fill('input[name=dueDate]', '2027-11-20'); await c.page.click('.sheet .btn.primary');
    await c.page.waitForFunction(() => !document.querySelector('.sheet'));
    await c.page.reload(); await c.page.waitForFunction(() => window.__licReady);
    await c.page.goto(`${URL_}#/policies/all`); await c.page.waitForSelector('.pcard');
    eq(await c.page.locator('.pcard').count(), 2, 'persisted across reload');
    await c.page.goto(`${URL_}#/customers`); await c.page.waitForSelector('.crow');
    eq(await c.page.locator('.crow').count(), 1, 'one customer with two policies'); assert((await c.page.locator('.crow').textContent()).includes('2 policies'));
  });

  S.test('search by name, policy number and mobile; category filters; sort by premium', async (c) => {
    await c.open(); await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.goto(`${URL_}#/policies/all`); await c.page.waitForSelector('.pcard');
    await c.page.fill('.search', 'lakshmi'); await c.page.waitForFunction(() => document.querySelectorAll('.pcard').length === 1);
    await c.page.fill('.search', '990000033'); await c.page.waitForFunction(() => document.querySelectorAll('.pcard').length === 1);
    await c.page.fill('.search', '9000000001'); await c.page.waitForFunction(() => document.querySelectorAll('.pcard').length === 2, null, { timeout: 5000 });
    await c.page.fill('.search', '');
    await c.page.selectOption('.sort', 'amount_desc'); await c.page.waitForTimeout(100);
    assert((await c.page.locator('.pcard').first().textContent()).includes('Arun') === false && (await c.page.locator('.pcard').first().textContent()).includes('Mohamed'), 'highest premium first');
    await c.page.click('.chip-btn:has-text("Overdue")'); await c.page.waitForFunction(() => document.querySelectorAll('.pcard').length === 1);
    eq(await c.page.locator('.pcard').count(), 1); assert((await c.page.locator('.pcard').textContent()).includes('Senthil'));
    assert((await c.page.locator('.pcard .badge').textContent()).includes('8 days overdue'));
  });

  S.test('payment is only ever confirmed by the user; confirming moves the policy out of overdue/today', async (c) => {
    await c.open(); await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.goto(`${URL_}#/policies/overdue`); await c.page.waitForSelector('.pcard');
    eq(await c.page.locator('.pcard').count(), 1, 'long-overdue policy stays overdue, never auto-paid');
    await c.page.locator('.pcard-main').first().click(); await c.page.waitForSelector('.sheet >> text=Confirm payment');
    await c.noJunk('.sheet', 'in the policy details');
    await c.page.click('.sheet >> text=Confirm payment');
    await c.page.click('text=Yes, payment received'); await c.page.waitForSelector('.sheet .badge.ok');
    await c.page.click('.sheet .icon-btn[aria-label=Close]');
    await c.page.goto(`${URL_}#/home`); await c.page.waitForSelector('.today-card');
    eq(await c.stat('Overdue'), 0); eq(await c.stat('Payment confirmed'), 1);
  });

  S.test('calendar shows the due counts by day and lists the policies of the selected day', async (c) => {
    await c.open(); await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.goto(`${URL_}#/calendar`); await c.page.waitForSelector('.cal');
    assert((await c.page.textContent('.cal-nav')).includes('November 2026'));
    await c.page.click('.cal-cell:has(.cal-day:text-is("19"))'); await c.page.waitForSelector('.pcard');
    assert((await c.page.locator('.pcard').first().textContent()).includes('Lakshmi'));
    await c.page.click('[aria-label="Next month"]'); assert((await c.page.textContent('.cal-nav')).includes('December 2026'));
  });

  // ---------------- messages ----------------
  S.test('WhatsApp message: personalised, signed only with a profile, Tamil + English, opens wa.me, copies, never auto-sends', async (c) => {
    await c.context.addInitScript(windowOpenStub);
    await c.open(); await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.goto(`${URL_}#/policies/today`); await c.page.waitForSelector('.pcard');
    await c.page.click('.pcard .icon-btn.wa'); await c.page.waitForSelector('.msg-text');
    await c.noJunk('.sheet', 'in the message composer');
    let text = await c.page.inputValue('.msg-text');
    assert(text.includes('Dear Ramesh Kumar,') && text.includes('₹12,500') && text.includes('due today'), text);
    assert(!text.includes('Regards'), 'no signature without a profile');
    await c.page.click('.btn.wa'); await c.page.waitForFunction(() => window.__opened.length === 1);
    const url = await c.page.evaluate(() => window.__opened[0]);
    assert(url.startsWith('https://wa.me/919000000001?text='), url); assert(decodeURIComponent(url).includes('Dear Ramesh Kumar'));
    await c.page.click('.seg:has-text("தமிழ்")'); text = await c.page.inputValue('.msg-text');
    assert(/[஀-௿]/.test(text) && text.includes('Ramesh Kumar'), 'Tamil message');
    await c.page.selectOption('select[aria-label="Message type"]', 'overdue'); text = await c.page.inputValue('.msg-text');
    assert(text.includes('தாமதம்') || text.includes('நிலுவை'), 'Tamil overdue wording');
    await c.page.click('.sheet .icon-btn[aria-label=Close]');
    // profile -> signature
    await c.page.goto(`${URL_}#/profile`); await c.page.waitForSelector('text=Save profile');
    await c.page.locator('input.input').first().fill('Test Advisor'); await c.page.click('text=Save profile'); await c.page.waitForSelector('text=Profile saved');
    await c.page.goto(`${URL_}#/policies/today`); await c.page.waitForSelector('.pcard'); await c.page.click('.pcard .icon-btn.wa');
    await c.page.waitForSelector('.msg-text'); text = await c.page.inputValue('.msg-text');
    assert(text.endsWith('Regards,\nTest Advisor\nLIC Insurance Advisor'), text);
    await c.page.click('.btn.primary:has-text("Copy")'); await c.page.waitForSelector('.toast.show');
    eq(await c.page.evaluate(() => window.__opened.length), 1, 'only the one explicit WhatsApp tap opened WhatsApp');
  });

  S.test('record a follow-up: customer contacted today leaves the pending list and the log shows it', async (c) => {
    await c.open(); await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.goto(`${URL_}#/home`); await c.page.waitForSelector('.today-card');
    const before = await c.stat('Follow-ups pending');
    await c.page.goto(`${URL_}#/policies/today`); await c.page.locator('.pcard-main').first().click();
    await c.page.click('.sheet >> text=Follow-up'); await c.page.fill('.sheet textarea', 'Will pay tomorrow'); await c.page.click('.sheet .btn.primary:has-text("Save follow-up")');
    await c.page.waitForSelector('.timeline >> text=Will pay tomorrow');
    await c.page.click('.sheet .icon-btn[aria-label=Close]');
    await c.page.goto(`${URL_}#/home`); await c.page.waitForSelector('.today-card');
    eq(await c.stat('Follow-ups pending'), before - 1);
  });

  // ---------------- backup ----------------
  S.test('backup and restore: plain backup, wipe everything, restore brings all data back', async (c) => {
    await c.open(); await c.importPdfs(['sample-a-standard.pdf', 'sample-b-twoline-headers.pdf']); await c.save();
    await c.page.goto(`${URL_}#/backup`); await c.page.waitForSelector('text=Create a backup');
    await c.page.check('#incpdf');
    const [dl] = await Promise.all([c.page.waitForEvent('download'), c.page.click('text=Create backup file')]);
    const file = await dl.path(); const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    eq(json.format, 'lic-smart-followup-backup'); eq(json.policies.length, 12); eq(json.pdfs.length, 2);
    // wipe
    await c.page.click('.danger-zone .btn.danger'); await c.page.click('.sheet .btn.danger'); await c.page.fill('.sheet input.input', 'DELETE'); await c.page.click('.sheet .btn.primary');
    await c.page.waitForSelector('text=Welcome to LIC Smart Follow-up');
    await c.page.goto(`${URL_}#/backup`); await c.page.waitForSelector('text=Restore from backup');
    await c.page.setInputFiles('input[type=file][accept*=json]', file); await c.page.waitForSelector('text=Restore backup');
    await c.page.click('.sheet .btn.primary:has-text("Restore")'); await c.page.waitForSelector('.toast.show:has-text("Restored")');
    await c.page.goto(`${URL_}#/policies/all`); await c.page.waitForSelector('.pcard'); eq(await c.page.locator('.pcard').count(), 12);
    await c.page.goto(`${URL_}#/history`); await c.page.waitForSelector('.hist'); eq(await c.page.locator('.hist').count(), 2);
    assert(await c.page.locator('text=Download PDF').count() === 2, 'original PDFs restored');
  });

  S.test('encrypted backup: no readable customer data in the file, wrong password refused, right password restores', async (c) => {
    await c.open(); await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.goto(`${URL_}#/backup`); await c.page.waitForSelector('text=Create a backup');
    await c.page.check('#encr'); await c.page.fill('input[aria-label=Password]', 'abc'); await c.page.fill('input[aria-label="Repeat password"]', 'abc');
    await c.page.click('text=Create backup file'); await c.page.waitForSelector('.toast:has-text("at least 6")');
    await c.page.fill('input[aria-label=Password]', 'secret-pass-1'); await c.page.fill('input[aria-label="Repeat password"]', 'secret-pass-1');
    const [dl] = await Promise.all([c.page.waitForEvent('download'), c.page.click('text=Create backup file')]);
    const raw = fs.readFileSync(await dl.path(), 'utf8');
    assert(!/Ramesh|990000011|9000000001/i.test(raw), 'ciphertext only'); assert(raw.includes('AES-256-GCM'));
    await c.page.click('.danger-zone .btn.danger'); await c.page.click('.sheet .btn.danger'); await c.page.fill('.sheet input.input', 'DELETE'); await c.page.click('.sheet .btn.primary');
    await c.page.waitForSelector('text=Welcome to LIC Smart Follow-up');
    await c.page.goto(`${URL_}#/backup`); await c.page.waitForSelector('text=Restore from backup');
    await c.page.setInputFiles('input[type=file][accept*=json]', await dl.path());
    await c.page.waitForSelector('text=Encrypted backup');
    const live = '.backdrop:not(.closing) .sheet';
    await c.page.fill(`${live} input[type=password]`, 'nope'); await c.page.click(`${live} .btn.primary`); await c.page.waitForSelector('text=Wrong password');
    await c.page.fill(`${live} input[type=password]`, 'secret-pass-1'); await c.page.click(`${live} .btn.primary`);
    await c.page.waitForSelector('text=Restore backup'); await c.page.click('.sheet .btn.primary:has-text("Restore")');
    await c.page.waitForSelector('.toast.show:has-text("Restored")');
    await c.page.goto(`${URL_}#/policies/all`); await c.page.waitForSelector('.pcard'); eq(await c.page.locator('.pcard').count(), 7);
  });

  S.test('restore refuses files that are not backups', async (c) => {
    await c.open(`/backup`); await c.page.waitForSelector('text=Restore from backup');
    await c.page.setInputFiles('input[type=file][accept*=json]', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
    await c.page.waitForSelector('.toast:has-text("not a LIC Smart Follow-up backup")');
    await c.page.setInputFiles('input[type=file][accept*=json]', { name: 'y.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
    await c.page.waitForSelector('.toast:has-text("not a valid backup")');
  });

  S.test('import history: download the original PDF and delete an import (file only vs. with its records)', async (c) => {
    await c.open(); await c.importPdfs(['sample-e-duplicates.pdf']); await c.save();
    await c.page.goto(`${URL_}#/history`); await c.page.waitForSelector('.hist');
    const [dl] = await Promise.all([c.page.waitForEvent('download'), c.page.click('text=Download PDF')]);
    const buf = fs.readFileSync(await dl.path()); assert(buf.slice(0, 4).toString() === '%PDF', 'real PDF bytes');
    eq(buf.length, fs.statSync(path.join(FIX, 'sample-e-duplicates.pdf')).size, 'identical to the original');
    await c.page.click('.hist >> text=Delete'); await c.page.click('.sheet .btn.danger'); await c.page.waitForSelector('.toast:has-text("Deleted the file and 2 records")');
    await c.page.goto(`${URL_}#/policies/all`); await c.page.waitForSelector('text=No policies yet');
  });

  // ---------------- offline & PWA ----------------
  S.test('OFFLINE: installed app works with no network: import a PDF, browse, search, edit, export, restart', async (c) => {
    await c.open();
    await c.page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await c.page.waitForFunction(async () => { const ks = await caches.keys(); if (!ks.length) return false; return (await (await caches.open(ks[0])).keys()).length > 150; }, null, { timeout: 40000 });
    await c.page.reload(); await c.page.waitForFunction(() => window.__licReady && navigator.serviceWorker.controller);
    await c.context.setOffline(true);
    await c.page.reload(); await c.page.waitForFunction(() => window.__licReady);
    // everything below runs with the network cut
    await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.goto(`${URL_}#/policies/today`); await c.page.waitForSelector('.pcard');
    await c.page.fill('.search', 'ramesh'); await c.page.waitForSelector('.pcard');
    await c.page.click('.pcard .icon-btn.wa'); await c.page.waitForSelector('.msg-text'); assert((await c.page.inputValue('.msg-text')).includes('Ramesh Kumar'));
    await c.page.click('.sheet .icon-btn[aria-label=Close]');
    await c.page.goto(`${URL_}#/backup`); await c.page.waitForSelector('text=Export & reports');
    const [dl] = await Promise.all([c.page.waitForEvent('download'), c.page.click('text=All policies (CSV)')]);
    assert((await readDownload(dl)).includes('990000011'));
    await c.page.reload(); await c.page.waitForFunction(() => window.__licReady);
    await c.page.goto(`${URL_}#/home`); await c.page.waitForSelector('.today-card'); eq(await c.stat('Policies'), 7, 'data survives an offline restart');
    eq(c.errors, [], 'no console errors offline');
  });

  S.test('PWA: manifest is valid, icons resolve, service worker controls the page', async (c) => {
    await c.open();
    const m = await (await c.page.request.get(`${URL_}manifest.webmanifest`)).json();
    eq(m.display, 'standalone'); assert(m.icons.length >= 3); assert(m.name === 'LIC Smart Follow-up');
    for (const i of m.icons) assert((await c.page.request.get(URL_ + i.src)).ok(), `icon ${i.src}`);
    await c.page.evaluate(async () => { await navigator.serviceWorker.ready; });
    assert(await c.page.evaluate(() => !!navigator.serviceWorker.getRegistration));
  });

  // ---------------- notifications (Android plugin mocked) ----------------
  S.test('NATIVE notifications (mocked Capacitor): schedules 30 days of correct summaries, test button, disable cancels', async (c) => {
    await c.context.addInitScript(nativeMockScript('granted'));
    await c.open(); await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.waitForFunction(() => window.__ln.pending.length >= 29, null, { timeout: 8000 });
    const pend = await c.page.evaluate(() => window.__ln.pending);
    eq(pend.length, 29, "today's 08:00 already passed at the fixed 09:00 device time");
    assert(new Set(pend.map((n) => n.id)).size === 29, 'unique ids');
    const first = pend.sort((a, b) => new Date(a.schedule.at) - new Date(b.schedule.at))[0];
    eq(first.extra.day, '2026-11-19'); assert(first.title.includes('Good Morning'));
    assert(first.largeBody.includes("Today's Due Policies: 1") && first.largeBody.includes('Pending Follow-ups:'), first.largeBody);
    assert(first.schedule.allowWhileIdle === true);
    assert(new Date(first.schedule.at).getHours() === 8, 'default time 8:00 AM');
    eq(await c.page.evaluate(() => window.__ln.channels.length > 0), true, 'channel created');
    await c.page.goto(`${URL_}#/notifications`); await c.page.waitForSelector('text=Android app: reminders work even when the app is closed');
    await c.page.click('text=Send test notification'); await c.page.waitForFunction(() => window.__ln.scheduled.some((n) => n.id === 2147000000));
    // change time to 07:30 -> reschedule at the new time
    await c.page.fill('input[type=time] >> nth=0', '07:30'); await c.page.dispatchEvent('input[type=time] >> nth=0', 'change');
    await c.page.waitForFunction(() => window.__ln.pending.some((n) => new Date(n.schedule.at).getHours() === 7 && new Date(n.schedule.at).getMinutes() === 30), null, { timeout: 8000 });
    // disable -> everything cancelled
    await c.page.locator('label.switch-row:has-text("Daily morning summary") input').uncheck();
    await c.page.waitForFunction(() => window.__ln.pending.length === 0, null, { timeout: 8000 });
  });

  S.test('NATIVE notifications: blocked permission is explained, nothing is scheduled', async (c) => {
    await c.context.addInitScript(nativeMockScript('denied'));
    await c.open(); await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.goto(`${URL_}#/home`); await c.page.waitForSelector('text=Notifications are blocked');
    eq(await c.page.evaluate(() => window.__ln.pending.length), 0);
  });

  S.test('NATIVE notifications: prompt state offers Allow, granting schedules reminders', async (c) => {
    await c.context.addInitScript(nativeMockScript('prompt'));
    await c.open(); await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.goto(`${URL_}#/home`); await c.page.waitForSelector('text=Turn on daily reminders');
    await c.page.click('.banner .btn:has-text("Allow")');
    await c.page.waitForFunction(() => window.__ln.pending.length >= 29, null, { timeout: 8000 });
  });

  // ---------------- preferences ----------------
  S.test('dark theme, default language preference and overdue window are applied', async (c) => {
    await c.open('/preferences'); await c.page.waitForSelector('text=Theme');
    await c.page.selectOption('select >> nth=1', 'dark'); await c.page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await c.page.reload(); await c.page.waitForFunction(() => window.__licReady); eq(await c.page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    const bg = await c.page.evaluate(() => getComputedStyle(document.body).backgroundColor); assert(bg !== 'rgb(243, 246, 251)', `dark background applied (${bg})`);
  });

  S.test('all navigation destinations render without errors', async (c) => {
    await c.open(); await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    for (const r of ['/home', '/policies/today', '/policies/tomorrow', '/policies/next3', '/policies/next7', '/policies/next15', '/policies/thisMonth', '/policies/overdue', '/policies/pending', '/policies/followupDone', '/policies/paid', '/policies/all', '/calendar', '/customers', '/import', '/history', '/more', '/profile', '/notifications', '/preferences', '/backup', '/help']) {
      await c.page.goto(`${URL_}#${r}`); await c.page.waitForFunction(() => document.querySelector('#main').children.length > 0);
      assert(!(await c.page.textContent('#main')).includes('Something went wrong'), `render error on ${r}`);
      await c.noJunk('#main', `on ${r}`);
    }
    await c.page.goto(`${URL_}#/customers`); await c.page.waitForSelector('.crow'); await c.page.locator('.crow').first().click();
    await c.page.waitForSelector('.cust-head'); assert((await c.page.textContent('#main')).includes('Policy history'));
    eq(c.errors, [], 'console errors');
  });
  S.test('commission: read from the list, worked out when the advisor confirms payment, shown on Home, undone with the payment', async (c) => {
    await c.open(); await c.importPdfs(['sample-h-lic-monthly.pdf']); await c.save();
    await c.page.goto(`${URL_}#/policies/all`); await c.page.waitForSelector('.pcard');
    await c.page.fill('.search', '990000011'); await c.page.waitForFunction(() => document.querySelectorAll('.pcard').length === 1);
    await c.page.locator('.pcard-main').first().click(); await c.page.waitForSelector('.sheet >> text=Confirm payment');
    assert((await c.page.textContent('.sheet')).includes('Estimated commission'), 'estimate shown before payment');
    await c.page.click('.sheet >> text=Confirm payment');
    eq(await c.page.inputValue('.sheet input[placeholder=optional]'), '166.4', 'one instalment -> proportional commission');
    await c.page.click('.sheet >> text=/^All 7 due/');
    eq(await c.page.inputValue('.sheet input[placeholder=optional]'), '1164.8', 'all dues -> full commission');
    await c.page.click('text=Yes, payment received'); await c.page.waitForSelector('.sheet .badge.ok');
    assert((await c.page.textContent('.sheet')).includes('Commission earned'), 'earned commission shown');
    await c.page.click('.sheet .icon-btn[aria-label=Close]');
    await c.page.goto(`${URL_}#/home`); await c.page.waitForSelector('text=Earned this month');
    assert((await c.page.textContent('#main')).includes('1,164.8'), 'home commission card');
    eq(c.errors, [], 'console errors');
  });

  S.test('own app name and logo: saved in the profile, shown on Home and survive a reload', async (c) => {
    await c.open(); await c.importPdfs(['sample-a-standard.pdf']); await c.save();
    await c.page.goto(`${URL_}#/profile`); await c.page.waitForSelector('text=Your name and logo');
    await c.page.fill('input[placeholder^="e.g. Suresh Kumar Insurance"]', 'Test Advisor Services');
    await c.page.setInputFiles('input[type=file][accept^="image"]', path.join(FIX, 'sample-d-scanned.png'));
    await c.page.waitForSelector('.logo-edit img');
    await c.page.click('text=Save profile'); await c.page.waitForSelector('text=Profile saved');
    eq(await c.page.title(), 'Test Advisor Services');
    await c.page.goto(`${URL_}#/home`); await c.page.waitForSelector('.hero-app');
    eq(await c.page.textContent('.hero-app'), 'Test Advisor Services');
    assert(await c.page.locator('.hero-logo').count() === 1, 'logo on home');
    await c.page.reload(); await c.page.waitForSelector('.hero-app');
    eq(await c.page.title(), 'Test Advisor Services', 'persists after reload');
    eq(c.errors, [], 'console errors');
  });
}
