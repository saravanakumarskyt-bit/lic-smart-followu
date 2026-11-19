import { h, icon, debounce, mount } from './dom.js';
import { state } from '../store.js';
import { sortPolicies, isPaid } from '../core/due.js';
import { formatDate } from '../core/dates.js';
import { formatINR } from '../core/messages.js';
import { policyCard, emptyState, pagedList } from './cards.js';
import { openPolicyForm } from './detail.js';
import { openMessageSheet } from './message.js';
import { openExternal } from '../platform.js';
import { go, setQuery } from '../router.js';
import { findCustomer } from '../core/customers.js';
import { normalizeNameKey } from '../core/validate.js';

export function renderCustomers(root, _args, params) {
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search name, policy no. or mobile', value: params.q || '', 'aria-label': 'Search customers', autocomplete: 'off' });
  const filter = h('select', { class: 'input sort', 'aria-label': 'Show', onchange: () => draw() },
    [['all', 'All customers'], ['unpaid', 'With unpaid premium'], ['nomobile', 'Missing mobile number']].map(([v, l]) => h('option', { value: v }, l)));
  const results = h('div');

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    let list = state.customers.filter((c) => {
      if (!q) return true;
      return normalizeNameKey(c.name).includes(q) || c.name.toLowerCase().includes(q)
        || c.policyNumbers.some((n) => n.includes(q.replace(/\s/g, '')))
        || (digits.length >= 3 && c.mobile.includes(digits));
    });
    if (filter.value === 'unpaid') list = list.filter((c) => c.unpaidCount > 0);
    if (filter.value === 'nomobile') list = list.filter((c) => !c.mobile);
    mount(results, 
      h('div', { class: 'list-head' }, h('strong', `${list.length} customer${list.length === 1 ? '' : 's'}`)),
      list.length === 0
        ? emptyState(state.customers.length ? 'No customer found' : 'No customers yet', state.customers.length ? 'Try a different name, policy number or mobile number.' : 'Import a PDF or add a customer.')
        : pagedList(list, (c) => h('button', { class: 'crow', role: 'listitem', onclick: () => go(`/customer/${encodeURIComponent(c.key)}`) },
          h('div', { class: 'avatar', 'aria-hidden': 'true' }, (c.name[0] || '?').toUpperCase()),
          h('div', { class: 'crow-main' },
            h('strong', c.name),
            h('div', { class: 'muted small' }, `${c.policies.length} polic${c.policies.length === 1 ? 'y' : 'ies'}${c.mobile ? ' · ' + c.mobile : ' · no mobile'}`)),
          h('div', { class: 'crow-side' },
            c.nextDue ? h('div', { class: 'small' }, formatDate(c.nextDue)) : h('div', { class: 'small txt-ok' }, 'All paid'),
            c.unpaidCount ? h('div', { class: 'small muted' }, formatINR(c.totalPremiumUnpaid)) : null),
          icon('chevron', 18))));
  };
  search.addEventListener('input', debounce(() => { setQuery({ q: search.value }); draw(); }, 180));

  mount(root, 
    h('div', { class: 'page-head' }, h('h1', 'Customers'), h('button', { class: 'btn soft sm', onclick: () => openPolicyForm() }, icon('plus', 16), 'Add')),
    h('div', { class: 'filters' }, search, filter),
    results);
  draw();
}

export function renderCustomer(root, { key }) {
  const c = findCustomer(state.customers, key);
  if (!c) { mount(root, emptyState('Customer not found', 'This customer may have been deleted or renamed.', h('button', { class: 'btn primary', onclick: () => go('/customers') }, 'Back to customers'))); return; }
  const unpaid = sortPolicies(c.policies.filter((p) => !isPaid(p)), 'due_asc');
  const history = sortPolicies(c.policies, 'due_desc');
  mount(root, 
    h('div', { class: 'page-head' }, h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => history_back() }, icon('back')), h('h1', 'Customer')),
    h('section', { class: 'card cust-head' },
      h('div', { class: 'avatar lg', 'aria-hidden': 'true' }, (c.name[0] || '?').toUpperCase()),
      h('div', {}, h('h2', c.name), h('div', { class: 'muted' }, c.mobile || 'No mobile number saved'))),
    h('div', { class: 'btn-row wrap' },
      unpaid.length ? h('button', { class: 'btn wa', onclick: () => openMessageSheet(unpaid.map((p) => p.id)) }, icon('whatsapp', 18), 'Message') : null,
      c.mobile ? h('button', { class: 'btn soft', onclick: () => openExternal(`tel:${c.mobile}`) }, icon('phone', 18), 'Call') : null,
      h('button', { class: 'btn soft', onclick: () => openPolicyForm(null, { prefill: { customerName: c.name, mobile: c.mobile } }) }, icon('plus', 18), 'Add policy')),
    h('div', { class: 'stat-grid two' },
      h('div', { class: 'stat plain static' }, h('div', { class: 'stat-val' }, String(c.policyNumbers.length)), h('div', { class: 'stat-lbl' }, 'Policies')),
      h('div', { class: 'stat bad static' }, h('div', { class: 'stat-val' }, formatINR(c.totalPremiumUnpaid) || '₹0'), h('div', { class: 'stat-lbl' }, 'Unpaid premium'))),
    h('h2', { class: 'section-title' }, 'Policy history'),
    pagedList(history, (p) => policyCard(p, unpaid.map((x) => x.id))));
}

function history_back() {
  if (history.length > 1) history.back(); else go('/customers');
}
