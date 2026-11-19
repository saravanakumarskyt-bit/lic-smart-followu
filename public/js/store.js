// Central in-memory state mirrored from IndexedDB. Views read from here and call reload() after any change.
import * as DB from './core/db.js';
import { todayISO } from './core/dates.js';
import { groupCustomers } from './core/customers.js';
import { summarize } from './core/due.js';

export const state = {
  ready: false,
  policies: [],
  prefs: { ...DB.DEFAULT_PREFS },
  profile: { ...DB.EMPTY_PROFILE },
  customers: [],
  today: todayISO(),
  summary: null,
  activities: [],
};

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });

export const ctx = () => ({ today: state.today, overdueMaxDays: state.prefs.overdueMaxDays || 0 });

export async function reload() {
  const [policies, prefs, profile, activities] = await Promise.all([DB.listPolicies(), DB.getPrefs(), DB.getProfile(), DB.listActivities()]);
  state.policies = policies;
  state.prefs = prefs;
  state.profile = profile;
  state.activities = activities;
  state.today = todayISO();
  state.customers = groupCustomers(policies);
  state.summary = summarize(policies, ctx());
  state.ready = true;
  emit();
}

/** Re-check the device date (called when the app returns to the foreground so midnight roll-over is picked up). */
export function refreshToday() {
  const t = todayISO();
  if (t !== state.today) { state.today = t; state.summary = summarize(state.policies, ctx()); emit(); return true; }
  return false;
}

export function applyTheme(theme = state.prefs.theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1220' : '#0b5bd3');
}
