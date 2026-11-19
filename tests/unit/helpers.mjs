// Locates a PDF.js build that runs in Node (the legacy build) and points it at its font data.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.join(here, '..', '..', 'node_modules', 'pdfjs-dist')];
try { roots.push(path.join(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(), 'pdfjs-dist')); } catch { /* ignore */ }

export async function loadPdfjs() {
  for (const r of roots) {
    const lib = path.join(r, 'legacy', 'build', 'pdf.mjs');
    if (existsSync(lib)) {
      const pdfjs = await import(pathToFileURL(lib).href);
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(r, 'legacy', 'build', 'pdf.worker.mjs')).href;
      return { pdfjs, resources: { standardFontDataUrl: path.join(r, 'standard_fonts') + path.sep, cMapUrl: path.join(r, 'cmaps') + path.sep, cMapPacked: true } };
    }
  }
  return null;
}

export const FIXTURES = path.join(here, '..', 'fixtures');
