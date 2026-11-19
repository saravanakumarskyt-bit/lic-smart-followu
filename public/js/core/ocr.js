// Optional OCR for scanned PDFs.
//
// Tesseract.js is NOT bundled in git (it is large). Run `npm run vendor:ocr` once after `npm install`; that copies
// the worker, WASM core and English language data into public/vendor/tesseract/ so OCR works fully offline.
// Without it the app shows a clear message and the user can still add records manually or import a CSV.
import { buildRows, parsePages, markInternalDuplicates, summarizeExtraction } from './parser.js';

export const OCR_BASE = './vendor/tesseract/';

/** OCR word boxes -> the positioned items the parser expects (image y grows downward, parser y grows upward). */
export function wordsToItems(words, { minConfidence = 25 } = {}) {
  const items = [];
  for (const w of words || []) {
    const text = String(w.text ?? '').trim();
    if (!text) continue;
    if (typeof w.confidence === 'number' && w.confidence < minConfidence) continue;
    const b = w.bbox;
    if (!b) continue;
    items.push({ str: text, x: b.x0, y: -((b.y0 + b.y1) / 2), w: b.x1 - b.x0, h: Math.max(1, b.y1 - b.y0) });
  }
  return items;
}

/** Parse the TSV that `tesseract image out tsv` writes (used by the Node tests). */
export function tsvToWords(tsv) {
  const words = [];
  const lines = tsv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const [left, top, width, height] = [Number(c[6]), Number(c[7]), Number(c[8]), Number(c[9])];
    words.push({ text: c.slice(11).join('\t'), confidence: Number(c[10]), bbox: { x0: left, y0: top, x1: left + width, y1: top + height } });
  }
  return words;
}

/** Parse OCR pages into records. Each page: { page, words }. Records are always flagged lower-confidence. */
export function parseOcrPages(ocrPages) {
  const pages = ocrPages.map((p) => ({ page: p.page, rows: buildRows(wordsToItems(p.words)) }));
  const parsed = parsePages(pages);
  for (const r of parsed.records) {
    r.viaOcr = true;
    r.issues = [...r.issues, 'Read by OCR: please check every value'];
    r.needsReview = true;
    r.confidence = Math.min(r.confidence, 0.7);
  }
  markInternalDuplicates(parsed.records);
  return { ...parsed, summary: summarizeExtraction(parsed.records), method: 'ocr' };
}

let tessPromise = null;

/** Load the vendored Tesseract.js script once. Rejects with a helpful message if it was not vendored. */
export function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  if (tessPromise) return tessPromise;
  tessPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${OCR_BASE}tesseract.min.js`;
    s.onload = () => (globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new Error('OCR library did not initialise')));
    s.onerror = () => {
      tessPromise = null;
      reject(new Error('OCR files are not installed in this build. Run "npm run vendor:ocr" and rebuild (see README), or enter the records manually.'));
    };
    document.head.appendChild(s);
  });
  return tessPromise;
}

/** Render one PDF page to a canvas at roughly 200-300 DPI for OCR. */
export async function renderPageToCanvas(pdfPage, targetWidthPx = 2000) {
  const base = pdfPage.getViewport({ scale: 1 });
  const scale = Math.min(4, Math.max(1.5, targetWidthPx / base.width));
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

/**
 * OCR the given pages of an already-opened PDF document.
 * Returns [{ page, words }] with Tesseract word boxes.
 */
export async function ocrPdfPages(pdfDoc, pageNumbers, { onProgress, shouldCancel, lang = 'eng' } = {}) {
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker(lang, 1, {
    workerPath: `${OCR_BASE}worker.min.js`,
    corePath: OCR_BASE,
    langPath: OCR_BASE,
    gzip: false,
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.({ stage: 'ocr', fraction: m.progress });
    },
  });
  const out = [];
  try {
    await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' });
    let done = 0;
    for (const n of pageNumbers) {
      if (shouldCancel?.()) break;
      const page = await pdfDoc.getPage(n);
      const canvas = await renderPageToCanvas(page);
      const res = await worker.recognize(canvas, {}, { blocks: true });
      const words = res.data.words || (res.data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => (p.lines || []).flatMap((l) => l.words || [])));
      out.push({ page: n, words });
      canvas.width = canvas.height = 0;
      page.cleanup();
      done++;
      onProgress?.({ stage: 'ocr-page', page: n, done, total: pageNumbers.length });
    }
  } finally {
    await worker.terminate();
  }
  return out;
}
