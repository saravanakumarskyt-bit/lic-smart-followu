import { icon, toast, $$, mount } from './ui/dom.js';
import { state, reload, refreshToday, applyTheme, subscribe } from './store.js';
import { route, setOnChange, startRouter, resolve, go } from './router.js';
import { renderHome } from './ui/home.js';
import { renderPolicies, renderCalendar } from './ui/policies.js';
import { renderCustomers, renderCustomer } from './ui/customers.js';
import { renderImport, renderHistory, dismissReport } from './ui/import.js';
import { applyBranding, renderMore, renderProfile, renderNotifications, renderPreferences, renderBackup, renderHelp } from './ui/settings.js';
import { rescheduleAll, webCatchUp, onNotificationTap } from './notify.js';
import { plugin, isNative } from './platform.js';
import { requestPersistentStorage } from './core/db.js';

const main = document.getElementById('main');

function mountNavIcons() {
  $$('[data-ic]').forEach((el) => { el.replaceWith(icon(el.dataset.ic, 24)); });
}

const NAV_OF = { home: 'home', policies: 'policies', calendar: 'policies', customers: 'customers', customer: 'customers', import: 'import', history: 'more', more: 'more', profile: 'more', notifications: 'more', preferences: 'more', backup: 'more', help: 'more' };

setOnChange((path) => {
  if (path !== '/import') dismissReport();
  const key = NAV_OF[path.split('/')[1]] || 'home';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  $$('#nav a').forEach((a) => { if (a.dataset.nav === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
});

// Every render gets its own container. A slow async screen that finishes after the user has already moved on can then
// only write into a container that is no longer on the page, so it can never paint over the current screen.
let renderSeq = 0;
let keepScroll = false;
const wrap = (fn) => (args, params) => {
  const view = document.createElement('div');
  view.className = 'view';
  mount(main, view);
  const seq = ++renderSeq;
  const y = window.scrollY;
  const restore = keepScroll;
  const fail = (e) => { if (seq === renderSeq) showError(e); };
  const finish = () => { if (restore && seq === renderSeq) window.scrollTo(0, y); };
  try {
    const r = fn(view, args, params);
    if (r?.then) r.then(finish, fail); else finish();
  } catch (e) { fail(e); }
  if (!restore) window.scrollTo(0, 0);
};
function showError(e) {
  console.error(e);
  mount(main, Object.assign(document.createElement('p'), { className: 'banner bad', textContent: `Something went wrong: ${e.message || e}. Reload the app; your data is safe.` }));
}

route('/home', wrap((m) => renderHome(m)));
route('/policies/:cat', wrap((m, a, p) => renderPolicies(m, a, p)));
route('/calendar', wrap((m, a, p) => renderCalendar(m, a, p)));
route('/customers', wrap((m, a, p) => renderCustomers(m, a, p)));
route('/customer/:key', wrap((m, a) => renderCustomer(m, a)));
route('/import', wrap((m) => renderImport(m)));
route('/history', wrap((m) => renderHistory(m)));
route('/more', wrap((m) => renderMore(m)));
route('/profile', wrap((m) => renderProfile(m)));
route('/notifications', wrap((m) => renderNotifications(m)));
route('/preferences', wrap((m) => renderPreferences(m)));
route('/backup', wrap((m) => renderBackup(m)));
route('/help', wrap((m) => renderHelp(m)));

// Re-render the current screen whenever data changes, then rebuild the notification schedule.
let schedTimer = null;
document.addEventListener('data-changed', () => {
  keepScroll = true;
  try { resolve(); } finally { keepScroll = false; }
  clearTimeout(schedTimer);
  schedTimer = setTimeout(() => rescheduleAll({ policies: state.policies, prefs: state.prefs, profile: state.profile }).catch(console.error), 400);
});

// Tapping the tab you are already on re-renders it (and Import always returns to the upload screen after a finished report).
$$('#nav a').forEach((a) => a.addEventListener('click', () => {
  if (a.dataset.nav === 'import') dismissReport();
  if (location.hash === a.getAttribute('href')) resolve();
}));

async function onForeground() {
  const rolled = refreshToday();
  if (rolled) resolve();
  webCatchUp(state).catch(() => {});
  if (isNative()) rescheduleAll(state).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onForeground(); });
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || isNative()) return; // the APK already bundles every file
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch (e) { console.warn('Service worker not registered', e); }
}

async function boot() {
  mountNavIcons();
  try { await reload(); } catch (e) { showError(new Error(`The local database could not be opened (${e.message}). If you are in a private window, open the app in a normal window.`)); return; }
  applyTheme();
  applyBranding();
  startRouter();
  registerServiceWorker();
  requestPersistentStorage().catch(() => {});
  onNotificationTap((extra) => { go(extra.kind === 'individual' ? '/policies/today' : '/home'); });
  const back = plugin('App');
  back?.addListener?.('backButton', ({ canGoBack }) => { if (canGoBack) history.back(); else back.exitApp(); });
  rescheduleAll(state).catch((e) => console.warn('schedule', e));
  webCatchUp(state).catch(() => {});
  subscribe(() => {});
  window.__licReady = true;
}

window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast('Something did not work. Please try again.', { kind: 'bad' }); });
boot();
