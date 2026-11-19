// Policy detail, add/edit form, follow-up log and payment confirmation.
import { h, icon, openSheet, toast, confirmDialog, field, mount } from './dom.js';
import { state, reload, ctx } from '../store.js';
import * as DB from '../core/db.js';
import { formatDate, formatDateDMY, todayISO, isValidISO } from '../core/dates.js';
import { formatINR } from '../core/messages.js';
import { bucketOf, daysUntil } from '../core/due.js';
import { validatePolicy, normalizeMobile, normalizePolicyNumber, parseAmount } from '../core/validate.js';
import { openMessageSheet } from './message.js';
import { openExternal } from '../platform.js';

export const FOLLOWUP_LABEL = { pending: 'Pending', contacted: 'Contacted', promised: 'Promised to pay', completed: 'Completed' };
const ACT_LABEL = { call: 'Phone call', whatsapp: 'WhatsApp', visit: 'Visit', note: 'Note', paid: 'Payment', status: 'Update' };

export function dueBadge(p) {
  const b = bucketOf(p, ctx());
  const d = daysUntil(p, state.today);
  switch (b) {
    case 'paid': return { text: 'Paid', cls: 'ok' };
    case 'overdue': return { text: `${-d} day${d === -1 ? '' : 's'} overdue`, cls: 'bad' };
    case 'stale': return { text: `Old: ${-d} days ago`, cls: 'muted' };
    case 'today': return { text: 'Due today', cls: 'hot' };
    case 'tomorrow': return { text: 'Due tomorrow', cls: 'warn' };
    default: return { text: `In ${d} days`, cls: d <= 7 ? 'info' : 'muted' };
  }
}

async function changed(msg) {
  await reload();
  if (msg) toast(msg);
  document.dispatchEvent(new CustomEvent('data-changed'));
}

// ---------- add / edit ----------
export function openPolicyForm(existing = null, { prefill = {} } = {}) {
  const base = existing || { customerName: '', policyNumber: '', premiumAmount: '', dueDate: '', mobile: '', policyStatus: '', premiumTerm: '', mode: '', notes: '', followUpStatus: 'pending', ...prefill };
  openSheet((close) => {
    const inp = (name, attrs = {}) => h('input', { class: 'input', name, value: base[name] ?? '', autocomplete: 'off', ...attrs });
    const name = inp('customerName', { placeholder: 'e.g. Ramesh Kumar', maxlength: '120' });
    const policy = inp('policyNumber', { inputmode: 'numeric', placeholder: '9 digit policy number', maxlength: '20' });
    const amount = inp('premiumAmount', { inputmode: 'decimal', placeholder: 'e.g. 12500' });
    const due = h('input', { class: 'input', type: 'date', name: 'dueDate', value: base.dueDate || '' });
    const mobile = inp('mobile', { inputmode: 'tel', placeholder: '10 digit mobile', maxlength: '16' });
    const status = inp('policyStatus', { placeholder: 'e.g. In Force' });
    const term = inp('premiumTerm', { placeholder: 'e.g. 20' });
    const mode = inp('mode', { placeholder: 'Yly / Hly / Qly / Mly' });
    const fu = h('select', { class: 'input', name: 'followUpStatus' }, Object.entries(FOLLOWUP_LABEL).map(([v, l]) => h('option', { value: v, selected: base.followUpStatus === v }, l)));
    const notes = h('textarea', { class: 'input', name: 'notes', rows: '3', maxlength: '5000', placeholder: 'Anything to remember about this customer' });
    notes.value = base.notes || '';
    const err = h('div', { class: 'form-error', role: 'alert', hidden: true });

    const save = async () => {
      const rec = {
        ...(existing || {}),
        customerName: name.value,
        policyNumber: normalizePolicyNumber(policy.value) || policy.value.trim(),
        premiumAmount: amount.value.trim() === '' ? null : parseAmount(amount.value),
        dueDate: due.value,
        mobile: mobile.value.trim() ? (normalizeMobile(mobile.value) || mobile.value.trim()) : '',
        policyStatus: status.value, premiumTerm: term.value, mode: mode.value, notes: notes.value, followUpStatus: fu.value,
        manual: existing ? existing.manual : true,
      };
      if (amount.value.trim() !== '' && rec.premiumAmount === null) { err.textContent = 'Premium amount must be a number.'; err.hidden = false; return; }
      try {
        await DB.savePolicy(rec);
        close();
        await changed(existing ? 'Record updated' : 'Customer added');
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      }
    };
    return [
      field('Customer name', name),
      field('Policy number *', policy),
      h('div', { class: 'grid2' }, field('Premium amount (₹)', amount), field('Premium due date *', due)),
      field('Mobile number', mobile, 'Used for WhatsApp and calling'),
      h('div', { class: 'grid2' }, field('Policy status', status), field('Premium term', term)),
      h('div', { class: 'grid2' }, field('Mode', mode), field('Follow-up status', fu)),
      field('Notes', notes),
      err,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', onclick: close }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: save }, icon('check', 18), existing ? 'Save changes' : 'Add customer')),
    ];
  }, { title: existing ? 'Edit record' : 'Add customer', wide: true });
}

// ---------- follow-up log ----------
export function openFollowUpSheet(policy) {
  openSheet((close) => {
    let type = 'call';
    let status = 'contacted';
    const typeSel = h('select', { class: 'input', onchange: (e) => { type = e.target.value; } }, ['call', 'whatsapp', 'visit', 'note'].map((t) => h('option', { value: t }, ACT_LABEL[t])));
    const statusSel = h('select', { class: 'input', onchange: (e) => { status = e.target.value; } }, Object.entries(FOLLOWUP_LABEL).map(([v, l]) => h('option', { value: v, selected: v === 'contacted' }, l)));
    const note = h('textarea', { class: 'input', rows: '3', maxlength: '500', placeholder: 'What did the customer say? (optional)' });
    return [
      h('p', { class: 'muted' }, `${policy.customerName || 'Customer'} · Policy ${policy.policyNumber}`),
      h('div', { class: 'grid2' }, field('How did you contact?', typeSel), field('Result', statusSel)),
      field('Note', note),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', onclick: close }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => { await DB.recordFollowUp(policy.id, { type, status, note: note.value }); close(); await changed('Follow-up saved'); } }, icon('check', 18), 'Save follow-up')),
    ];
  }, { title: 'Record follow-up' });
}

// ---------- payment confirmation (the ONLY way a policy becomes paid) ----------
export function openPaymentSheet(policy) {
  openSheet((close) => {
    const date = h('input', { class: 'input', type: 'date', value: todayISO(), max: todayISO() });
    const amt = h('input', { class: 'input', inputmode: 'decimal', value: policy.premiumAmount ?? '' });
    return [
      h('p', {}, 'Confirm only if the customer has actually paid this premium. The app never marks a policy paid on its own.'),
      h('p', { class: 'muted' }, `${policy.customerName || 'Customer'} · Policy ${policy.policyNumber} · due ${formatDate(policy.dueDate)}`),
      h('div', { class: 'grid2' }, field('Date paid', date), field('Amount paid (₹)', amt)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', onclick: close }, 'Cancel'),
        h('button', { class: 'btn ok', onclick: async () => {
          const paidAmount = amt.value.trim() === '' ? null : parseAmount(amt.value);
          await DB.confirmPayment(policy.id, { paidDate: isValidISO(date.value) ? date.value : todayISO(), paidAmount });
          close();
          await changed('Payment confirmed');
        } }, icon('check', 18), 'Yes, payment received')),
    ];
  }, { title: 'Confirm payment' });
}

// ---------- detail ----------
export function openPolicyDetail(policyId) {
  let onData = null;
  openSheet((close, body) => {
    const render = async () => {
      const p = state.policies.find((x) => x.id === policyId);
      if (!p) { close(); return; }
      const acts = await DB.activitiesFor(p.id);
      const badge = dueBadge(p);
      const row = (k, v) => v === '' || v === null || v === undefined ? null : h('div', { class: 'kv' }, h('span', k), h('strong', String(v)));
      const siblings = state.policies.filter((x) => x.policyNumber === p.policyNumber && x.id !== p.id).sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
      mount(body, 
        h('div', { class: 'detail-top' },
          h('div', {}, h('h3', p.customerName || 'Unnamed customer'), h('div', { class: 'muted' }, `Policy ${p.policyNumber}`)),
          h('span', { class: `badge ${badge.cls}` }, badge.text)),
        h('div', { class: 'detail-actions' },
          h('button', { class: 'btn wa', onclick: () => { openMessageSheet([p.id]); } }, icon('whatsapp', 18), 'Message'),
          p.mobile ? h('button', { class: 'btn soft', onclick: () => openExternal(`tel:${p.mobile}`) }, icon('phone', 18), 'Call') : null,
          h('button', { class: 'btn soft', onclick: () => openFollowUpSheet(p) }, icon('check', 18), 'Follow-up')),
        h('div', { class: 'card flat' },
          row('Premium', p.premiumAmount !== null && p.premiumAmount !== '' ? formatINR(p.premiumAmount) : 'Not available'),
          row('Due date', `${formatDate(p.dueDate)} (${formatDateDMY(p.dueDate)})`),
          row('Mobile', p.mobile || 'Not available'),
          row('Policy status', p.policyStatus),
          row('Premium term', p.premiumTerm), row('Mode', p.mode), row('Plan', p.plan),
          row('Follow-up', FOLLOWUP_LABEL[p.followUpStatus] || p.followUpStatus),
          row('Last follow-up', p.lastFollowUpDate ? formatDate(p.lastFollowUpDate) : 'Never'),
          p.paymentStatus === 'paid' ? row('Payment confirmed', `${formatDate(p.paidDate)}${p.paidAmount ? ' · ' + formatINR(p.paidAmount) : ''}`) : null,
          row('Source', p.sourceName || 'Added manually'),
          row('Imported', p.importedAt ? formatDate(p.importedAt.slice(0, 10)) : '')),
        p.notes && h('div', { class: 'card flat' }, h('div', { class: 'muted small' }, 'Notes'), h('p', { class: 'pre' }, p.notes)),
        h('div', { class: 'btn-row wrap' },
          p.paymentStatus === 'paid'
            ? h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog({ title: 'Undo payment?', message: 'This puts the policy back to unpaid.', confirmText: 'Undo payment' })) { await DB.undoPayment(p.id); await changed('Payment undone'); render(); } } }, 'Undo payment')
            : h('button', { class: 'btn ok', onclick: () => openPaymentSheet(p) }, icon('rupee', 18), 'Confirm payment'),
          h('button', { class: 'btn soft', onclick: () => openPolicyForm(p) }, icon('edit', 18), 'Edit'),
          h('button', { class: 'btn danger-soft', onclick: async () => {
            if (await confirmDialog({ title: 'Delete this record?', message: `${p.customerName || 'Record'} · ${p.policyNumber} · due ${formatDate(p.dueDate)} will be removed from this phone. This cannot be undone.`, confirmText: 'Delete', danger: true })) {
              await DB.deletePolicy(p.id); close(); await changed('Record deleted');
            }
          } }, icon('trash', 18), 'Delete')),
        siblings.length > 0 && h('div', {},
          h('h4', 'Other installments of this policy'),
          h('div', { class: 'list' }, siblings.map((s) => h('button', { class: 'row-btn', onclick: () => { close(); setTimeout(() => openPolicyDetail(s.id), 160); } },
            h('span', formatDate(s.dueDate)), h('span', { class: 'muted' }, s.premiumAmount ? formatINR(s.premiumAmount) : ''), h('span', { class: `badge ${dueBadge(s).cls}` }, dueBadge(s).text))))),
        h('h4', 'Follow-up history'),
        acts.length
          ? h('ul', { class: 'timeline' }, acts.map((a) => h('li', {}, h('strong', ACT_LABEL[a.type] || a.type), h('span', { class: 'muted small' }, ` · ${formatDate(a.date)}`), a.note ? h('div', { class: 'small' }, a.note) : null)))
          : h('p', { class: 'muted' }, 'No follow-ups recorded yet.'),
      );
    };
    render();
    onData = () => render();
    document.addEventListener('data-changed', onData);
    return [];
  }, { title: 'Policy details', wide: true, onClose: () => { if (onData) document.removeEventListener('data-changed', onData); } });
}
