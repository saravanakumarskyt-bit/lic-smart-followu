// PDF -> positioned text items, using a PDF.js module that the caller provides
// (the browser app loads the vendored copy; Node tests load it from disk).
import { buildRows, parsePages, markInternalDuplicates, summarizeExtraction } from './parser.js';

/** Fewer characters than this on a page means it is probably a scan with no text layer. */
export const MIN_CHARS_PER_PAGE = 40;

/** Resource locations PDF.js needs (fonts and character maps). Set once by the app or the test runner. */
let pdfResources = {};
export function setPdfResources(res) { pdfResources = res || {}; }

export async function openPdf(pdfjsLib, data, opts = {}) {
  const task = pdfjsLib.getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: false,
    ...pdfResources,
    ...opts,
  });
  const doc = await task.promise;
  return { doc, task };
}

export function itemsOfTextContent(content) {
  const out = [];
  for (const it of content.items) {
    if (typeof it.str !== 'string' || !it.transform) continue;
    out.push({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
      h: it.height || Math.abs(it.transform[3]) || 8,
    });
  }
  return out;
}

/**
 * Read the text layer of every page.
 * Returns { numPages, pages: [{page, items, chars, scanned}] }.
 */
export async function extractTextItems(pdfjsLib, data, { onProgress, shouldCancel, password } = {}) {
  const { doc, task } = await openPdf(pdfjsLib, data, password ? { password } : {});
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    if (shouldCancel?.()) break;
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = itemsOfTextContent(content);
    const chars = items.reduce((s, i) => s + i.str.trim().length, 0);
    pages.push({ page: p, items, chars, scanned: chars < MIN_CHARS_PER_PAGE });
    page.cleanup();
    onProgress?.({ stage: 'text', page: p, total: doc.numPages });
  }
  const numPages = doc.numPages;
  await task.destroy();
  return { numPages, pages };
}

/** Turn pages of items into parsed records. */
export function parseExtractedPages(pages) {
  const rowPages = pages.map((p) => ({ page: p.page, rows: buildRows(p.items) }));
  const parsed = parsePages(rowPages);
  markInternalDuplicates(parsed.records);
  return { ...parsed, summary: summarizeExtraction(parsed.records) };
}

/** Convenience: full text-layer extraction + parsing. */
export async function extractAndParse(pdfjsLib, data, opts = {}) {
  const ext = await extractTextItems(pdfjsLib, data, opts);
  const scannedPages = ext.pages.filter((p) => p.scanned).map((p) => p.page);
  const textPages = ext.pages.filter((p) => !p.scanned);
  const parsed = parseExtractedPages(textPages);
  return { numPages: ext.numPages, scannedPages, ...parsed, method: 'text' };
}
