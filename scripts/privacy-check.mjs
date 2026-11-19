// Guards against committing real customer data. Scans the repo for real-looking mobile numbers and stray PDFs/CSVs/backups.
// All test data in this project is synthetic: mobiles 9000000xxx / 9000 0xxxxx, policy numbers 99xxxxxxx.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'android', 'ios', 'vendor', 'docs']);
const TEXT = /\.(js|mjs|json|html|css|md|txt|csv|tsv|yml|yaml|py|webmanifest)$/i;
const problems = [];

(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (statSync(full).isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full); continue; }
    if (/\.pdf$/i.test(name) && !rel.startsWith('tests/fixtures/')) problems.push(`${rel}: PDF outside tests/fixtures`);
    if (/backup.*\.json$/i.test(name)) problems.push(`${rel}: looks like a data backup`);
    if (/\.csv$/i.test(name) && !rel.startsWith('tests/')) problems.push(`${rel}: CSV outside tests/`);
    if (!TEXT.test(name)) continue;
    const text = readFileSync(full, 'utf8');
    for (const m of text.matchAll(/(?<![\d.])([6-9]\d{9})(?![\d])/g)) {
      if (/^9000\d{6}$/.test(m[1]) || /^9876543210$/.test(m[1])) continue; // synthetic range
      problems.push(`${rel}: real-looking mobile number ${m[1].slice(0, 3)}XXXXXXX`);
    }
  }
})(root);

if (problems.length) { console.error('Privacy check FAILED:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log('Privacy check passed: no real-looking customer data found.');
