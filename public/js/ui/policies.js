// Policy list (with category chips, search, sort) and the monthly calendar.
import { h, icon, debounce, mount } from './dom.js';
import { state, ctx } from '../store.js';
import { CATEGORIES, inCategory, sortPolicies, matchesQuery, dueByDate, monthlyCollection, categoryLabel, isPaid } from '../core/due.js';
import { monthGrid, monthTitle, addMonths, parts, formatDate, makeISO } from '../core/dates.js';
import { formatINR } from '../core/messages.js';
import { policyCard, emptyState, pagedList } from './cards.js';
import { openMessageSheet } from './message.js';
import { openPolicyForm } from './detail.js';
import { go, setQuery } from '../router.js';

const CHIP_ORDER = ['today', 'tomorrow', 'next3', 'next7', 'next15', 'thisMonth', 'overdue', 'pending', 'followupDone', 'paid', 'all'];
const CHIP_SHORT = { today: 'Today', tomorrow: 'Tomorrow', next3: '3 days', next7: '7 days', next15: '15 days', thisMonth: 'This month', overdue: 'Overdue', pending: 'Pending', followupDone: 'Follow-up done', paid: 'Paid', all: 'All' };

export function viewToggle(active) {
  return h('div', { class: 'seg-row compact', role: 'group', 'aria-label': 'View' },
    h('button', { class: `seg ${active === 'list' ? 'on' : ''}`, onclick: () => go('/policies/today') }, icon('list', 16), 'List'),
    h('button', { class: `seg ${active === 'calendar' ? 'on' : ''}`, onclick: () => go('/calendar') }, icon('calendar', 16), 'Calendar'));
}

export function renderPolicies(root, { cat = 'today' }, params) {
  if (!CATEGORIES.some((c) => c.id === cat)) cat = 'today';
  const q0 = params.q || '';
  const sort0 = params.sort || (cat === 'overdue' ? 'due_asc' : 'due_asc');
  const results = h('div');
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search name, policy no. or mobile', value: q0, 'aria-label': 'Search', autocomplete: 'off' });
  const sortSel = h('select', { class: 'input sort', 'aria-label': 'Sort by', onchange: () => { setQuery({ sort: sortSel.value }); draw(); } },
    [['due_asc', 'Due date: earliest'], ['due_desc', 'Due date: latest'], ['amount_desc', 'Premium: high to low'], ['amount_asc', 'Premium: low to high'], ['name', 'Name A-Z'], ['imported_desc', 'Recently imported']]
      .map(([v, l]) => h('option', { value: v, selected: v === sort0 }, l)));

  const draw = () => {
    const q = search.value;
    const all = state.policies.filter((p) => inCategory(p, cat, ctx()) && matchesQuery(p, q));
    const list = sortPolicies(all, sortSel.value);
    const total = list.reduce((s, p) => s + (Number(p.premiumAmount) || 0), 0);
    const withMobile = list.filter((p) => p.mobile).length;
    mount(results, 
      h('div', { class: 'list-head' },
        h('div', {}, h('strong', `${list.length} ${list.length === 1 ? 'policy' : 'policies'}`), h('span', { class: 'muted' }, ` · ${formatINR(total)}`)),
        list.length > 0 && h('button', { class: 'btn primary sm', onclick: () => openMessageSheet(list.map((p) => p.id)) }, icon('whatsapp', 16), `Start follow-up`)),
      list.length === 0
        ? emptyState(state.policies.length ? `Nothing in "${categoryLabel(cat)}"` : 'No policies yet', state.policies.length ? (q ? 'No record matches your search.' : 'You are all caught up here.') : 'Import a PDF or add a customer to begin.',
            state.policies.length ? null : h('button', { class: 'btn primary', onclick: () => go('/import') }, 'Import PDF'))
        : pagedList(list, (p) => policyCard(p, list.map((x) => x.id))),
      list.length > 0 && withMobile < list.length && h('p', { class: 'muted small' }, `${list.length - withMobile} of these have no mobile number.`));
  };

  search.addEventListener('input', debounce(() => { setQuery({ q: search.value }); draw(); }, 180));

  mount(root, 
    h('div', { class: 'page-head' }, h('h1', 'Policies'), h('div', { class: 'head-actions' }, viewToggle('list'), h('button', { class: 'btn soft sm', onclick: () => openPolicyForm() }, icon('plus', 16), 'Add'))),
    h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Category' }, CHIP_ORDER.map((id) => {
      const n = state.policies.filter((p) => inCategory(p, id, ctx())).length;
      return h('button', { role: 'tab', 'aria-selected': String(id === cat), class: `chip-btn ${id === cat ? 'on' : ''} ${id === 'overdue' && n ? 'red' : ''}`, onclick: () => go(`/policies/${id}${q0 ? '?q=' + encodeURIComponent(search.value) : ''}`) }, CHIP_SHORT[id], h('span', { class: 'chip-n' }, String(n)));
    })),
    h('div', { class: 'filters' }, search, sortSel),
    results);
  draw();
  document.querySelector('.chip-btn.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// ---------- calendar ----------
let calMonth = null; // {y, m}
let calSelected = null;

export function renderCalendar(root, _args, params) {
  if (!calMonth || params.reset) { const p = parts(state.today); calMonth = { y: p.y, m: p.m }; calSelected = state.today; }
  const byDate = dueByDate(state.policies);
  const grid = monthGrid(calMonth.y, calMonth.m);
  const mc = monthlyCollection(state.policies.filter((p) => p.dueDate.startsWith(`${calMonth.y}-${String(calMonth.m).padStart(2, '0')}`)), `${calMonth.y}-${String(calMonth.m).padStart(2, '0')}-01`);
  const dayList = h('div');

  const shift = (d) => { calMonth = addMonths(calMonth.y, calMonth.m, d); calSelected = null; renderCalendar(root, _args, {}); };

  const drawDay = () => {
    if (!calSelected) { mount(dayList, h('p', { class: 'muted center' }, 'Tap a date to see its policies.')); return; }
    const list = sortPolicies(state.policies.filter((p) => p.dueDate === calSelected), 'amount_desc');
    mount(dayList, 
      h('div', { class: 'list-head' },
        h('strong', formatDate(calSelected)),
        list.length > 0 && h('button', { class: 'btn primary sm', onclick: () => openMessageSheet(list.filter((p) => !isPaid(p)).map((p) => p.id).concat([])) , disabled: list.every(isPaid) }, icon('whatsapp', 16), 'Message unpaid')),
      list.length ? pagedList(list, (p) => policyCard(p, list.map((x) => x.id))) : h('p', { class: 'muted' }, 'No premiums due on this date.'));
  };

  mount(root, 
    h('div', { class: 'page-head' }, h('h1', 'Calendar'), h('div', { class: 'head-actions' }, viewToggle('calendar'))),
    h('div', { class: 'cal-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('back')),
      h('strong', monthTitle(calMonth.y, calMonth.m)),
      h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('chevron'))),
    h('div', { class: 'cal', role: 'grid' },
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => h('div', { class: 'cal-dow', role: 'columnheader' }, d)),
      grid.flat().map((iso) => {
        if (!iso) return h('div', { class: 'cal-cell empty' });
        const e = byDate.get(iso);
        const past = iso < state.today;
        const cls = ['cal-cell', iso === state.today ? 'today' : '', iso === calSelected ? 'sel' : '', e ? (e.unpaid === 0 ? 'has paid' : past ? 'has late' : 'has due') : ''].join(' ');
        return h('button', { class: cls, role: 'gridcell', 'aria-label': `${formatDate(iso)}${e ? `, ${e.count} policies` : ''}`, onclick: () => { calSelected = iso; renderCalendar(root, _args, {}); } },
          h('span', { class: 'cal-day' }, String(parts(iso).d)),
          e && h('span', { class: 'cal-n' }, String(e.count)));
      })),
    h('div', { class: 'cal-legend small muted' }, h('span', { class: 'dot due' }), ' Upcoming ', h('span', { class: 'dot late' }), ' Unpaid & past ', h('span', { class: 'dot paid' }), ' All paid'),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', `${monthTitle(calMonth.y, calMonth.m)} summary`)),
      h('div', { class: 'collect' },
        h('div', {}, h('div', { class: 'muted small' }, 'Due'), h('strong', formatINR(mc.dueAmount)), h('div', { class: 'small muted' }, `${mc.dueCount} policies`)),
        h('div', {}, h('div', { class: 'muted small' }, 'Paid'), h('strong', { class: 'txt-ok' }, formatINR(mc.paidAmount)), h('div', { class: 'small muted' }, `${mc.paidCount} (${mc.percent}%)`)),
        h('div', {}, h('div', { class: 'muted small' }, 'Pending'), h('strong', { class: 'txt-bad' }, formatINR(mc.pendingAmount)), h('div', { class: 'small muted' }, `${mc.pendingCount}`)))),
    dayList);
  drawDay();
  void makeISO;
}
