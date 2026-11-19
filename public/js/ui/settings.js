import { h, icon, toast, confirmDialog, promptDialog, field, openSheet, mount } from './dom.js';
import { state, reload, applyTheme } from '../store.js';
import * as DB from '../core/db.js';
import { encryptString, decryptEnvelope, isEncryptedEnvelope } from '../core/crypto.js';
import { policiesToCSV } from '../core/csv.js';
import { buildReportHTML, customersToCSV } from '../core/report.js';
import { inCategory, sortPolicies } from '../core/due.js';
import { todayISO, formatDate } from '../core/dates.js';
import { saveFile, platformName, isNative } from '../platform.js';
import { permissionState, requestPermission, sendTestNotification, rescheduleAll, notificationMode, exactAlarmState, openExactAlarmSettings, lastScheduleInfo } from '../notify.js';
import { go } from '../router.js';
import { ctx } from '../store.js';

export const APP_VERSION = '1.0.0';

const back = (to = '/more') => h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => go(to) }, icon('back'));

function menuItem(ic, title, sub, to, onclick) {
  return h('button', { class: 'menu-item', onclick: onclick || (() => go(to)) }, h('div', { class: 'menu-ic' }, icon(ic, 22)), h('div', { class: 'menu-tx' }, h('strong', title), h('div', { class: 'muted small' }, sub)), icon('chevron', 18));
}

export function renderMore(root) {
  mount(root, 
    h('div', { class: 'page-head' }, h('h1', 'More')),
    h('div', { class: 'menu' },
      menuItem('user', 'Profile', state.profile.advisorName ? state.profile.advisorName : 'Optional: your name appears in messages', '/profile'),
      menuItem('bell', 'Notifications', state.prefs.notifEnabled ? `Daily summary at ${state.prefs.notifTime}` : 'Daily summary is off', '/notifications'),
      menuItem('settings', 'Preferences', 'Language, theme, overdue window, backup reminder', '/preferences'),
      menuItem('database', 'Backup, restore & storage', 'Protect your data. Export CSV and reports', '/backup'),
      menuItem('history', 'Import history', 'Processed files, original PDFs', '/history'),
      menuItem('help', 'Help, privacy & about', `Version ${APP_VERSION}`, '/help')));
}

// ---------- profile ----------
// Shrinks a picked image to a small PNG so it stays light inside the local database and backups.
function logoFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 256; const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture the app can read. Use a PNG or JPG.')); };
    img.src = url;
  });
}

export function applyBranding() { document.title = state.profile.appName || 'LIC Smart Follow-up'; }

export function renderProfile(root) {
  const p = state.profile;
  let logo = DB.safeLogo(p.logo);
  const inp = (k, label, attrs = {}) => { const i = h('input', { class: 'input', value: p[k] || '', autocomplete: 'off', ...attrs }); return [field(label, i), i]; };
  const [fName, iName] = inp('advisorName', 'Advisor name', { placeholder: 'e.g. Suresh Kumar' });
  const [fCode, iCode] = inp('agentCode', 'LIC agent code');
  const [fDo, iDo] = inp('doName', 'Development Officer name');
  const [fBr, iBr] = inp('branch', 'Branch name');
  const [fMob, iMob] = inp('mobile', 'Mobile number', { inputmode: 'tel', placeholder: 'Shown in messages if filled' });
  const [fMail, iMail] = inp('email', 'Email address', { type: 'email' });
  const [fApp, iApp] = inp('appName', 'Your app name', { placeholder: 'e.g. Suresh Kumar Insurance Services', maxlength: '40' });
  const preview = h('div', { class: 'logo-edit' });
  const drawLogo = () => mount(preview,
    logo ? h('img', { src: logo, alt: 'Your logo' }) : h('div', { class: 'muted small' }, 'No logo yet'),
    h('div', { class: 'btn-row wrap' },
      h('label', { class: 'btn soft sm' }, 'Choose logo', h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: async (e) => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f) return;
        try { logo = await logoFromFile(f); drawLogo(); } catch (err) { toast(err.message, { kind: 'bad' }); }
      } })),
      logo && h('button', { class: 'btn ghost sm', onclick: () => { logo = ''; drawLogo(); } }, 'Remove')));
  drawLogo();
  mount(root, 
    h('div', { class: 'page-head' }, back(), h('h1', 'Profile')),
    h('p', { class: 'muted' }, 'Optional. Your name is used to sign customer messages ("Regards, Your Name, LIC Insurance Advisor"). Without a profile, messages have no signature. Stored only on this phone.'),
    fName, fCode, fDo, fBr, fMob, fMail,
    h('h3', 'Your name and logo'),
    h('p', { class: 'muted small' }, 'Shown on your Home screen and in the browser title. The name and icon under the app on your phone\'s home screen are set when the APK is built.'),
    fApp, preview,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: async () => { await DB.saveProfile({ advisorName: iName.value, agentCode: iCode.value, doName: iDo.value, branch: iBr.value, mobile: iMob.value, email: iMail.value, appName: iApp.value, logo }); await reload(); applyBranding(); toast('Profile saved'); } }, icon('check', 18), 'Save profile'),
      h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog({ title: 'Clear profile?', message: 'Messages will no longer be signed.', confirmText: 'Clear' })) { await DB.saveProfile({}); await reload(); applyBranding(); renderProfile(root); toast('Profile cleared'); } } }, 'Clear')));
}

// ---------- notifications ----------
export async function renderNotifications(root) {
  const pr = state.prefs;
  const perm = await permissionState();
  const mode = notificationMode();
  const info = await lastScheduleInfo();
  const exact = mode === 'native' ? await exactAlarmState() : 'n/a';

  const save = async (patch) => {
    await DB.savePrefs(patch);
    await reload();
    const r = await rescheduleAll({ policies: state.policies, prefs: state.prefs, profile: state.profile });
    return r;
  };
  const toggle = (label, key, sub) => h('label', { class: 'switch-row' }, h('div', {}, h('strong', label), sub && h('div', { class: 'muted small' }, sub)), h('input', { type: 'checkbox', class: 'switch', checked: !!pr[key], onchange: async (e) => { await save({ [key]: e.target.checked }); renderNotifications(root); } }));
  const time = (label, key) => h('label', { class: 'field inline' }, h('span', label), h('input', { type: 'time', class: 'input', value: pr[key], onchange: async (e) => { if (e.target.value) { await save({ [key]: e.target.value }); renderNotifications(root); } } }));

  const sample = h('pre', { class: 'sample' }, 'GOOD MORNING!\n\nYour LIC Customer Follow-up Report\n\nToday\'s Due Policies: 12\nDue in Next 3 Days: 28\nDue in Next 7 Days: 45\nOverdue Policies: 8\nPending Follow-ups: 15\n\nPlease contact your customers and complete your follow-ups.');

  mount(root, 
    h('div', { class: 'page-head' }, back(), h('h1', 'Notifications')),
    h('div', { class: `banner ${mode === 'native' ? 'ok' : 'warn'}` }, icon(mode === 'native' ? 'check' : 'alert', 20),
      h('div', {}, h('strong', mode === 'native' ? 'Android app: reminders work even when the app is closed' : 'Web version: reminders only appear when the app is opened'),
        h('div', { class: 'small' }, mode === 'native'
          ? 'The app gives Android the next 30 days of alarms. They need no internet. Open the app at least once a month and after importing new data so they stay current.'
          : 'Browsers cannot wake up on their own. For reliable daily alerts install the Android app (APK). Until then the summary shows on the Home screen and as a notification when you open the app after the chosen time.'))),
    h('div', { class: 'card flat' },
      h('div', { class: 'kv' }, h('span', 'Permission'), h('strong', perm === 'granted' ? 'Allowed' : perm === 'denied' ? 'Blocked' : perm === 'prompt' ? 'Not asked yet' : 'Not supported')),
      perm !== 'granted' && perm !== 'unsupported' && h('div', { class: 'btn-row' }, perm === 'denied'
        ? h('p', { class: 'small' }, 'Notifications are blocked. Open Android Settings → Apps → LIC Smart Follow-up → Notifications and switch them on.')
        : h('button', { class: 'btn primary', onclick: async () => { const r = await requestPermission(); if (r === 'granted') await save({}); renderNotifications(root); } }, 'Allow notifications')),
      mode === 'native' && exact && exact !== 'granted' && exact !== 'unknown' && h('div', {}, h('p', { class: 'small' }, 'Android 12+ needs "Alarms & reminders" permission to fire at the exact minute. Without it, the alert may arrive a few minutes late.'), h('button', { class: 'btn soft sm', onclick: () => openExactAlarmSettings() }, 'Allow exact alarms')),
      info && mode === 'native' && h('div', { class: 'kv' }, h('span', 'Scheduled'), h('strong', `${info.count} reminders`))),
    toggle('Daily morning summary', 'notifEnabled', 'Counts of due, overdue and pending follow-ups'),
    time('Morning time', 'notifTime'),
    toggle('Evening summary', 'eveningEnabled', 'A wrap-up so you can update today\'s follow-ups'),
    pr.eveningEnabled && time('Evening time', 'eveningTime'),
    toggle('Reminder for each policy due today', 'individualEnabled', 'One notification per customer, highest premium first'),
    pr.individualEnabled && time('Policy reminder time', 'individualTime'),
    pr.individualEnabled && toggle('Hide customer details in notifications', 'hideNotifDetails', 'Shows only "Premium due today" on the lock screen'),
    h('div', { class: 'btn-row wrap' },
      h('button', { class: 'btn primary', onclick: async () => { const r = await sendTestNotification(); toast(r.ok ? (mode === 'native' ? 'Test notification in 2 seconds' : 'Test notification sent') : r.reason, { kind: r.ok ? 'info' : 'warn', ms: 5000 }); } }, icon('bell', 18), 'Send test notification'),
      h('button', { class: 'btn soft', onclick: async () => { const r = await save({}); toast(mode === 'native' ? `${r.scheduled} reminders scheduled` : 'Web version: nothing to schedule', { ms: 4000 }); renderNotifications(root); } }, 'Refresh schedule')),
    h('h3', 'Example of the morning notification'), sample);
}

// ---------- preferences ----------
export function renderPreferences(root) {
  const pr = state.prefs;
  const sel = (label, key, options, sub) => field(label, h('select', { class: 'input', onchange: async (e) => { const v = e.target.value; await DB.savePrefs({ [key]: typeof pr[key] === 'number' ? Number(v) : v }); await reload(); if (key === 'theme') applyTheme(); if (key === 'overdueMaxDays') await rescheduleAll({ policies: state.policies, prefs: state.prefs, profile: state.profile }); toast('Saved'); } },
    options.map(([v, l]) => h('option', { value: String(v), selected: String(pr[key]) === String(v) }, l))), sub);
  mount(root, 
    h('div', { class: 'page-head' }, back(), h('h1', 'Preferences')),
    sel('Default message language', 'language', [['en', 'English'], ['ta', 'தமிழ் (Tamil)']], 'You can switch language on every message.'),
    sel('Theme', 'theme', [['auto', 'Follow phone setting'], ['light', 'Light'], ['dark', 'Dark']]),
    sel('Treat unpaid policies as overdue for', 'overdueMaxDays', [[0, 'Any number of days (recommended)'], [30, '30 days'], [60, '60 days'], [90, '90 days'], [180, '180 days']], 'Older ones are not deleted; they stay in "All". A past due date never marks a policy as paid.'),
    sel('Backup reminder', 'backupReminderDays', [[0, 'Never'], [7, 'Every 7 days'], [14, 'Every 14 days'], [30, 'Every 30 days']]),
    sel('Dates written 03/04/2026 mean', 'dateOrder', [['dmy', '3 April 2026 (day/month, India)'], ['mdy', '4 March 2026 (month/day)']], 'Used when reading CSV files.'));
}

// ---------- backup, restore, storage, exports ----------
async function download(name, data, mime) {
  const r = await saveFile(name, data, mime);
  if (r === 'downloaded') toast('File downloaded');
  else if (r === 'shared') toast('Choose where to save or send it');
  return r;
}

export async function renderBackup(root) {
  const info = await DB.storageInfo();
  const pct = info.usage !== null && info.quota ? Math.min(100, (info.usage / info.quota) * 100) : null;
  const incPdf = h('input', { type: 'checkbox', id: 'incpdf' });
  const encr = h('input', { type: 'checkbox', id: 'encr' });
  const pw1 = h('input', { type: 'password', class: 'input', placeholder: 'Password', autocomplete: 'new-password', 'aria-label': 'Password' });
  const pw2 = h('input', { type: 'password', class: 'input', placeholder: 'Repeat password', autocomplete: 'new-password', 'aria-label': 'Repeat password' });
  const pwBox = h('div', { hidden: true }, pw1, pw2, h('p', { class: 'note' }, 'There is no password recovery. If you forget it, this backup can never be opened.'));
  encr.addEventListener('change', () => { pwBox.hidden = !encr.checked; });
  const restoreInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreFlow(f); } });

  async function makeBackup() {
    if (encr.checked) {
      if (pw1.value.length < 6) { toast('Use a password of at least 6 characters.', { kind: 'warn' }); return; }
      if (pw1.value !== pw2.value) { toast('The two passwords do not match.', { kind: 'warn' }); return; }
    }
    const b = await DB.buildBackup({ includePdfs: incPdf.checked });
    let text = JSON.stringify(b);
    let name = `lic-followup-backup-${todayISO()}.json`;
    if (encr.checked) { text = JSON.stringify(await encryptString(text, pw1.value)); name = `lic-followup-backup-${todayISO()}-encrypted.json`; }
    const r = await download(name, text, 'application/json');
    if (r !== 'cancelled') { await DB.savePrefs({ lastBackupAt: new Date().toISOString() }); await reload(); }
  }

  async function restoreFlow(file) {
    let data;
    try {
      const parsed = JSON.parse(await file.text());
      if (isEncryptedEnvelope(parsed)) {
        let plain = null;
        for (let tries = 0; tries < 3 && plain === null; tries++) {
          const pw = await promptDialog({ title: 'Encrypted backup', label: 'Backup password', type: 'password', confirmText: 'Unlock', hint: tries ? 'Wrong password. Try again.' : '' });
          if (pw === null) return;
          try { plain = await decryptEnvelope(parsed, pw); } catch { plain = null; }
        }
        if (plain === null) { toast('Could not unlock the backup: wrong password or damaged file.', { kind: 'bad', ms: 5000 }); return; }
        data = JSON.parse(plain);
      } else data = parsed;
      DB.validateBackup(data);
    } catch (e) {
      toast(e instanceof SyntaxError ? 'That file is not a valid backup.' : e.message, { kind: 'bad', ms: 5000 });
      return;
    }
    openSheet((close) => {
      let mode = 'merge';
      const choose = (m) => { mode = m; };
      return [
        h('p', {}, `This backup was made on ${formatDate(data.exportedAt.slice(0, 10))} and holds ${data.policies.length} policy records, ${(data.activities || []).length} follow-up entries${data.pdfs?.length ? ` and ${data.pdfs.length} PDF file(s)` : ''}.`),
        h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'rmode', checked: true, onchange: () => choose('merge') }), h('span', {}, h('strong', 'Merge'), h('div', { class: 'small muted' }, 'Add what is missing. Keeps everything you have now.'))),
        h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'rmode', onchange: () => choose('replace') }), h('span', {}, h('strong', 'Replace everything'), h('div', { class: 'small muted' }, 'Erase current data first and use this backup (settings and profile too).'))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn ghost', onclick: close }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: async () => {
            if (mode === 'replace' && !(await confirmDialog({ title: 'Replace all data?', message: 'Everything currently in the app will be erased and replaced by the backup.', confirmText: 'Replace', danger: true }))) return;
            try {
              const r = await DB.restoreBackup(data, { mode });
              close(); await reload(); document.dispatchEvent(new CustomEvent('data-changed'));
              await rescheduleAll({ policies: state.policies, prefs: state.prefs, profile: state.profile });
              toast(`Restored: ${r.added} added${r.skipped ? `, ${r.skipped} already present` : ''}${r.invalid ? `, ${r.invalid} damaged skipped` : ''}`, { ms: 5000 });
            } catch (e) { toast(`Restore failed: ${e.message}`, { kind: 'bad', ms: 6000 }); }
          } }, 'Restore')),
      ];
    }, { title: 'Restore backup' });
  }

  const exportPolicies = async (which) => {
    const c = ctx();
    const list = which === 'all' ? state.policies : state.policies.filter((p) => inCategory(p, which, c));
    if (!list.length) { toast('Nothing to export for that list.', { kind: 'warn' }); return; }
    await download(`lic-policies-${which}-${todayISO()}.csv`, '﻿' + policiesToCSV(sortPolicies(list, 'due_asc')), 'text/csv;charset=utf-8');
  };

  mount(root, 
    h('div', { class: 'page-head' }, back(), h('h1', 'Backup & storage')),
    h('section', { class: 'card' },
      h('h3', 'Storage on this phone'),
      pct !== null && h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(Math.round(pct)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { class: 'progress-bar', style: { width: `${Math.max(1, pct)}%` } })),
      h('div', { class: 'kv' }, h('span', 'App data used'), h('strong', DB.humanBytes(info.usage))),
      h('div', { class: 'kv' }, h('span', 'Space the browser allows'), h('strong', info.quota ? DB.humanBytes(info.quota) : 'unknown')),
      h('div', { class: 'kv' }, h('span', 'Records'), h('strong', `${state.policies.length} policies · ${state.customers.length} customers`)),
      h('div', { class: 'kv' }, h('span', 'Protected from auto-clean'), h('strong', info.persisted === null ? 'unknown' : info.persisted ? 'Yes' : 'No')),
      info.persisted === false && h('button', { class: 'btn soft sm', onclick: async () => { const ok = await DB.requestPersistentStorage(); toast(ok ? 'Storage protected' : 'The browser did not grant it. Make a backup instead.', { kind: ok ? 'info' : 'warn' }); renderBackup(root); } }, 'Ask to protect my data'),
      h('p', { class: 'muted small' }, 'There is no fixed limit in this app: you can import as many PDFs and records as your phone can hold. The real limits are the free space on your phone and what Android or the browser allows for app data (shown above, often a large share of free space). Original PDFs take the most room: delete ones you no longer need from Import history. Clearing app data, uninstalling, or "Clear storage" erases everything, so keep a backup.')),
    h('section', { class: 'card' },
      h('h3', 'Create a backup'),
      h('p', { class: 'muted small' }, state.prefs.lastBackupAt ? `Last backup: ${formatDate(todayISO(new Date(state.prefs.lastBackupAt)))}` : 'You have not made a backup yet.'),
      h('label', { class: 'check' }, incPdf, h('span', 'Include original PDFs (larger file)')),
      h('label', { class: 'check' }, encr, h('span', 'Protect with a password (encrypted)')),
      pwBox,
      h('button', { class: 'btn primary', onclick: makeBackup }, icon('download', 18), 'Create backup file'),
      h('p', { class: 'muted small' }, 'Save it to Google Drive, email it to yourself, or keep it in Files. Anyone with an unencrypted backup can read your customer list.')),
    h('section', { class: 'card' },
      h('h3', 'Restore from backup'),
      h('p', { class: 'muted small' }, 'Use this after reinstalling the app or moving to a new phone.'),
      h('button', { class: 'btn soft', onclick: () => restoreInput.click() }, icon('upload', 18), 'Choose backup file'), restoreInput),
    h('section', { class: 'card' },
      h('h3', 'Export & reports'),
      h('div', { class: 'btn-col' },
        h('button', { class: 'btn soft', onclick: () => exportPolicies('all') }, icon('download', 18), 'All policies (CSV)'),
        h('button', { class: 'btn soft', onclick: () => exportPolicies('overdue') }, icon('download', 18), 'Overdue policies (CSV)'),
        h('button', { class: 'btn soft', onclick: () => exportPolicies('next7') }, icon('download', 18), 'Due in next 7 days (CSV)'),
        h('button', { class: 'btn soft', onclick: async () => { if (!state.customers.length) { toast('No customers yet.', { kind: 'warn' }); return; } await download(`lic-customers-${todayISO()}.csv`, '﻿' + customersToCSV(state.customers), 'text/csv;charset=utf-8'); } }, icon('users', 18), 'Customer-wise list (CSV)'),
        h('button', { class: 'btn soft', onclick: async () => { await download(`lic-report-${todayISO()}.html`, buildReportHTML({ policies: state.policies, customers: state.customers, today: state.today, profile: state.profile, overdueMaxDays: state.prefs.overdueMaxDays }), 'text/html;charset=utf-8'); } }, icon('file', 18), 'Printable customer report'))),
    h('section', { class: 'card danger-zone' },
      h('h3', 'Delete all data'),
      h('p', { class: 'muted small' }, 'Removes every customer, PDF, follow-up and setting from this phone. Make a backup first.'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmDialog({ title: 'Delete everything?', message: 'All customers, imported PDFs, follow-ups and settings on this phone will be erased permanently.', confirmText: 'Continue', danger: true }))) return;
        const typed = await promptDialog({ title: 'Type DELETE to confirm', label: 'Confirmation', confirmText: 'Delete everything' });
        if (typed !== 'DELETE') { if (typed !== null) toast('Not deleted: you did not type DELETE.', { kind: 'warn' }); return; }
        await DB.wipeEverything(); await reload(); await rescheduleAll({ policies: [], prefs: state.prefs, profile: state.profile });
        document.dispatchEvent(new CustomEvent('data-changed')); toast('All data deleted'); go('/home');
      } }, icon('trash', 18), 'Delete all data')));
}

// ---------- help ----------
export function renderHelp(root) {
  const sec = (title, ...body) => h('section', { class: 'card' }, h('h3', title), ...body);
  mount(root, 
    h('div', { class: 'page-head' }, back(), h('h1', 'Help & privacy')),
    sec('Your data stays on your phone', h('p', 'Customer names, policy numbers, mobile numbers and PDFs are stored only in this app on this phone. There is no account, no login and no server. Nobody else, including the app\'s publisher, can see your data. Another advisor installing the app gets a completely separate, empty database.')),
    sec('How reminders reach you', h('p', mode_text())),
    sec('Daily routine', h('ol', { class: 'steps' }, h('li', 'Import the new premium due PDF when you receive it.'), h('li', 'Open Home each morning (or read the notification).'), h('li', 'Tap "Message today\'s customers" and send each WhatsApp message yourself.'), h('li', 'Tap "Mark contacted" after contacting; tap "Confirm payment" only when a customer has actually paid.'))),
    sec('Good to know', h('ul', { class: 'steps' },
      h('li', 'A policy is never marked paid automatically, even long after its due date.'),
      h('li', 'The app never sends messages by itself. WhatsApp opens with the text ready and you press Send.'),
      h('li', 'Unclear PDF values are never guessed: they are flagged and wait for your check.'),
      h('li', 'Make a backup regularly. Uninstalling the app or clearing its data deletes everything.'))),
    sec('About', h('div', { class: 'kv' }, h('span', 'Version'), h('strong', APP_VERSION)), h('div', { class: 'kv' }, h('span', 'Running as'), h('strong', platformName())), h('p', { class: 'muted small' }, 'LIC Smart Follow-up is an independent productivity tool for insurance advisors. It is not an official product of the Life Insurance Corporation of India.')));
}

function mode_text() {
  return isNative()
    ? 'The Android app schedules your daily summary with Android itself, so it appears even when the app is closed and the phone is offline. Some phone makers (Xiaomi, Oppo, Vivo, Realme, Samsung battery savers) may delay or block alarms: set the app to "No restrictions" or "Unrestricted" battery use and allow "Alarms & reminders".'
    : 'This is the web version. A web page cannot run while the app is closed, so the summary appears on Home and, after you allow notifications, as a notification when you open the app after your chosen time. For alarms that work with the app closed, install the Android app (APK).';
}
