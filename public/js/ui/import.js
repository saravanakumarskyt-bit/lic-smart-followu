// Import hub -> processing -> verification table -> report, plus processing history.
// Nothing is saved until the advisor reviews the table and presses Save.
import { h, icon, openSheet, toast, confirmDialog, promptDialog, clear, mount } from './dom.js';
import { state, reload } from '../store.js';
import * as DB from '../core/db.js';
import { extractTextItems, parseExtractedPages, openPdf, setPdfResources } from '../core/pdftext.js';
import { ocrPdfPages, parseOcrPages } from '../core/ocr.js';
import { csvToRecords } from '../core/csvimport.js';
import { validatePolicy, hasErrors, normalizePolicyNumber, normalizeMobile, parseAmount } from '../core/validate.js';
import { formatDate, todayISO } from '../core/dates.js';
import { formatINR } from '../core/messages.js';
import { saveFile, platformName } from '../platform.js';
import { openPaymentSheet } from './detail.js';
import { go } from '../router.js';

let session = null; // { stage: 'verify' | 'report', files, rows, options, report }
let pdfLib = null;
let rowSeq = 0;

// ---------- PDF.js loader (vendored, works offline) ----------
async function loadPdf() {
  if (pdfLib) return pdfLib;
  const base = new URL('../../vendor/pdfjs/', import.meta.url);
  const lib = await import(new URL('pdf.min.mjs', base).href);
  lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href;
  setPdfResources({
    standardFontDataUrl: new URL('standard_fonts/', base).href,
    cMapUrl: new URL('cmaps/', base).href,
    cMapPacked: true,
    wasmUrl: new URL('wasm/', base).href,
  });
  pdfLib = lib;
  return lib;
}

async function ocrAvailable() {
  try {
    const r = await fetch(new URL('../../vendor/tesseract/tesseract.min.js', import.meta.url).href, { method: 'HEAD' });
    return r.ok;
  } catch { return false; }
}

// ---------- rows ----------
const FIELDS = ['customerName', 'policyNumber', 'premiumAmount', 'dueDate', 'mobile'];

function makeRow(rec, fileIdx) {
  const row = {
    uid: ++rowSeq,
    fileIdx,
    page: rec.page || 0,
    raw: rec.rawText || '',
    viaOcr: !!rec.viaOcr,
    issues: rec.issues || [],
    confidence: rec.confidence ?? 1,
    needsReview: !!rec.needsReview,
    reviewed: false,
    selected: false,
    f: {
      customerName: rec.customerName || '',
      policyNumber: rec.policyNumber || '',
      premiumAmount: rec.premiumAmount === null || rec.premiumAmount === undefined ? '' : String(rec.premiumAmount),
      dueDate: rec.dueDate || '',
      mobile: rec.mobile || '',
    },
    extra: {
      policyStatus: rec.policyStatus || '', premiumTerm: rec.premiumTerm || '', mode: rec.mode || '', plan: rec.plan || '',
      commencementDate: rec.commencementDate, instalmentsDue: rec.instalmentsDue, totalPremium: rec.totalPremium, dueDateDerived: rec.dueDateDerived,
      paymentStatus: rec.paymentStatus, paidDate: rec.paidDate, followUpStatus: rec.followUpStatus, lastFollowUpDate: rec.lastFollowUpDate, notes: rec.notes,
    },
    errors: {}, warnings: {}, dupFile: false, dupDb: false,
  };
  validateRow(row);
  return row;
}

function rowToRecord(row) {
  const amt = row.f.premiumAmount.trim();
  return {
    customerName: row.f.customerName.trim(),
    policyNumber: normalizePolicyNumber(row.f.policyNumber) || row.f.policyNumber.trim(),
    premiumAmount: amt === '' ? null : parseAmount(amt),
    dueDate: row.f.dueDate,
    mobile: row.f.mobile.trim() ? (normalizeMobile(row.f.mobile) || row.f.mobile.trim()) : '',
    ...Object.fromEntries(Object.entries(row.extra).filter(([, v]) => v !== undefined && v !== '')),
  };
}

function validateRow(row) {
  const rec = rowToRecord(row);
  const v = validatePolicy(rec);
  if (row.f.premiumAmount.trim() !== '' && rec.premiumAmount === null) v.errors.premiumAmount = 'Premium amount must be a number';
  row.errors = v.errors;
  row.warnings = v.warnings;
}

function rowKey(row) {
  const r = rowToRecord(row);
  return r.policyNumber && r.dueDate ? `${r.policyNumber}|${r.dueDate}` : null;
}

function computeDuplicates() {
  const existing = new Set(state.policies.map((p) => p.dupKey || `${p.policyNumber}|${p.dueDate}`));
  const seen = new Set();
  for (const row of session.rows) {
    const k = rowKey(row);
    row.dupDb = !!k && existing.has(k);
    row.dupFile = !!k && seen.has(k);
    if (k) seen.add(k);
  }
}

const rowState = (row) => {
  if (Object.keys(row.errors).length) return 'error';
  if (row.dupDb || row.dupFile) return 'dup';
  if (row.needsReview && !row.reviewed) return 'review';
  return 'ready';
};

function defaultSelection(row) {
  return rowState(row) === 'ready';
}

function counts() {
  const rows = session.rows;
  const c = { total: rows.length, ready: 0, review: 0, failed: 0, dups: 0, missing: 0, selected: 0 };
  for (const r of rows) {
    const st = rowState(r);
    if (st === 'ready') c.ready++;
    if (st === 'review') c.review++;
    if (st === 'error') c.failed++;
    if (r.dupDb || r.dupFile) c.dups++;
    if (Object.keys(r.warnings).length) c.missing++;
    if (r.selected && !Object.keys(r.errors).length) c.selected++;
  }
  return c;
}

// ---------- processing ----------
async function processFiles(fileList, { keepCopy, onDuplicate }, ui) {
  const files = [];
  const rows = [];
  const lib = await loadPdf();
  let n = 0;
  for (const file of fileList) {
    n++;
    const entry = { name: file.name, size: file.size, file, kind: /\.(csv|txt)$/i.test(file.name) || /csv|text\/plain/.test(file.type) ? 'csv' : 'pdf', numPages: 0, scannedPages: [], skipped: [], method: 'text', error: '', password: undefined, rowCount: 0 };
    const fileIdx = files.push(entry) - 1;
    ui.set(`File ${n} of ${fileList.length}: ${file.name}`, 0);
    try {
      if (entry.kind === 'csv') {
        const parsed = csvToRecords(await file.text(), state.prefs.dateOrder);
        entry.method = 'csv';
        entry.skipped = parsed.skipped;
        parsed.records.forEach((r) => rows.push(makeRow(r, fileIdx)));
        entry.rowCount = parsed.records.length;
        if (!parsed.headerFound) entry.note = 'No header row was found, so each line was read by pattern. Please check carefully.';
        continue;
      }
      let ext = null;
      for (let attempt = 0; attempt < 4 && !ext; attempt++) {
        try {
          const data = new Uint8Array(await file.arrayBuffer());
          ext = await extractTextItems(lib, data, { password: entry.password, onProgress: (p) => ui.set(`File ${n} of ${fileList.length}: ${file.name}`, p.page / p.total, `Reading page ${p.page} of ${p.total}`) });
        } catch (e) {
          if (e?.name === 'PasswordException') {
            const pw = await promptDialog({ title: 'Password needed', label: `Password for ${file.name}`, type: 'password', confirmText: 'Unlock', hint: e.code === 2 ? 'That password was wrong. Try again.' : '' });
            if (pw === null) throw new Error('This PDF is password-protected and no password was given.');
            entry.password = pw;
          } else throw e;
        }
      }
      if (!ext) throw new Error('Could not open this PDF (wrong password).');
      entry.numPages = ext.numPages;
      entry.scannedPages = ext.pages.filter((p) => p.scanned).map((p) => p.page);
      const parsed = parseExtractedPages(ext.pages.filter((p) => !p.scanned));
      entry.skipped = parsed.skipped;
      entry.headerFound = parsed.headerFound;
      parsed.records.forEach((r) => rows.push(makeRow(r, fileIdx)));
      entry.rowCount = parsed.records.length;
    } catch (e) {
      entry.error = e?.message || String(e);
      console.error(e);
    }
  }
  session = { stage: 'verify', files, rows, options: { keepCopy, onDuplicate }, tab: 'all', shown: 60 };
  computeDuplicates();
  session.rows.forEach((r) => { r.selected = defaultSelection(r); });
}

// ---------- screens ----------
export async function renderImport(root) {
  if (session?.stage === 'verify') return renderVerify(root);
  if (session?.stage === 'report') return renderReport(root);
  return renderHub(root);
}

async function renderHub(root) {
  const keep = h('input', { type: 'checkbox', checked: true, id: 'keepcopy' });
  const dupSel = h('select', { class: 'input', 'aria-label': 'Duplicates' },
    h('option', { value: 'skip' }, 'Skip records that are already saved'),
    h('option', { value: 'update' }, 'Update saved records with the new values'));
  const status = h('div');

  const start = async (list) => {
    if (!list.length) return;
    const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: '0%' } }));
    const label = h('div', { class: 'strong' });
    const sub = h('div', { class: 'muted small' });
    mount(status, h('div', { class: 'card' }, h('h3', 'Reading your files...'), label, bar, sub, h('p', { class: 'muted small' }, 'Large PDFs can take a minute. Please keep the app open.')));
    const ui = { set: (t, f, s = '') => { label.textContent = t; bar.firstChild.style.width = `${Math.round((f || 0) * 100)}%`; sub.textContent = s; } };
    try {
      await processFiles(list, { keepCopy: keep.checked, onDuplicate: dupSel.value }, ui);
      renderImport(root);
    } catch (e) {
      console.error(e);
      mount(status, h('div', { class: 'banner bad' }, icon('alert', 20), h('div', {}, h('strong', 'Something went wrong'), h('div', { class: 'small' }, e.message || String(e)))));
    }
  };

  const pdfInput = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true, id: 'pdf-input', onchange: (e) => { const l = [...e.target.files]; e.target.value = ''; start(l); } });
  const csvInput = h('input', { type: 'file', accept: '.csv,text/csv,text/plain,application/vnd.ms-excel', hidden: true, id: 'csv-input', onchange: (e) => { const l = [...e.target.files]; e.target.value = ''; start(l); } });

  const drop = h('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': 'Choose PDF files', onclick: () => pdfInput.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pdfInput.click(); } },
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); start([...e.dataTransfer.files].filter((f) => /pdf|csv/i.test(f.type + f.name))); } },
  icon('upload', 40), h('strong', 'Choose PDF files'), h('span', { class: 'muted' }, 'Premium due list from LIC, email or Google Drive'));

  const hist = await DB.listImports();
  mount(root, 
    h('div', { class: 'page-head' }, h('h1', 'Import')),
    drop, pdfInput, csvInput,
    h('div', { class: 'btn-row wrap' },
      h('button', { class: 'btn primary', onclick: () => pdfInput.click() }, icon('file', 18), 'Select PDFs'),
      h('button', { class: 'btn soft', onclick: () => csvInput.click() }, icon('list', 18), 'Import CSV')),
    h('label', { class: 'check' }, keep, h('span', 'Keep a copy of each original PDF in this app (so you can download it later)')),
    h('label', { class: 'field' }, h('span', 'If a record is already saved'), dupSel),
    status,
    h('details', { class: 'card flat' }, h('summary', 'How importing works'),
      h('ol', { class: 'steps' },
        h('li', 'Select one or more PDFs. You can pick many at once; Android shows Downloads, Drive and email attachments.'),
        h('li', 'The app reads the table on your phone. Nothing is uploaded anywhere.'),
        h('li', 'You check the extracted values in a table and fix anything wrong.'),
        h('li', 'Only the records you approve are saved.')),
      h('p', { class: 'muted small' }, 'Scanned (photo) PDFs have no text, so they need OCR, which is slower and less accurate. You will be asked.')),
    h('div', { class: 'list-head' }, h('h2', { class: 'section-title nm' }, 'Recent imports'), hist.length > 3 && h('button', { class: 'btn ghost sm', onclick: () => go('/history') }, 'View all')),
    hist.length ? h('div', { class: 'list' }, hist.slice(0, 3).map(historyCard)) : h('p', { class: 'muted' }, 'No imports yet.'));
}

function statusLine(label, n, cls = '') { return h('div', { class: `sumcell ${cls}` }, h('div', { class: 'sumnum' }, String(n)), h('div', { class: 'sumlbl' }, label)); }

function discard() {
  session = null;
}

function renderVerify(root) {
  computeDuplicates();
  const { files, options } = session;
  const c = counts();
  const failedFiles = files.filter((f) => f.error);
  const scannedFiles = files.map((f, i) => ({ f, i })).filter(({ f }) => f.scannedPages.length && !f.error);

  const summary = h('div', { class: 'sumgrid' });
  const footer = h('div', { class: 'savebar' });
  const tableWrap = h('div', { class: 'vwrap' });
  const tabsEl = h('div', { class: 'chips', role: 'tablist' });

  const refresh = () => {
    computeDuplicates();
    const k = counts();
    mount(summary, 
      statusLine('Records found', k.total), statusLine('Ready', k.ready, 'ok'), statusLine('Need review', k.review, 'warn'),
      statusLine('Failed', k.failed, 'bad'), statusLine('Duplicates', k.dups, 'muted'), statusLine('Missing info', k.missing, 'muted'));
    mount(footer, 
      h('div', { class: 'savebar-info' }, h('strong', `${k.selected} selected`), h('span', { class: 'muted small' }, ` of ${k.total}`)),
      h('button', { class: 'btn primary', disabled: k.selected === 0 || session.saving, onclick: save }, icon('check', 18), `Save ${k.selected} record${k.selected === 1 ? '' : 's'}`));
    const tabs = [['all', 'All', k.total], ['review', 'Needs review', k.review], ['error', 'Failed', k.failed], ['dup', 'Duplicates', k.dups]];
    mount(tabsEl, tabs.map(([id, l, n]) => h('button', { role: 'tab', 'aria-selected': String(session.tab === id), class: `chip-btn ${session.tab === id ? 'on' : ''}`, onclick: () => { session.tab = id; session.shown = 60; drawTable(); refresh(); } }, l, h('span', { class: 'chip-n' }, String(n)))));
  };

  const visible = () => session.rows.filter((r) => {
    const st = rowState(r);
    return session.tab === 'all' || (session.tab === 'review' && st === 'review') || (session.tab === 'error' && st === 'error') || (session.tab === 'dup' && (r.dupDb || r.dupFile));
  });

  const drawTable = () => {
    const rows = visible();
    if (!rows.length) { mount(tableWrap, h('p', { class: 'muted center pad' }, session.rows.length ? 'No records in this tab.' : 'No policy rows were found in these files.')); return; }
    const shown = rows.slice(0, session.shown);
    const tbody = h('tbody');
    shown.forEach((r) => tbody.appendChild(rowEl(r, refresh, files)));
    mount(tableWrap, 
      h('div', { class: 'vscroll' }, h('table', { class: 'vtable' },
        h('thead', h('tr', h('th', { class: 'c-sel' }, ''), h('th', { class: 'c-st' }, ''), h('th', 'Customer name'), h('th', 'Policy no.'), h('th', 'Due date'), h('th', 'Premium ₹'), h('th', 'Mobile'), h('th', 'Notes'), h('th', ''))),
        tbody)),
      rows.length > shown.length && h('div', { class: 'more-wrap' }, h('button', { class: 'btn ghost', onclick: () => { session.shown += 100; drawTable(); } }, `Show more (${rows.length - shown.length} left)`)));
  };

  async function save() {
    const chosen = session.rows.filter((r) => r.selected && !Object.keys(r.errors).length);
    if (!chosen.length) return;
    const unreviewed = chosen.filter((r) => rowState(r) === 'review').length;
    if (unreviewed && !(await confirmDialog({ title: 'Some rows are uncertain', message: `${unreviewed} selected record${unreviewed === 1 ? ' is' : 's are'} marked "needs review". Save them only if you have checked them against the PDF.`, confirmText: 'I checked them, save' }))) return;
    session.saving = true;
    refresh();
    try {
      const report = { files: [], added: 0, updated: 0, skipped: 0, possiblyPaid: [] };
      for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        const mine = session.rows.filter((r) => r.fileIdx === i);
        const picked = chosen.filter((r) => r.fileIdx === i);
        if (entry.error) {
          await DB.addImportRecord({ name: entry.name, size: entry.size, kind: entry.kind, method: entry.method, status: 'failed', errors: [entry.error], counts: { found: 0, saved: 0, updated: 0, skipped: 0, failed: 0, duplicates: 0, missing: 0 } });
          report.files.push({ name: entry.name, error: entry.error });
          continue;
        }
        const rec = await DB.addImportRecord({
          name: entry.name, size: entry.size, kind: entry.kind, pages: entry.numPages, method: entry.scannedPages.length ? 'text+ocr' : entry.method, status: 'saved',
          errors: [...(entry.skipped.length ? [`${entry.skipped.length} line(s) were skipped (headings, totals or text without a policy number)`] : [])],
          counts: { found: mine.length, saved: 0, updated: 0, skipped: 0, failed: mine.filter((r) => Object.keys(r.errors).length).length, duplicates: mine.filter((r) => r.dupDb || r.dupFile).length, missing: mine.filter((r) => Object.keys(r.warnings).length).length },
        }, options.keepCopy && entry.kind === 'pdf' ? entry.file : null);
        const res = await DB.saveImportedPolicies(picked.map(rowToRecord), { sourceId: rec.id, sourceName: entry.name, onDuplicate: options.onDuplicate });
        await DB.updateImportRecord(rec.id, { counts: { ...rec.counts, saved: res.added, updated: res.updated, skipped: res.skipped + (mine.length - picked.length) } });
        report.files.push({ name: entry.name, found: mine.length, added: res.added, updated: res.updated, skipped: res.skipped, notSelected: mine.length - picked.length });
        report.added += res.added; report.updated += res.updated; report.skipped += res.skipped;
        report.possiblyPaid.push(...res.possiblyPaid);
      }
      const seen = new Set();
      report.possiblyPaid = report.possiblyPaid.filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
      // Switch to the report first: the global refresh triggered by 'data-changed' then draws it in the current view.
      session = { stage: 'report', report };
      await reload();
      document.dispatchEvent(new CustomEvent('data-changed'));
    } catch (e) {
      console.error(e);
      session.saving = false;
      toast(`Could not save: ${e.message}`, { kind: 'bad', ms: 6000 });
      refresh();
    }
  }

  const bulk = h('div', { class: 'btn-row wrap' },
    h('button', { class: 'btn soft sm', onclick: () => { session.rows.forEach((r) => { r.selected = rowState(r) === 'ready'; }); drawTable(); refresh(); } }, 'Select ready rows'),
    h('button', { class: 'btn soft sm', onclick: async () => {
      const n = session.rows.filter((r) => rowState(r) === 'review').length;
      if (!n) return;
      if (await confirmDialog({ title: 'Mark as reviewed?', message: `This selects ${n} uncertain row${n === 1 ? '' : 's'} for saving. Do this only after checking them against the PDF.`, confirmText: 'I checked them' })) {
        session.rows.forEach((r) => { if (rowState(r) === 'review') { r.reviewed = true; r.selected = true; } }); drawTable(); refresh();
      }
    } }, 'Mark uncertain as reviewed'),
    h('button', { class: 'btn ghost sm', onclick: () => { session.rows.forEach((r) => { r.selected = false; }); drawTable(); refresh(); } }, 'Deselect all'));

  const fileNotes = h('div');
  const drawFileNotes = () => {
    mount(fileNotes, 
      failedFiles.map((f) => h('div', { class: 'banner bad' }, icon('alert', 20), h('div', {}, h('strong', f.name), h('div', { class: 'small' }, `Could not be read: ${f.error}`)))),
      files.filter((f) => !f.error && f.rowCount === 0 && !f.scannedPages.length).map((f) => h('div', { class: 'banner warn' }, icon('alert', 20), h('div', {}, h('strong', f.name), h('div', { class: 'small' }, 'No policy rows were recognised in this file. If it is a different layout, use "Add customer" or import a CSV.')))),
      session.rows.some((r) => r.extra.dueDateDerived)
        ? h('div', { class: 'banner info' }, icon('alert', 20), h('div', {}, h('strong', 'Due dates are worked out from the list'), h('div', { class: 'small' }, 'This list shows only the due month (FUP). The day of the month is taken from each policy\'s date of commencement, which is how LIC premiums fall due. Check a few against the policy if you like.')))
        : null,
      files.filter((f) => f.note).map((f) => h('div', { class: 'banner info' }, icon('alert', 20), h('div', {}, h('strong', f.name), h('div', { class: 'small' }, f.note)))),
      scannedFiles.map(({ f, i }) => h('div', { class: 'banner warn' }, icon('eye', 20),
        h('div', {}, h('strong', f.name), h('div', { class: 'small' }, `Page${f.scannedPages.length > 1 ? 's' : ''} ${f.scannedPages.slice(0, 12).join(', ')}${f.scannedPages.length > 12 ? '...' : ''} look${f.scannedPages.length > 1 ? '' : 's'} scanned (no text). OCR can read them but may make mistakes; every OCR row will need your review.`)),
        h('button', { class: 'btn primary sm', onclick: () => runOcr(i) }, 'Run OCR'))),
      files.some((f) => f.skipped.length) && h('details', { class: 'card flat' }, h('summary', 'Extraction details and skipped lines'),
        files.filter((f) => f.skipped.length).map((f) => h('div', {}, h('strong', f.name), h('ul', { class: 'small' }, f.skipped.slice(0, 40).map((s) => h('li', `${s.page ? 'p.' + s.page + ': ' : ''}${s.text} (${s.reason})`)), f.skipped.length > 40 && h('li', `...and ${f.skipped.length - 40} more`))))));
  };

  async function runOcr(fileIdx) {
    const entry = files[fileIdx];
    if (!(await ocrAvailable())) {
      await confirmDialog({ title: 'OCR is not installed', message: 'This build does not include the OCR files, so scanned pages cannot be read here. Ask the person who built the app to run "npm run vendor:ocr" (see README), or add these customers manually or by CSV.', confirmText: 'OK', cancelText: 'Close' });
      return;
    }
    const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: '0%' } }));
    const txt = h('div', { class: 'muted' }, 'Starting OCR... the first run loads the language data.');
    let cancelled = false;
    const sheet = openSheet(() => [h('p', `Reading ${entry.scannedPages.length} scanned page(s) from ${entry.name}`), bar, txt, h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => { cancelled = true; sheet.close(); } }, 'Cancel'))], { title: 'Running OCR', onClose: () => { cancelled = true; } });
    try {
      const lib = await loadPdf();
      const { doc, task } = await openPdf(lib, new Uint8Array(await entry.file.arrayBuffer()), entry.password ? { password: entry.password } : {});
      const pages = await ocrPdfPages(doc, entry.scannedPages, {
        shouldCancel: () => cancelled,
        onProgress: (p) => { if (p.stage === 'ocr-page') { bar.firstChild.style.width = `${Math.round((p.done / p.total) * 100)}%`; txt.textContent = `Page ${p.done} of ${p.total} done`; } },
      });
      await task.destroy();
      if (cancelled) return;
      const parsed = parseOcrPages(pages);
      parsed.records.forEach((r) => session.rows.push(makeRow(r, fileIdx)));
      entry.rowCount += parsed.records.length;
      entry.skipped.push(...parsed.skipped);
      entry.scannedPages = [];
      entry.method = 'ocr';
      sheet.close();
      toast(`OCR found ${parsed.records.length} possible record${parsed.records.length === 1 ? '' : 's'}. Please check each one.`, { ms: 5000 });
      renderImport(root);
    } catch (e) {
      console.error(e);
      sheet.close();
      toast(`OCR failed: ${e.message}`, { kind: 'bad', ms: 6000 });
    }
  }

  mount(root, 
    h('div', { class: 'page-head' },
      h('h1', 'Check extracted data'),
      h('button', { class: 'btn ghost sm', onclick: async () => { if (await confirmDialog({ title: 'Discard this import?', message: 'Nothing has been saved yet. The extracted rows will be thrown away.', confirmText: 'Discard', danger: true })) { discard(); renderImport(root); } } }, 'Discard')),
    h('p', { class: 'muted' }, `${files.length} file${files.length === 1 ? '' : 's'} read. Check the table, fix any value by tapping it, and save. Rows with a problem are not selected automatically.`),
    summary, fileNotes, bulk, tabsEl, tableWrap, footer);
  drawFileNotes();
  drawTable();
  refresh();
}

function rowEl(row, refresh, files) {
  const tr = h('tr');
  const cell = (field, attrs = {}) => {
    const inp = h('input', { class: 'cell-input', value: row.f[field], 'aria-label': field, autocomplete: 'off', ...attrs });
    inp.addEventListener('input', () => {
      row.f[field] = inp.value;
      row.reviewed = true;
      validateRow(row);
      if (!Object.keys(row.errors).length && rowState(row) !== 'dup') row.selected = true;
      paint();
      refresh();
    });
    return inp;
  };
  const sel = h('input', { type: 'checkbox', 'aria-label': 'Include this record', checked: row.selected, onchange: (e) => { row.selected = e.target.checked; paint(); refresh(); } });
  const st = h('span', { class: 'st' });
  const note = h('div', { class: 'small muted vnote' });
  const inputs = {
    customerName: cell('customerName'),
    policyNumber: cell('policyNumber', { inputmode: 'numeric' }),
    premiumAmount: cell('premiumAmount', { inputmode: 'decimal' }),
    dueDate: cell('dueDate', { type: 'date' }),
    mobile: cell('mobile', { inputmode: 'tel' }),
  };
  inputs.dueDate.value = row.f.dueDate;

  const paint = () => {
    const s = rowState(row);
    tr.className = `vrow ${s}`;
    sel.checked = row.selected && !Object.keys(row.errors).length;
    sel.disabled = !!Object.keys(row.errors).length;
    mount(st, icon(s === 'ready' ? 'check' : s === 'error' ? 'x' : s === 'dup' ? 'copy' : 'alert', 16));
    st.title = s === 'ready' ? 'Looks good' : s === 'error' ? 'Fix the highlighted value' : s === 'dup' ? (row.dupDb ? 'Already saved in this app' : 'Repeated in this file') : 'Please check this row';
    for (const f of FIELDS) {
      inputs[f].classList.toggle('bad', !!row.errors[f]);
      inputs[f].classList.toggle('warn', !row.errors[f] && !!row.warnings[f]);
      inputs[f].title = row.errors[f] || row.warnings[f] || '';
    }
    const msgs = [...Object.values(row.errors), ...row.issues.filter((i) => !/Read by OCR/.test(i)), ...(row.viaOcr ? ['OCR: check every value'] : []), ...(row.dupDb ? ['Already saved'] : []), ...(row.dupFile ? ['Repeated in this file'] : []), ...Object.values(row.warnings)];
    note.textContent = [...new Set(msgs)].join('. ');
  };
  paint();

  const previewBtn = row.page && files[row.fileIdx]?.kind === 'pdf'
    ? h('button', { class: 'icon-btn', 'aria-label': 'Show PDF page', title: 'Show PDF page', onclick: () => previewRow(row, files[row.fileIdx]) }, icon('eye', 18))
    : null;
  const remove = h('button', { class: 'icon-btn', 'aria-label': 'Remove this row', title: 'Remove row', onclick: () => { session.rows = session.rows.filter((r) => r !== row); tr.remove(); refresh(); } }, icon('trash', 18));

  tr.append(
    h('td', { class: 'c-sel' }, sel), h('td', { class: 'c-st' }, st),
    h('td', inputs.customerName), h('td', inputs.policyNumber), h('td', inputs.dueDate), h('td', inputs.premiumAmount), h('td', inputs.mobile),
    h('td', { class: 'c-note' }, note, row.page ? h('div', { class: 'tiny muted' }, `${files[row.fileIdx]?.name || ''}${row.page ? ' · p.' + row.page : ''}`) : null),
    h('td', { class: 'c-act' }, previewBtn, remove));
  return tr;
}

async function previewRow(row, entry) {
  const canvas = h('canvas', { class: 'pdf-canvas', 'aria-label': `PDF page ${row.page}` });
  const msg = h('p', { class: 'muted' }, 'Loading page...');
  let task = null;
  openSheet(() => [
    h('p', { class: 'small muted' }, `${entry.name} · page ${row.page}`),
    row.raw ? h('div', { class: 'rawbox' }, h('div', { class: 'tiny muted' }, 'Text read from this row'), h('code', row.raw)) : null,
    msg, h('div', { class: 'canvas-wrap' }, canvas),
  ], { title: 'PDF preview', wide: true, onClose: () => { task?.destroy?.(); } });
  try {
    const lib = await loadPdf();
    const opened = await openPdf(lib, new Uint8Array(await entry.file.arrayBuffer()), entry.password ? { password: entry.password } : {});
    task = opened.task;
    const page = await opened.doc.getPage(row.page);
    const base = page.getViewport({ scale: 1 });
    const width = Math.min(window.innerWidth - 32, 900);
    const scale = Math.max(1, (width / base.width) * (window.devicePixelRatio > 1 ? 1.5 : 1));
    const vp = page.getViewport({ scale });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = '100%';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    msg.remove();
  } catch (e) {
    msg.textContent = `Could not show this page: ${e.message}`;
  }
}

function renderReport(root) {
  const r = session.report;
  mount(root, 
    h('div', { class: 'page-head' }, h('h1', 'Import complete')),
    h('div', { class: 'sumgrid' }, statusLine('New records', r.added, 'ok'), statusLine('Updated', r.updated, 'info'), statusLine('Skipped', r.skipped, 'muted')),
    h('div', { class: 'list' }, r.files.map((f) => h('div', { class: 'card flat' }, h('strong', f.name), f.error
      ? h('div', { class: 'txt-bad small' }, `Could not be read: ${f.error}`)
      : h('div', { class: 'small muted' }, `${f.found} found · ${f.added} added · ${f.updated} updated · ${f.skipped} skipped as duplicates · ${f.notSelected} not selected`)))),
    r.possiblyPaid.length > 0 && h('section', { class: 'card' },
      h('h3', 'Were these paid?'),
      h('p', { class: 'muted small' }, 'This list has a later due date for these policies, so the earlier premium may have been paid. Nothing is marked paid automatically. Confirm only the ones you know were paid.'),
      h('div', { class: 'list' }, r.possiblyPaid.slice(0, 50).map((p) => h('div', { class: 'row-btn static' },
        h('div', {}, h('strong', p.customerName || 'Customer'), h('div', { class: 'small muted' }, `Policy ${p.policyNumber} · due ${formatDate(p.dueDate)}${p.premiumAmount ? ' · ' + formatINR(p.premiumAmount) : ''}`)),
        h('button', { class: 'btn ok sm', onclick: () => openPaymentSheet(p) }, 'Confirm paid'))))),
    h('div', { class: 'btn-row wrap' },
      h('button', { class: 'btn primary', onclick: () => { session = null; go('/policies/today'); } }, 'See due policies'),
      h('button', { class: 'btn soft', onclick: () => { session = null; renderImport(root); } }, 'Import more')));
}

// ---------- history ----------
function historyCard(i) {
  const c = i.counts || {};
  return h('div', { class: 'card flat hist' },
    h('div', { class: 'hist-top' }, h('strong', i.name), h('span', { class: `badge ${i.status === 'failed' ? 'bad' : 'ok'}` }, i.status === 'failed' ? 'Failed' : 'Saved')),
    h('div', { class: 'small muted' }, `${formatDate(i.at.slice(0, 10))} · ${i.kind === 'csv' ? 'CSV' : (i.pages || '?') + ' page(s)'} · ${i.method || ''}${i.size ? ' · ' + DB.humanBytes(i.size) : ''}`),
    i.status !== 'failed' && h('div', { class: 'small' }, `${c.found ?? 0} found · ${c.saved ?? 0} saved · ${c.updated ?? 0} updated · ${c.skipped ?? 0} skipped · ${c.failed ?? 0} failed · ${c.duplicates ?? 0} duplicates · ${c.missing ?? 0} missing info`),
    (i.errors || []).map((e) => h('div', { class: 'small txt-bad' }, e)),
    h('div', { class: 'btn-row wrap' },
      i.hasFile && h('button', { class: 'btn soft sm', onclick: async () => { const f = await DB.getImportFile(i.id); if (!f?.blob) { toast('The original file is not stored.', { kind: 'warn' }); return; } const r = await saveFile(f.name || i.name, f.blob, 'application/pdf'); if (r !== 'cancelled') toast(r === 'downloaded' ? 'Downloaded' : 'Choose where to save it'); } }, icon('download', 16), 'Download PDF'),
      h('button', { class: 'btn danger-soft sm', onclick: () => deleteImportFlow(i) }, icon('trash', 16), 'Delete')));
}

function deleteImportFlow(i) {
  const n = state.policies.filter((p) => p.sourceId === i.id).length;
  openSheet((close) => [
    h('p', `Delete the import "${i.name}"?`),
    n > 0 ? h('p', { class: 'muted' }, `${n} customer record${n === 1 ? ' was' : 's were'} created from it.`) : null,
    h('div', { class: 'btn-col' },
      h('button', { class: 'btn soft', onclick: async () => { await DB.deleteImport(i.id); close(); await reload(); toast('Import entry and stored PDF deleted. Customer records kept.'); document.dispatchEvent(new CustomEvent('data-changed')); } }, 'Delete the file only, keep the records'),
      n > 0 && h('button', { class: 'btn danger', onclick: async () => { await DB.deleteImport(i.id, { deleteRecords: true }); close(); await reload(); toast(`Deleted the file and ${n} record${n === 1 ? '' : 's'}.`); document.dispatchEvent(new CustomEvent('data-changed')); } }, `Delete the file and its ${n} record${n === 1 ? '' : 's'}`),
      h('button', { class: 'btn ghost', onclick: close }, 'Cancel')),
  ], { title: 'Delete import' });
}

export async function renderHistory(root) {
  const hist = await DB.listImports();
  clear(root);
  root.append(
    h('div', { class: 'page-head' }, h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => go('/more') }, icon('back')), h('h1', 'Import history')),
    hist.length ? h('div', { class: 'list' }, hist.map(historyCard)) : h('p', { class: 'muted' }, 'No imports yet.'));
}

export const importSessionActive = () => !!session;
/** Called when the advisor leaves the Import screen or taps Import again: a finished report is not kept around. */
export function dismissReport() { if (session?.stage === 'report') session = null; }
export { platformName, todayISO };
