// Customer reminder messages (English and Tamil) and WhatsApp link helpers.
// Messages are only ever generated for the advisor to review; nothing here sends anything.
import { diffDays, formatDate } from './dates.js';
import { toTitleCase } from './validate.js';

export const TEMPLATES = [
  { id: 'today', label: 'Due Today' },
  { id: 'tomorrow', label: 'Due Tomorrow' },
  { id: 'days3', label: 'Due in 3 Days' },
  { id: 'days7', label: 'Due in 7 Days' },
  { id: 'overdue', label: 'Overdue Premium' },
  { id: 'general', label: 'General Follow-up' },
];

/** Pick the template that matches the number of days left (negative = overdue). */
export function chooseTemplate(days) {
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 3) return 'days3';
  if (days <= 7) return 'days7';
  return 'general';
}

/** Indian digit grouping: 1234567.5 -> "12,34,567.50". Whole amounts have no decimals. */
export function formatINR(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const fixed = Math.abs(v).toFixed(2);
  let [int, dec] = fixed.split('.');
  let last3 = int.slice(-3);
  let rest = int.slice(0, -3);
  if (rest) {
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    int = `${rest},${last3}`;
  }
  return `₹${v < 0 ? '-' : ''}${int}${dec === '00' ? '' : '.' + dec}`;
}

function signature(profile, lang) {
  const name = (profile?.advisorName || '').trim();
  if (!name) return '';
  if (lang === 'ta') return `\n\nநன்றி,\n${name}\nLIC காப்பீட்டு முகவர்`;
  return `\n\nRegards,\n${name}\nLIC Insurance Advisor`;
}

function contactLine(profile, lang) {
  const mob = (profile?.mobile || '').trim();
  if (lang === 'ta') return mob ? `ஏதேனும் உதவி தேவைப்பட்டால் என்னைத் தொடர்பு கொள்ளவும் (${mob}).` : 'ஏதேனும் உதவி தேவைப்பட்டால் என்னைத் தொடர்பு கொள்ளவும்.';
  return mob ? `For any assistance, please contact me at ${mob}.` : 'For any assistance, please contact me.';
}

function en(t, c) {
  const name = c.name ? c.name : 'Customer';
  const amt = c.amount ? ` of ${c.amount}` : '';
  const ref = c.policyNumber ? ` (Policy No. ${c.policyNumber})` : '';
  const prem = `the premium${amt} for your LIC policy${ref}`;
  const hi = `Dear ${name},`;
  const keep = 'Kindly arrange the premium payment before the due date to maintain the continuity of your policy benefits.';
  switch (t) {
    case 'today':
      return `${hi}\n\nThis is a friendly reminder that ${prem} is due today (${c.date}).\n\nKindly arrange the premium payment today to maintain the continuity of your policy benefits.`;
    case 'tomorrow':
      return `${hi}\n\nThis is a friendly reminder that ${prem} is due tomorrow (${c.date}).\n\n${keep}`;
    case 'days3':
      return `${hi}\n\nThis is a friendly reminder that ${prem} is due in ${c.days} days, on ${c.date}.\n\n${keep}`;
    case 'days7':
      return `${hi}\n\nThis is a friendly reminder that ${prem} is due in ${c.days} days, on ${c.date}.\n\nKindly plan the payment in advance so that your policy benefits continue without interruption.`;
    case 'overdue':
      return `${hi}\n\nOur records show that ${prem}, which was due on ${c.date}, is still pending (${c.overdue} day${c.overdue === 1 ? '' : 's'} overdue).\n\nKindly pay the premium at the earliest to keep your policy benefits in force. If you have already paid, please ignore this message and share the payment details with me.`;
    default:
      return `${hi}\n\nI hope you are doing well. This is a follow-up regarding ${prem}, due on ${c.date}.\n\nKindly let me know when you plan to make the payment, or if you need any help with it.`;
  }
}

function ta(t, c) {
  const name = c.name ? `${c.name} அவர்களே` : 'வாடிக்கையாளரே';
  const ref = c.policyNumber ? ` (எண்: ${c.policyNumber})` : '';
  const amt = c.amount ? ` ${c.amount}` : '';
  const prem = `தங்களின் LIC பாலிசி${ref} பிரீமியம்${amt}`;
  const hi = `அன்பார்ந்த ${name},`;
  switch (t) {
    case 'today':
      return `${hi}\n\nவணக்கம். ${prem} இன்று (${c.date}) செலுத்த வேண்டிய நாளாகும்.\n\nதங்கள் பாலிசி பலன்கள் தடையின்றித் தொடர, இன்றே பிரீமியத்தைச் செலுத்துமாறு கேட்டுக்கொள்கிறேன்.`;
    case 'tomorrow':
      return `${hi}\n\nவணக்கம். ${prem} நாளை (${c.date}) செலுத்த வேண்டிய நாளாகும்.\n\nதங்கள் பாலிசி பலன்கள் தடையின்றித் தொடர, உரிய தேதிக்குள் பிரீமியத்தைச் செலுத்துமாறு கேட்டுக்கொள்கிறேன்.`;
    case 'days3':
      return `${hi}\n\nவணக்கம். ${prem} இன்னும் ${c.days} நாட்களில் (${c.date}) செலுத்த வேண்டும்.\n\nதங்கள் பாலிசி பலன்கள் தடையின்றித் தொடர, உரிய தேதிக்குள் பிரீமியத்தைச் செலுத்துமாறு கேட்டுக்கொள்கிறேன்.`;
    case 'days7':
      return `${hi}\n\nவணக்கம். ${prem} இன்னும் ${c.days} நாட்களில் (${c.date}) செலுத்த வேண்டும்.\n\nமுன்கூட்டியே திட்டமிட்டு, உரிய தேதிக்குள் பிரீமியத்தைச் செலுத்துமாறு கேட்டுக்கொள்கிறேன்.`;
    case 'overdue':
      return `${hi}\n\nவணக்கம். ${prem} ${c.date} அன்று செலுத்த வேண்டியதாக இருந்தது; அது இன்னும் நிலுவையில் உள்ளதாக எங்கள் பதிவுகள் காட்டுகின்றன (${c.overdue} நாட்கள் தாமதம்).\n\nபாலிசி பலன்கள் தொடர்ந்து நடைமுறையில் இருக்க, விரைவில் பிரீமியத்தைச் செலுத்துமாறு கேட்டுக்கொள்கிறேன். ஏற்கனவே செலுத்தியிருந்தால், இந்தச் செய்தியைப் புறக்கணித்து, கட்டண விவரத்தை எனக்குத் தெரிவிக்கவும்.`;
    default:
      return `${hi}\n\nவணக்கம். ${prem} ${c.date} அன்று செலுத்த வேண்டியது குறித்த நினைவூட்டல் இது.\n\nஎப்போது செலுத்த உத்தேசித்துள்ளீர்கள் என்பதை அல்லது ஏதேனும் உதவி தேவைப்பட்டால் எனக்குத் தெரிவிக்கவும்.`;
  }
}

/**
 * Build the message text for one policy.
 * opts: { policy, lang: 'en'|'ta', template?: id, profile?: {...}, today: 'YYYY-MM-DD' }
 */
export function buildMessage({ policy, lang = 'en', template, profile, today }) {
  const days = diffDays(today, policy.dueDate);
  const t = template && template !== 'auto' ? template : chooseTemplate(days);
  const ctx = {
    name: toTitleCase(policy.customerName),
    policyNumber: policy.policyNumber,
    amount: policy.premiumAmount || policy.premiumAmount === 0 ? (Number(policy.premiumAmount) > 0 ? formatINR(policy.premiumAmount) : '') : '',
    date: formatDate(policy.dueDate, lang),
    days: Math.max(days, 0),
    overdue: Math.max(-days, 0),
  };
  const body = lang === 'ta' ? ta(t, ctx) : en(t, ctx);
  return `${body}\n\n${contactLine(profile, lang)}${signature(profile, lang)}`;
}

/** Digits-only international number for wa.me, or '' when the mobile is unusable. */
export function whatsappNumber(mobile) {
  let d = String(mobile ?? '').replace(/\D/g, '');
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  return '';
}

export function whatsappUrl(mobile, text) {
  const n = whatsappNumber(mobile);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
