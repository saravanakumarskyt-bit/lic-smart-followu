import { h, icon, mount } from './dom.js';
import { state } from '../store.js';
import { formatDate } from '../core/dates.js';
import { formatINR } from '../core/messages.js';
import { openPolicyDetail, dueBadge, FOLLOWUP_LABEL } from './detail.js';
import { openMessageSheet } from './message.js';
import { openExternal } from '../platform.js';

/** A tappable policy row. `queue` is the list of ids used when the WhatsApp button opens the composer. */
export function policyCard(p, queue = null) {
  const badge = dueBadge(p);
  const ids = queue && queue.length ? queue : [p.id];
  const startAt = Math.max(0, ids.indexOf(p.id));
  return h('div', { class: 'pcard', role: 'listitem' },
    h('button', { class: 'pcard-main', onclick: () => openPolicyDetail(p.id), 'aria-label': `Open ${p.customerName || 'record'}, policy ${p.policyNumber}` },
      h('div', { class: 'pcard-top' },
        h('strong', { class: 'pcard-name' }, p.customerName || 'Unnamed customer'),
        h('span', { class: `badge ${badge.cls}` }, badge.text)),
      h('div', { class: 'pcard-sub' },
        h('span', `Policy ${p.policyNumber}`),
        h('span', p.premiumAmount !== null && p.premiumAmount !== '' && p.premiumAmount !== undefined ? formatINR(p.premiumAmount) : 'Amount n/a'),
        h('span', formatDate(p.dueDate))),
      h('div', { class: 'pcard-meta' },
        p.paymentStatus !== 'paid' && h('span', { class: `chip fu-${p.followUpStatus}` }, FOLLOWUP_LABEL[p.followUpStatus] || p.followUpStatus),
        !p.mobile && h('span', { class: 'chip warn' }, 'No mobile'),
        p.policyStatus && h('span', { class: 'chip' }, p.policyStatus))),
    h('div', { class: 'pcard-actions' },
      h('button', { class: 'icon-btn wa', 'aria-label': 'Prepare WhatsApp message', onclick: () => openMessageSheet(ids, startAt) }, icon('whatsapp', 22)),
      p.mobile ? h('button', { class: 'icon-btn call', 'aria-label': 'Call customer', onclick: () => openExternal(`tel:${p.mobile}`) }, icon('phone', 22)) : null));
}

export function emptyState(title, text, ...actions) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-ic' }, icon('file', 36)), h('h3', title), h('p', { class: 'muted' }, text), actions.length ? h('div', { class: 'btn-row center' }, actions) : null);
}

/** Renders rows in batches so lists with thousands of records stay fast on low-end phones. */
export function pagedList(items, renderItem, pageSize = 40) {
  const wrap = h('div', { class: 'list', role: 'list' });
  const more = h('div', { class: 'more-wrap' });
  let shown = 0;
  const showMore = () => {
    items.slice(shown, shown + pageSize).forEach((it) => wrap.appendChild(renderItem(it)));
    shown = Math.min(items.length, shown + pageSize);
    mount(more, shown < items.length ? h('button', { class: 'btn ghost', onclick: showMore }, `Show more (${items.length - shown} left)`) : null);
  };
  showMore();
  return h('div', {}, wrap, more);
}
