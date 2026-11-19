// Shared helpers for browser end-to-end tests (Playwright + headless Chrome).
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const FIX = path.join(here, '..', 'fixtures');
export const FIXED_NOW = '2026-11-18T09:00:00+05:30'; // device "today" for every test

export async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* try global */ }
  const g = execSync('npm root -g').toString().trim();
  return import(pathToFileURL(path.join(g, 'playwright', 'index.mjs')).href);
}

export function chromePath() {
  for (const p of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (p && existsSync(p)) return p;
  return undefined;
}

export class Suite {
  constructor() { this.results = []; this.tests = []; }
  test(name, fn) { this.tests.push({ name, fn }); }
  async run(newCtx) {
    for (const t of this.tests) {
      const ctx = await newCtx();
      const started = Date.now();
      try { await t.fn(ctx); this.results.push({ name: t.name, ok: true, ms: Date.now() - started }); console.log(`  ok   ${t.name}`); }
      catch (e) { this.results.push({ name: t.name, ok: false, err: e }); console.log(`  FAIL ${t.name}\n       ${String(e.message).split('\n').slice(0, 6).join('\n       ')}`); try { await ctx.page.screenshot({ path: path.join(here, `fail-${this.results.length}.png`) }); } catch { /* ignore */ } }
      finally { await ctx.close(); }
    }
    const failed = this.results.filter((r) => !r.ok).length;
    console.log(`\n${this.results.length - failed}/${this.results.length} end-to-end tests passed`);
    return failed;
  }
}

export function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
export function eq(a, b, msg = '') { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)} but got ${JSON.stringify(a)}`); }
