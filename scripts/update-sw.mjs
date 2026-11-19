// Rewrites VERSION and PRECACHE in public/sw.js from the real files in public/.
// Run before every deploy / APK sync (npm run sw:update). The version is a hash of all file contents,
// so users get a fresh cache exactly when something changed.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const skip = new Set(['sw.js', '.DS_Store']);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (!skip.has(name) && !name.endsWith('.map')) files.push(path.relative(root, full).split(path.sep).join('/'));
  }
})(root);

const hash = createHash('sha256');
for (const f of files) { hash.update(f); hash.update(readFileSync(path.join(root, f))); }
const version = hash.digest('hex').slice(0, 12);
const list = ['./', ...files.map((f) => `./${f}`)];

const swPath = path.join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
sw = sw.replace(/const VERSION = '.*?';/, `const VERSION = '${version}';`).replace(/const PRECACHE = \[[\s\S]*?\];/, `const PRECACHE = ${JSON.stringify(list, null, 1).replace(/\n\s*/g, ' ').replace(/\[ /, '[').replace(/ \]/, ']')};`);
writeFileSync(swPath, sw);
console.log(`sw.js updated: version ${version}, ${list.length} precached files`);
