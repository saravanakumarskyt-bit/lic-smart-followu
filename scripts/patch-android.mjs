// Applies the Android-specific settings this app needs to the generated android/ project. Safe to run repeatedly.
//   npm run android:add   (first time)   |   npm run android:sync (after every web change)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!existsSync(manifestPath)) { console.error('android/ not found. Run "npm run android:add" first.'); process.exit(1); }

let m = readFileSync(manifestPath, 'utf8');
const perms = [
  ['android.permission.POST_NOTIFICATIONS', 'Android 13+: show the daily summary notification'],
  ['android.permission.SCHEDULE_EXACT_ALARM', 'Fire the summary at the exact chosen minute (user can switch it off in system settings)'],
  ['android.permission.RECEIVE_BOOT_COMPLETED', 'Restore scheduled reminders after the phone restarts'],
  ['android.permission.VIBRATE', 'Notification vibration'],
  ['android.permission.WAKE_LOCK', 'Deliver the alarm while the phone is idle'],
];
let added = [];
for (const [p, why] of perms) {
  if (!m.includes(`"${p}"`)) { m = m.replace('</manifest>', `    <!-- ${why} -->\n    <uses-permission android:name="${p}" />\n</manifest>`); added.push(p); }
}
// No internet permission is requested on purpose: the app never talks to a server. (Capacitor's template adds INTERNET
// for its dev server; remove it so the APK provably cannot upload customer data.)
// If a first build shows a blank screen on some device, rebuild with KEEP_INTERNET=1 (the app still makes no network calls).
const before = m;
if (!process.env.KEEP_INTERNET) m = m.replace(/\s*<uses-permission android:name="android.permission.INTERNET"\s*\/>/g, '');
if (m !== before) added.push('(removed INTERNET)');
// Privacy: keep customer data out of Google/ADB auto-backup. The app has its own explicit, optionally encrypted backup.
if (!/android:allowBackup="false"/.test(m)) m = m.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
if (!/android:usesCleartextTraffic/.test(m)) m = m.replace('<application', '<application\n        android:usesCleartextTraffic="false"');
writeFileSync(manifestPath, m);

// Small status-bar icon for notifications (white bell on transparent, required by Android).
const drawable = path.join(root, 'android', 'app', 'src', 'main', 'res', 'drawable');
mkdirSync(drawable, { recursive: true });
writeFileSync(path.join(drawable, 'ic_stat_notify.xml'), `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.9,2 2,2zM18,16v-5c0,-3.07 -1.63,-5.64 -4.5,-6.32V4c0,-0.83 -0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.64,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z"/>
</vector>
`);
console.log(`Android project patched. ${added.length ? 'Changes: ' + added.join(', ') : 'Already up to date.'}`);
