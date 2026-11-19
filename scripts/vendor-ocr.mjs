// Copies Tesseract.js (worker, WASM core, English data) from node_modules into public/vendor/tesseract/
// so OCR for scanned PDFs works fully offline. Run once after `npm install`: npm run vendor:ocr
import { mkdirSync, copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'public', 'vendor', 'tesseract');
mkdirSync(out, { recursive: true });

function need(p) { if (!existsSync(p)) { console.error(`Missing ${p}. Run "npm install" first.`); process.exit(1); } return p; }

copyFileSync(need(path.join(nm, 'tesseract.js', 'dist', 'tesseract.min.js')), path.join(out, 'tesseract.min.js'));
copyFileSync(need(path.join(nm, 'tesseract.js', 'dist', 'worker.min.js')), path.join(out, 'worker.min.js'));

const core = need(path.join(nm, 'tesseract.js-core'));
for (const f of readdirSync(core)) if (/^tesseract-core.*\.(js|wasm)$/.test(f)) copyFileSync(path.join(core, f), path.join(out, f));

const data = need(path.join(nm, '@tesseract.js-data', 'eng', '4.0.0_best_int'));
const gz = path.join(data, 'eng.traineddata.gz');
writeFileSync(path.join(out, 'eng.traineddata'), existsSync(gz) ? gunzipSync(readFileSync(gz)) : readFileSync(need(path.join(data, 'eng.traineddata'))));

console.log('OCR files copied to public/vendor/tesseract/:');
console.log(readdirSync(out).join('\n'));
console.log('\nNext: npm run sw:update (so the service worker caches them), then rebuild the app/APK.');
