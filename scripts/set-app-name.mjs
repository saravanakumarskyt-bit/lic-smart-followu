// Sets the name shown under the app icon on the phone (and the installed-PWA name).
// Usage: APP_NAME="My Insurance Desk" node scripts/set-app-name.mjs      (run before `npm run android:add`)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = String(process.env.APP_NAME ?? process.argv[2] ?? '').replace(/\s+/g, ' ').trim();
if (!name) { console.log('No APP_NAME given: keeping the current name.'); process.exit(0); }
if (name.length > 30 || /[<>&"\\]/.test(name)) { console.error('App name must be 30 characters or fewer and not contain < > & " \\'); process.exit(1); }

const edit = (rel, fn) => { const p = path.join(root, rel); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); };
edit('capacitor.config.json', (s) => { const j = JSON.parse(s); j.appName = name; return JSON.stringify(j, null, 2) + '\n'; });
edit('public/manifest.webmanifest', (s) => { const j = JSON.parse(s); j.name = name; j.short_name = name.length > 12 ? name.slice(0, 12).trim() : name; return JSON.stringify(j, null, 2) + '\n'; });
edit('public/index.html', (s) => s.replace(/<title>.*?<\/title>/, `<title>${name}</title>`));
console.log(`App name set to "${name}"`);
