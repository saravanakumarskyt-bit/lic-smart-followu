// IndexedDB storage. Everything lives on the advisor's own device; nothing is ever sent to a server.
//
// Stores
//   policies    one row per policy installment (policyNumber + dueDate is the duplicate key)
//   imports     one row per imported file (processing history)
//   files       original PDF blobs, keyed by import id (kept separate so lists stay fast)
//   activities  follow-up log (calls, WhatsApp, notes, payment confirmations)
//   settings    key/value: profile, preferences, backup metadata
import { cleanText, validatePolicy, hasErrors } from './validate.js';
import { todayISO } from './dates.js';

export const DB_NAME = 'lic-smart-followup';
export const DB_VERSION = 1;
export const BACKUP_FORMAT = 'lic-smart-followup-backup';

let dbPromise = null;

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export function openDB(name = DB_NAME) {
  if (dbPromise && name === DB_NAME) return dbPromise;
  const p = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const pol = db.createObjectStore('policies', { keyPath: 'id' });
      pol.createIndex('policyNumber', 'policyNumber');
      pol.createIndex('dueDate', 'dueDate');
      pol.createIndex('mobile', 'mobile');
      pol.createIndex('sourceId', 'sourceId');
      pol.createIndex('dupKey', 'dupKey', { unique: false });
      db.createObjectStore('imports', { keyPath: 'id' });
      db.createObjectStore('files', { keyPath: 'id' });
      const act = db.createObjectStore('activities', { keyPath: 'id' });
      act.createIndex('policyId', 'policyId');
      act.createIndex('date', 'date');
      db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is blocked by another open tab. Close other tabs and reload.'));
  });
  if (name === DB_NAME) dbPromise = p;
  return p;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    Promise.resolve(fn(...[].concat(stores).map((s) => t.objectStore(s)))).then((r) => { result = r; }, (e) => { try { t.abort(); } catch { /* already finished */ } reject(e); });
  });
}

export const getAll = (store) => tx(store, 'readonly', (s) => wrap(s.getAll()));
export const getOne = (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key)));
export const putOne = (store, value) => tx(store, 'readwrite', (s) => wrap(s.put(value)));
export const deleteOne = (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key)));
export const clearStore = (store) => tx(store, 'readwrite', (s) => wrap(s.clear()));
export const countOf = (store) => tx(store, 'readonly', (s) => wrap(s.count()));

// ---------- settings ----------

export const DEFAULT_PREFS = {
  language: 'en',            // default message language: 'en' | 'ta'
  theme: 'auto',             // 'auto' | 'light' | 'dark'
  overdueMaxDays: 0,         // 0 = show every unpaid past-due policy as overdue
  notifEnabled: true,
  notifTime: '08:00',        // daily morning summary
  eveningEnabled: false,
  eveningTime: '18:00',
  individualEnabled: false,  // per-policy reminders for policies due today
  individualTime: '09:00',
  individualMaxPerDay: 15,
  backupReminderDays: 14,    // remind the user to back up; 0 = never
  lastBackupAt: null,
  dateOrder: 'dmy',
  onboardingDone: false,
};

export async function getSetting(key, fallback = null) {
  const row = await getOne('settings', key);
  return row ? row.value : fallback;
}
export const setSetting = (key, value) => putOne('settings', { key, value });

export async function getPrefs() {
  return { ...DEFAULT_PREFS, ...(await getSetting('prefs', {})) };
}
export async function savePrefs(patch) {
  const next = { ...(await getPrefs()), ...patch };
  await setSetting('prefs', next);
  return next;
}

export const EMPTY_PROFILE = { advisorName: '', agentCode: '', doName: '', branch: '', mobile: '', email: '' };
export async function getProfile() {
  return { ...EMPTY_PROFILE, ...(await getSetting('profile', {})) };
}
export async function saveProfile(p) {
  const clean = {};
  for (const k of Object.keys(EMPTY_PROFILE)) clean[k] = cleanText(p[k] ?? '');
  await setSetting('profile', clean);
  return clean;
}

// ---------- policies ----------

export const dupKeyOf = (p) => `${p.policyNumber}|${p.dueDate}`;

/** Fill defaults and derived fields. Never invents customer data. */
export function normalizePolicy(p, now = new Date()) {
  const iso = now.toISOString();
  const out = {
    id: p.id || uid(),
    customerName: cleanText(p.customerName),
    policyNumber: String(p.policyNumber ?? '').trim(),
    premiumAmount: p.premiumAmount === '' || p.premiumAmount === undefined ? null : p.premiumAmount === null ? null : Number(p.premiumAmount),
    dueDate: p.dueDate || '',
    mobile: String(p.mobile ?? '').trim(),
    policyStatus: cleanText(p.policyStatus),
    premiumTerm: cleanText(p.premiumTerm),
    mode: cleanText(p.mode),
    plan: cleanText(p.plan),
    lastFollowUpDate: p.lastFollowUpDate || '',
    followUpStatus: p.followUpStatus || 'pending',
    paymentStatus: p.paymentStatus === 'paid' ? 'paid' : 'unpaid',
    paidDate: p.paidDate || '',
    paidAmount: p.paidAmount ?? null,
    notes: String(p.notes ?? '').slice(0, 5000),
    sourceId: p.sourceId || '',
    sourceName: p.sourceName || (p.manual ? 'Added manually' : ''),
    importedAt: p.importedAt || iso,
    createdAt: p.createdAt || iso,
    updatedAt: iso,
    manual: !!p.manual,
  };
  out.dupKey = dupKeyOf(out);
  return out;
}

export const listPolicies = () => getAll('policies');
export const getPolicy = (id) => getOne('policies', id);

export async function findDuplicate(policyNumber, dueDate, exceptId = null) {
  const all = await tx('policies', 'readonly', (s) => wrap(s.index('dupKey').getAll(`${policyNumber}|${dueDate}`)));
  return all.find((p) => p.id !== exceptId) || null;
}

/** Add or edit one policy by hand. Throws on validation errors and on duplicates. */
export async function savePolicy(input) {
  const rec = normalizePolicy(input);
  const v = validatePolicy(rec);
  if (hasErrors(v)) {
    const e = new Error(Object.values(v.errors)[0]);
    e.fields = v.errors;
    throw e;
  }
  const dup = await findDuplicate(rec.policyNumber, rec.dueDate, rec.id);
  if (dup) {
    const e = new Error(`Policy ${rec.policyNumber} already has a record for this due date (${rec.dueDate}).`);
    e.duplicate = dup;
    throw e;
  }
  if (input.id) {
    const old = await getPolicy(input.id);
    if (old) { rec.createdAt = old.createdAt; rec.importedAt = old.importedAt; rec.sourceId = old.sourceId; rec.sourceName = old.sourceName; }
  }
  await putOne('policies', rec);
  return rec;
}

export async function deletePolicy(id) {
  await tx(['policies', 'activities'], 'readwrite', async (pol, act) => {
    pol.delete(id);
    const acts = await wrap(act.index('policyId').getAllKeys(id));
    acts.forEach((k) => act.delete(k));
  });
}

export async function deletePolicies(ids) {
  for (const id of ids) await deletePolicy(id);
}

/**
 * Bulk save verified import records.
 * onDuplicate: 'skip' keeps the stored record; 'update' refreshes amount/name/mobile/status but keeps the
 * advisor's own follow-up and payment information.
 * Returns { added, updated, skipped, possiblyPaid: [policy] } where possiblyPaid are older unpaid installments of a
 * policy that now has a newer due date in the file. They are only suggestions; nothing is marked paid here.
 */
export async function saveImportedPolicies(records, { sourceId, sourceName, onDuplicate = 'skip' } = {}) {
  const now = new Date();
  const result = { added: 0, updated: 0, skipped: 0, possiblyPaid: [] };
  const existing = await listPolicies();
  const byKey = new Map(existing.map((p) => [p.dupKey, p]));
  const toPut = [];
  const seen = new Set();

  for (const r of records) {
    const rec = normalizePolicy({ ...r, id: undefined, sourceId, sourceName }, now);
    if (hasErrors(validatePolicy(rec))) { result.skipped++; continue; }
    if (seen.has(rec.dupKey)) { result.skipped++; continue; }
    seen.add(rec.dupKey);
    const old = byKey.get(rec.dupKey);
    if (old) {
      if (onDuplicate === 'update') {
        toPut.push(normalizePolicy({
          ...old,
          customerName: rec.customerName || old.customerName,
          premiumAmount: rec.premiumAmount ?? old.premiumAmount,
          mobile: rec.mobile || old.mobile,
          policyStatus: rec.policyStatus || old.policyStatus,
          premiumTerm: rec.premiumTerm || old.premiumTerm,
          mode: rec.mode || old.mode,
          plan: rec.plan || old.plan,
        }, now));
        result.updated++;
      } else result.skipped++;
    } else {
      toPut.push(rec);
      byKey.set(rec.dupKey, rec);
      result.added++;
    }
  }

  // Older unpaid installments of policies that now have a later due date.
  const newest = new Map();
  for (const rec of toPut) if (!newest.has(rec.policyNumber) || newest.get(rec.policyNumber) < rec.dueDate) newest.set(rec.policyNumber, rec.dueDate);
  for (const p of existing) {
    const nd = newest.get(p.policyNumber);
    if (nd && p.paymentStatus !== 'paid' && p.dueDate < nd) result.possiblyPaid.push(p);
  }

  if (toPut.length) await tx('policies', 'readwrite', (s) => { toPut.forEach((p) => s.put(p)); });
  return result;
}

/** Patch one policy (follow-up status, payment, notes ...). */
export async function updatePolicy(id, patch) {
  const old = await getPolicy(id);
  if (!old) throw new Error('Record not found');
  const next = normalizePolicy({ ...old, ...patch, id });
  next.createdAt = old.createdAt;
  await putOne('policies', next);
  return next;
}

// ---------- activities (follow-up tracker) ----------

export const ACTIVITY_TYPES = ['call', 'whatsapp', 'visit', 'note', 'paid', 'status'];

export async function logActivity({ policyId, type, note = '' }, now = new Date()) {
  const a = { id: uid(), policyId, type, note: cleanText(note), at: now.toISOString(), date: todayISO(now) };
  await putOne('activities', a);
  return a;
}

export const listActivities = () => getAll('activities');

export async function activitiesFor(policyId) {
  const rows = await tx('activities', 'readonly', (s) => wrap(s.index('policyId').getAll(policyId)));
  return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Record a follow-up on a policy: updates its follow-up status and last follow-up date and writes a log entry. */
export async function recordFollowUp(policyId, { type = 'call', status = 'contacted', note = '' } = {}) {
  const now = new Date();
  const p = await updatePolicy(policyId, { followUpStatus: status, lastFollowUpDate: todayISO(now) });
  await logActivity({ policyId, type, note }, now);
  return p;
}

/** The only way a policy becomes "paid": an explicit user action. */
export async function confirmPayment(policyId, { paidDate, paidAmount = null, note = '' } = {}) {
  const now = new Date();
  const p = await updatePolicy(policyId, { paymentStatus: 'paid', paidDate: paidDate || todayISO(now), paidAmount, followUpStatus: 'completed' });
  await logActivity({ policyId, type: 'paid', note: note || 'Payment confirmed by advisor' }, now);
  return p;
}

export async function undoPayment(policyId) {
  const p = await updatePolicy(policyId, { paymentStatus: 'unpaid', paidDate: '', paidAmount: null });
  await logActivity({ policyId, type: 'status', note: 'Payment confirmation undone' });
  return p;
}

// ---------- imports (history) and original PDFs ----------

export async function addImportRecord(rec, blob = null) {
  const row = { id: uid(), at: new Date().toISOString(), ...rec };
  await tx(['imports', 'files'], 'readwrite', (imp, files) => {
    imp.put({ ...row, hasFile: !!blob });
    if (blob) files.put({ id: row.id, blob, name: rec.name, type: blob.type || 'application/pdf' });
  });
  return row;
}

export const listImports = async () => (await getAll('imports')).sort((a, b) => (a.at < b.at ? 1 : -1));
export const getImportFile = (id) => getOne('files', id);

export async function updateImportRecord(id, patch) {
  const row = await getOne('imports', id);
  if (row) await putOne('imports', { ...row, ...patch });
}

export async function deleteImport(id, { deleteRecords = false } = {}) {
  await tx(['imports', 'files', 'policies', 'activities'], 'readwrite', async (imp, files, pol, act) => {
    imp.delete(id);
    files.delete(id);
    if (deleteRecords) {
      const rows = await wrap(pol.index('sourceId').getAll(id));
      for (const p of rows) {
        pol.delete(p.id);
        const keys = await wrap(act.index('policyId').getAllKeys(p.id));
        keys.forEach((k) => act.delete(k));
      }
    }
  });
}

// ---------- backup and restore ----------

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type });
}

/** Build the full backup object. Original PDFs are optional because they can be large. */
export async function buildBackup({ includePdfs = false } = {}) {
  const [policies, imports, activities, profile, prefs] = await Promise.all([
    listPolicies(), listImports(), listActivities(), getProfile(), getPrefs(),
  ]);
  const backup = {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    counts: { policies: policies.length, imports: imports.length, activities: activities.length },
    includesPdfs: includePdfs,
    profile,
    prefs,
    policies: policies.map(({ dupKey, ...rest }) => rest),
    imports,
    activities,
    pdfs: [],
  };
  if (includePdfs) {
    for (const imp of imports) {
      const f = await getImportFile(imp.id);
      if (f?.blob) backup.pdfs.push({ id: imp.id, name: f.name, type: f.type, base64: await blobToBase64(f.blob) });
    }
  }
  return backup;
}

export function validateBackup(b) {
  if (!b || typeof b !== 'object') throw new Error('This file is not a backup.');
  if (b.format !== BACKUP_FORMAT) throw new Error('This file is not a LIC Smart Follow-up backup.');
  if (!Array.isArray(b.policies)) throw new Error('Backup is damaged: the policy list is missing.');
  if (b.version > 1) throw new Error('This backup was made by a newer version of the app. Please update the app first.');
  return true;
}

/**
 * Restore a backup. mode 'replace' wipes current data first; 'merge' adds records that are not already present.
 * Returns counts.
 */
export async function restoreBackup(b, { mode = 'merge' } = {}) {
  validateBackup(b);
  const cleaned = [];
  let invalid = 0;
  for (const p of b.policies) {
    const rec = normalizePolicy({ ...p });
    rec.createdAt = p.createdAt || rec.createdAt;
    rec.updatedAt = p.updatedAt || rec.updatedAt;
    if (hasErrors(validatePolicy(rec))) { invalid++; continue; }
    cleaned.push(rec);
  }
  if (mode === 'replace') {
    await Promise.all(['policies', 'imports', 'files', 'activities'].map(clearStore));
  }
  const existing = mode === 'merge' ? await listPolicies() : [];
  const keys = new Set(existing.map((p) => p.dupKey));
  const ids = new Set(existing.map((p) => p.id));
  let added = 0;
  let skipped = 0;
  const idMap = new Map();
  const toPut = [];
  for (const rec of cleaned) {
    if (mode === 'merge' && keys.has(rec.dupKey)) { skipped++; idMap.set(rec.id, existing.find((e) => e.dupKey === rec.dupKey).id); continue; }
    if (ids.has(rec.id)) { const old = rec.id; rec.id = uid(); idMap.set(old, rec.id); }
    toPut.push(rec);
    ids.add(rec.id);
    keys.add(rec.dupKey);
    added++;
  }
  await tx('policies', 'readwrite', (s) => { toPut.forEach((p) => s.put(p)); });

  const acts = (b.activities || []).filter((a) => a && a.id && a.policyId);
  const importsIn = (b.imports || []).filter((i) => i && i.id);
  await tx(['activities', 'imports'], 'readwrite', (actS, impS) => {
    for (const a of acts) actS.put({ ...a, policyId: idMap.get(a.policyId) || a.policyId });
    for (const i of importsIn) impS.put(i);
  });
  let pdfs = 0;
  for (const f of b.pdfs || []) {
    await putOne('files', { id: f.id, name: f.name, type: f.type, blob: base64ToBlob(f.base64, f.type || 'application/pdf') });
    pdfs++;
  }
  if (mode === 'replace') {
    if (b.profile) await saveProfile(b.profile);
    if (b.prefs) await setSetting('prefs', { ...DEFAULT_PREFS, ...b.prefs });
  } else if (b.profile?.advisorName) {
    const cur = await getProfile();
    if (!cur.advisorName) await saveProfile(b.profile);
  }
  return { added, skipped, invalid, activities: acts.length, pdfs };
}

export async function wipeEverything() {
  await Promise.all(['policies', 'imports', 'files', 'activities', 'settings'].map(clearStore));
}

// ---------- storage ----------

export async function storageInfo() {
  const info = { usage: null, quota: null, persisted: null };
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      info.usage = e.usage ?? null;
      info.quota = e.quota ?? null;
    }
    if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted();
  } catch { /* not available */ }
  return info;
}

export async function requestPersistentStorage() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

export function humanBytes(n) {
  if (n === null || n === undefined) return 'unknown';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
