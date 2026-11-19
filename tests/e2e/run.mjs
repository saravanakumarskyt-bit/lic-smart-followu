import path from 'node:path';
import fs from 'node:fs';
import { startServer } from '../../scripts/serve.mjs';
import { loadPlaywright, chromePath, Suite, assert, eq, FIX, FIXED_NOW, here } from './harness.mjs';

const BASE_PATH = '/lic-smart-followup/'; // behave like GitHub Pages project hosting (sub-path)
const { chromium } = await loadPlaywright();
const server = await startServer(0, BASE_PATH);
const URL_ = `http://localhost:${server.address().port}${BASE_PATH}`;
const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] });

async function newCtx({ nativeMock = false, viewport = { width: 390, height: 844 } } = {}) {
  const context = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata', locale: 'en-IN', acceptDownloads: true, serviceWorkers: 'allow' });
  await context.grantPermissions(['notifications'], { origin: new URL(URL_).origin }).catch(() => {});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  if (nativeMock) await page.addInitScript(nativeMock);
  const api = {
    context, page, errors, URL: URL_,
    async open(hash = '') { await page.goto(URL_ + (hash ? `#${hash}` : '')); await page.waitForFunction(() => window.__licReady === true, null, { timeout: 15000 }); },
    async importPdfs(files, { dup } = {}) {
      await page.click('#nav a[data-nav=import]'); await page.waitForSelector('#pdf-input', { state: 'attached' });
      if (dup) await page.selectOption('select[aria-label="Duplicates"]', dup);
      await page.setInputFiles('#pdf-input', files.map((f) => path.join(FIX, f)));
      await page.waitForSelector('text=Check extracted data', { timeout: 30000 });
    },
    async counts() { const t = await page.$$eval('.sumcell', (els) => els.map((e) => [e.querySelector('.sumlbl').textContent, Number(e.querySelector('.sumnum').textContent)])); return Object.fromEntries(t); },
    async save() { await page.click('.savebar .btn.primary'); await page.waitForSelector('text=Import complete', { timeout: 15000 }); },
    async stat(label) { return Number(await page.$eval(`.stat:has(.stat-lbl:text-is("${label}")) .stat-val`, (e) => e.textContent)); },
    /** Fails if rendering leaked JavaScript values into the UI (e.g. "false", "undefined", "[object HTMLDivElement]"). */
    async noJunk(selector = 'body', label = '') {
      const text = await page.locator(selector).first().innerText();
      const m = /\b(false|undefined|null|NaN)\b|\[object|Invalid Date/i.exec(text);
      if (m) throw new Error(`junk text "${m[0]}" shown ${label || selector}: ...${text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ')}...`);
    },
    async close() { await context.close(); },
  };
  return api;
}

const S = new Suite();
globalThis.__S = S;
const { registerTests } = await import('./scenarios.mjs');
registerTests(S, { assert, eq, FIX, here, newCtx, URL_ });
const failed = await S.run(() => newCtx());
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
