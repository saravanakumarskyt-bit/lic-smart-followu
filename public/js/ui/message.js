// Message composer. Messages are generated for the advisor to REVIEW and send manually; the app never sends anything.
import { h, icon, openSheet, toast, field, mount } from './dom.js';
import { state } from '../store.js';
import { buildMessage, TEMPLATES, chooseTemplate, whatsappNumber, whatsappUrl } from '../core/messages.js';
import { diffDays } from '../core/dates.js';
import { copyText, shareText, openExternal } from '../platform.js';
import * as DB from '../core/db.js';
import { reload } from '../store.js';

/**
 * Open the composer for one policy or a queue of policies (e.g. "everyone due today").
 * @param {string[]} ids policy ids
 */
export function openMessageSheet(ids, startIndex = 0, { onChange } = {}) {
  let index = startIndex;
  let lang = state.prefs.language || 'en';
  let template = 'auto';
  let textEdited = false;

  const policyAt = (i) => state.policies.find((p) => p.id === ids[i]);

  openSheet((close, body) => {
    const render = () => {
      const p = policyAt(index);
      if (!p) { mount(body, h('p', 'This record no longer exists.')); return; }
      const days = diffDays(state.today, p.dueDate);
      const autoId = chooseTemplate(days);
      const generate = () => buildMessage({ policy: p, lang, template, profile: state.profile, today: state.today });
      const ta = h('textarea', { class: 'input msg-text', rows: '11', 'aria-label': 'Message text', spellcheck: 'false', lang: lang === 'ta' ? 'ta' : 'en' });
      ta.value = generate();
      ta.addEventListener('input', () => { textEdited = true; });

      const regen = () => { ta.value = generate(); ta.lang = lang === 'ta' ? 'ta' : 'en'; textEdited = false; };

      const langBtn = (code, label) => h('button', { class: `seg ${lang === code ? 'on' : ''}`, type: 'button', onclick: () => { lang = code; render(); } }, label);
      const templateSel = h('select', { class: 'input', 'aria-label': 'Message type', onchange: (e) => { template = e.target.value; regen(); } },
        h('option', { value: 'auto', selected: template === 'auto' }, `Automatic (${TEMPLATES.find((t) => t.id === autoId).label})`),
        TEMPLATES.map((t) => h('option', { value: t.id, selected: template === t.id }, t.label)));

      const hasMobile = !!whatsappNumber(p.mobile);
      const flash = (msg) => toast(msg);

      const markRow = h('div', { class: 'btn-row wrap' },
        h('button', { class: 'btn soft', onclick: async () => { await DB.recordFollowUp(p.id, { type: 'whatsapp', status: 'contacted', note: 'Message prepared in app' }); await reload(); onChange?.(); flash('Marked as contacted'); render(); } }, icon('check', 18), 'Mark contacted'),
        h('button', { class: 'btn soft', onclick: async () => { await DB.recordFollowUp(p.id, { type: 'whatsapp', status: 'promised', note: 'Customer promised to pay' }); await reload(); onChange?.(); flash('Saved: customer promised to pay'); render(); } }, icon('clock', 18), 'Promised to pay'));

      mount(body, 
        ids.length > 1 && h('div', { class: 'queue' },
          h('button', { class: 'btn ghost sm', disabled: index === 0, onclick: () => { index--; textEdited = false; render(); } }, icon('back', 16), 'Previous'),
          h('strong', `${index + 1} of ${ids.length}`),
          h('button', { class: 'btn ghost sm', disabled: index >= ids.length - 1, onclick: () => { index++; textEdited = false; render(); } }, 'Next', icon('chevron', 16))),
        h('div', { class: 'msg-who' },
          h('strong', p.customerName || 'Customer'),
          h('span', { class: 'muted' }, ` · Policy ${p.policyNumber}`),
          h('div', { class: 'muted small' }, p.mobile ? `Mobile ${p.mobile}` : 'No mobile number saved')),
        h('div', { class: 'seg-row', role: 'group', 'aria-label': 'Language' }, langBtn('en', 'English'), langBtn('ta', 'தமிழ்')),
        field('Message type', templateSel),
        field('Message (you can edit it before sending)', ta),
        !state.profile.advisorName && h('p', { class: 'note' }, 'Tip: add your name in More → Profile to sign messages automatically.'),
        h('div', { class: 'btn-row wrap' },
          h('button', { class: 'btn primary', onclick: async () => { (await copyText(ta.value)) ? flash('Message copied') : flash('Could not copy. Press and hold the text to copy.', { kind: 'warn' }); } }, icon('copy', 18), 'Copy'),
          h('button', { class: 'btn wa', onclick: async () => {
            await openExternal(hasMobile ? whatsappUrl(p.mobile, ta.value) : `https://wa.me/?text=${encodeURIComponent(ta.value)}`);
            flash(hasMobile ? 'WhatsApp opened. Review and press Send there.' : 'No mobile saved: pick the contact in WhatsApp.');
          } }, icon('whatsapp', 18), 'WhatsApp'),
          h('button', { class: 'btn soft', onclick: async () => { const ok = await shareText(ta.value, `LIC premium reminder - ${p.customerName || ''}`); if (!ok) flash('Sharing is not available here. Use Copy instead.', { kind: 'warn' }); } }, icon('share', 18), 'Share')),
        h('p', { class: 'muted small' }, 'Nothing is sent automatically. WhatsApp opens with the text ready; you press Send.'),
        h('hr'),
        h('div', { class: 'small muted' }, 'After you have contacted the customer:'),
        markRow,
      );
    };
    render();
    return [];
  }, { title: 'Customer message', wide: true });
}
