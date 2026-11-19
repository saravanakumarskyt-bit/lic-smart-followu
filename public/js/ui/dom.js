// Tiny DOM toolkit. Customer data is ALWAYS inserted as text nodes (never innerHTML), so a malicious or
// malformed PDF cannot inject markup or script into the app.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple' || k === 'readOnly' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

// ---------- icons (inline SVG, trusted constants) ----------
const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.4c1.9.8 3 2.7 3 5.6"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z"/>',
  whatsapp: '<path d="M4 20l1.3-4.2A8 8 0 1 1 8.4 18.8L4 20Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.3-1.8-1-1 .6a4 4 0 0 1-1.8-1.8l.6-1-1-1.8L9 9.5Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 21h4"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
  alert: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4.5M12 17.5v.1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  file: '<path d="M6 3h8l5 5v13H6V3Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  rupee: '<path d="M7 5h10M7 9h10M7 5c5 0 7 1.5 7 4s-2.500 4-7 4l8 6"/>',
  eye: '<path d="M2 12s3.600-6.500 10-6.500S22 12 22 12s-3.600 6.500-10 6.500S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.700 3.100 3 7 3s7-1.300 7-3V6M5 12c0 1.700 3.100 3 7 3s7-1.300 7-3"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.500-5.800L4 8.500"/><path d="M4 4v4.500h4.500M12 8v4l3 2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.600 2.600 0 1 1 3.700 2.400c-.8.400-1.200 1-1.200 1.800M12 17v.1"/>',
  star: '<path d="m12 3.500 2.600 5.400 5.900.8-4.300 4.100 1 5.900-5.200-2.800-5.200 2.800 1-5.900-4.300-4.100 5.900-.8L12 3.500Z"/>',
  moon: '<path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500Z"/>',
};

export function icon(name, size = 20, cls = '') {
  const span = document.createElement('span');
  span.className = `ic ${cls}`.trim();
  span.style.width = span.style.height = `${size}px`;
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

// ---------- toast ----------
let toastTimer = null;
export function toast(message, { kind = 'info', ms = 3200 } = {}) {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(el); }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, ms);
}

// ---------- sheets / dialogs (Android back button closes the top one) ----------
// One extra history entry exists while ANY sheet is open, so the browser/Android back button closes the top sheet.
// Chained sheets (close one, open the next at once) reuse that single entry, which avoids history races.
const stack = [];
let pushed = false;
let suppressPop = false;

function ensurePushed() {
  if (!pushed) { history.pushState({ sheet: true }, ''); pushed = true; }
}

function releaseHistory() {
  // Deferred so a sheet opened right after this one keeps the existing entry instead of racing with back().
  setTimeout(() => {
    if (stack.length || !pushed) return;
    pushed = false;
    // Only pop our own entry. If the app navigated in the meantime, history.state is no longer ours: leave it alone.
    if (history.state && history.state.sheet) { suppressPop = true; history.back(); }
  }, 0);
}

window.addEventListener('popstate', () => {
  if (suppressPop) { suppressPop = false; return; }
  if (!stack.length) return;
  pushed = false; // the browser already consumed our entry
  removeTop();
  if (stack.length) ensurePushed();
});

function removeTop() {
  const s = stack.pop();
  if (!s) return;
  s.backdrop.classList.add('closing');
  setTimeout(() => s.backdrop.remove(), 120);
  document.body.classList.toggle('noscroll', stack.length > 0);
  s.onClose?.();
}

/**
 * Open a bottom sheet. `build(close, body)` may return nodes to show, or fill `body` itself and return nothing.
 * Returns { close, el, body }.
 */
export function openSheet(build, { title = '', onClose, wide = false, className = '' } = {}) {
  const backdrop = h('div', { class: 'backdrop' });
  const body = h('div', { class: 'sheet-body' });
  const close = () => {
    const i = stack.findIndex((s) => s.backdrop === backdrop);
    if (i < 0) return;
    if (i === stack.length - 1) { removeTop(); releaseHistory(); }
    else { const [s] = stack.splice(i, 1); s.backdrop.remove(); s.onClose?.(); }
  };
  const sheet = h('div', { class: `sheet ${wide ? 'wide' : ''} ${className}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
    h('div', { class: 'sheet-head' },
      h('h2', title),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('x'))),
    body);
  backdrop.appendChild(sheet);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  stack.push({ backdrop, onClose });
  document.body.appendChild(backdrop);
  document.body.classList.add('noscroll');
  ensurePushed();
  const nodes = build(close, body);
  if (nodes !== undefined && nodes !== null && !(Array.isArray(nodes) && nodes.length === 0)) mount(body, nodes);
  return { close, el: sheet, body };
}

export function openSheetCount() { return stack.length; }

/** Promise-based confirmation dialog. */
export function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    openSheet((close) => [
      h('p', { class: 'dialog-msg' }, message),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', onclick: () => { done(false); close(); } }, cancelText),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { done(true); close(); } }, confirmText)),
    ], { title, onClose: () => done(false) });
  });
}

/** Prompt for a single text value. */
export function promptDialog({ title, label, value = '', type = 'text', confirmText = 'OK', hint = '' }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    openSheet((close) => {
      const input = h('input', { type, value, class: 'input', autocomplete: 'off', 'aria-label': label });
      const go = () => { done(input.value); close(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      setTimeout(() => input.focus(), 50);
      return [
        h('label', { class: 'field' }, h('span', label), input, hint && h('small', hint)),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn ghost', onclick: () => { done(null); close(); } }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: go }, confirmText)),
      ];
    }, { title, onClose: () => done(null) });
  });
}

export function field(label, input, hint = '') {
  return h('label', { class: 'field' }, h('span', label), input, hint ? h('small', hint) : null);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
