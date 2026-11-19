// Notification adapter.
//
//  Android app (Capacitor)  -> LocalNotifications plugin: the next 30 days of notifications are scheduled with the
//                              Android alarm system, so they fire with the app closed and with no internet.
//  Web / installed PWA      -> the browser cannot wake itself up. We show the summary in the app, and send a
//                              Notification when the app is opened or in the foreground after the chosen time.
//                              (Chrome's scheduled-notification API was removed; Periodic Background Sync is not
//                              available to every install and is not dependable.) See README "Notification limits".
import { plugin, isNative } from './platform.js';
import { planNotifications, morningText } from './core/notify-plan.js';
import { todayISO } from './core/dates.js';
import { summarize } from './core/due.js';
import { getSetting, setSetting } from './core/db.js';

const CHANNEL_ID = 'daily-summary';

export const notificationMode = () => (isNative() && plugin('LocalNotifications') ? 'native' : 'web');

/** 'granted' | 'denied' | 'prompt' | 'unsupported' */
export async function permissionState() {
  const LN = plugin('LocalNotifications');
  if (LN) {
    try {
      const r = await LN.checkPermissions();
      return r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'prompt';
    } catch { return 'unsupported'; }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}

export async function requestPermission() {
  const LN = plugin('LocalNotifications');
  if (LN) {
    try {
      const r = await LN.requestPermissions();
      return r.display === 'granted' ? 'granted' : 'denied';
    } catch { return 'unsupported'; }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  const p = await Notification.requestPermission();
  return p === 'default' ? 'prompt' : p;
}

/** Android 12+: exact alarms need a separate user switch. Without it the daily time may drift by minutes. */
export async function exactAlarmState() {
  const LN = plugin('LocalNotifications');
  if (!LN?.checkExactNotificationSetting) return 'unknown';
  try { return (await LN.checkExactNotificationSetting()).exact_alarm; } catch { return 'unknown'; }
}

export async function openExactAlarmSettings() {
  const LN = plugin('LocalNotifications');
  try { await LN?.changeExactNotificationSetting?.(); } catch { /* user can use system settings */ }
}

async function ensureChannel(LN) {
  try {
    await LN.createChannel?.({
      id: CHANNEL_ID, name: 'Daily follow-up summary', description: 'Morning and evening LIC follow-up reports and premium reminders',
      importance: 4, visibility: 0, vibration: true,
    });
  } catch { /* channels are Android 8+; older versions ignore this */ }
}

/**
 * Rebuild every scheduled notification from the current data. Safe to call often.
 * Returns { mode, scheduled, next, permission, reason? }.
 */
export async function rescheduleAll({ policies, prefs, profile }) {
  const now = new Date();
  const plan = planNotifications({ policies, prefs, profile, now, today: todayISO(now) });
  const mode = notificationMode();
  const LN = plugin('LocalNotifications');

  if (mode !== 'native') {
    return { mode, scheduled: 0, planned: plan.length, next: plan[0]?.at || null, permission: await permissionState(), reason: 'Web builds cannot schedule notifications while closed. Use the Android app for that.' };
  }

  const permission = await permissionState();
  try {
    const pending = await LN.getPending();
    if (pending.notifications?.length) await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  } catch { /* nothing pending */ }
  if (permission !== 'granted' || !plan.length) return { mode, scheduled: 0, planned: plan.length, next: plan[0]?.at || null, permission, reason: permission !== 'granted' ? 'Notification permission is not granted.' : '' };

  await ensureChannel(LN);
  const notifications = plan.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    largeBody: n.largeBody,
    summaryText: 'LIC Smart Follow-up',
    schedule: { at: n.at, allowWhileIdle: true },
    channelId: CHANNEL_ID,
    smallIcon: 'ic_stat_notify',
    extra: { kind: n.kind, day: n.day, policyId: n.policyId || null },
  }));
  // Android handles a few hundred pending alarms comfortably; chunk the call to keep each bridge message small.
  for (let i = 0; i < notifications.length; i += 50) await LN.schedule({ notifications: notifications.slice(i, i + 50) });
  await setSetting('notifState', { scheduledAt: new Date().toISOString(), count: notifications.length, lastDay: plan[plan.length - 1]?.day || null });
  return { mode, scheduled: notifications.length, planned: plan.length, next: plan[0]?.at || null, permission };
}

export async function lastScheduleInfo() {
  return getSetting('notifState', null);
}

/** Immediate test notification so the advisor can confirm that alerts reach the lock screen. */
export async function sendTestNotification(text = { title: 'LIC Smart Follow-up', body: 'Test notification: alerts are working.' }) {
  const LN = plugin('LocalNotifications');
  if (LN) {
    const perm = await permissionState();
    if (perm !== 'granted') return { ok: false, reason: 'Notification permission is not granted.' };
    await ensureChannel(LN);
    await LN.schedule({ notifications: [{ id: 2147000000, title: text.title, body: text.body, schedule: { at: new Date(Date.now() + 2000), allowWhileIdle: true }, channelId: CHANNEL_ID, smallIcon: 'ic_stat_notify' }] });
    return { ok: true };
  }
  if (typeof Notification === 'undefined') return { ok: false, reason: 'This browser does not support notifications.' };
  if (Notification.permission !== 'granted') return { ok: false, reason: 'Notification permission is not granted.' };
  await showWebNotification(text.title, text.body);
  return { ok: true };
}

async function showWebNotification(title, body, tag = 'lic-followup') {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.showNotification) { await reg.showNotification(title, { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png' }); return; }
  } catch { /* use the constructor */ }
  new Notification(title, { body, tag, icon: './icons/icon-192.png' });
}

/**
 * Web/PWA only: when the app is opened (or comes to the foreground) after the chosen morning time and today's summary has
 * not been shown yet, show it as a system notification. This is a catch-up, not a background alarm.
 */
export async function webCatchUp({ policies, prefs, profile }) {
  if (notificationMode() === 'native' || !prefs.notifEnabled) return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const now = new Date();
  const today = todayISO(now);
  const [hh, mm] = String(prefs.notifTime || '08:00').split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return false;
  if ((await getSetting('lastWebSummaryDay')) === today) return false;
  const s = summarize(policies, { today, overdueMaxDays: prefs.overdueMaxDays || 0 });
  if (!policies.length) return false;
  const t = morningText(s, profile?.advisorName);
  await showWebNotification(t.title, t.body);
  await setSetting('lastWebSummaryDay', today);
  return true;
}

/** Register the handler that opens the right screen when the advisor taps a notification (native only). */
export function onNotificationTap(handler) {
  const LN = plugin('LocalNotifications');
  if (!LN?.addListener) return;
  LN.addListener('localNotificationActionPerformed', (ev) => handler(ev?.notification?.extra || {}));
}
