import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPdfjs, FIXTURES } from './helpers.mjs';
import { extractAndParse, setPdfResources } from '../../public/js/core/pdftext.js';
import { tsvToWords, parseOcrPages } from '../../public/js/core/ocr.js';
import { buildRows, parsePages, classifyHeader, heuristicRow } from '../../public/js/core/parser.js';

const lib = await loadPdfjs();
const skip = lib ? false : 'pdfjs-dist not installed (run npm install)';
if (lib) setPdfResources(lib.resources);
const load = (f) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, f)));
const byPolicy = (recs, n) => recs.filter((r) => r.policyNumber === n);

test('header words are classified correctly, including tricky combinations', () => {
  assert.equal(classifyHeader('Policy No'), 'policyNumber');
  assert.equal(classifyHeader('Policy Number'), 'policyNumber');
  assert.equal(classifyHeader('Premium Due Date'), 'dueDate'); // due beats premium
  assert.equal(classifyHeader('FUP'), 'dueDate');
  assert.equal(classifyHeader('Next Due Date'), 'dueDate');
  assert.equal(classifyHeader('Premium Paying Term'), 'term'); // term beats premium
  assert.equal(classifyHeader('Instalment Premium'), 'premiumAmount');
  assert.equal(classifyHeader('Name of Policyholder'), 'name');
  assert.equal(classifyHeader('Policy Status'), 'status');
  assert.equal(classifyHeader('Mobile No.'), 'mobile');
  assert.equal(classifyHeader('DOC'), 'commencement'); // commencement date must NOT be read as the due date
  assert.equal(classifyHeader('S.No'), 'sno');
  assert.equal(classifyHeader('Lorem ipsum'), null);
});

test('heuristic row reading: no header, Rs. markers, +91 mobile, month-name dates', () => {
  const h = heuristicRow('2. 990002022 VIJAY ANAND  due 17-Dec-2026  Rs.11,250  Mob: +91 9000000022');
  assert.equal(h.fields.policyNumber, '990002022');
  assert.equal(h.fields.dueDate, '2026-12-17');
  assert.equal(h.fields.premiumAmount, 11250);
  assert.equal(h.fields.mobile, '9000000022');
  assert.equal(h.fields.customerName, 'VIJAY ANAND');
  assert.equal(heuristicRow('Total records: 8'), null);
});

test('heuristic row: never fabricates - missing pieces stay empty', () => {
  const h = heuristicRow('990002033 DEEPA RAMAN');
  assert.equal(h.fields.dueDate, undefined);
  assert.equal(h.fields.premiumAmount, undefined);
  assert.equal(h.fields.mobile, undefined);
});

test('text PDF, standard table: all rows read, DOC is not mistaken for the due date', { skip }, async () => {
  const r = await extractAndParse(lib.pdfjs, load('sample-a-standard.pdf'));
  assert.equal(r.records.length, 8);
  assert.deepEqual(r.scannedPages, []);
  const ramesh = byPolicy(r.records, '990000011')[0];
  assert.equal(ramesh.customerName, 'Ramesh Kumar');
  assert.equal(ramesh.dueDate, '2026-11-18'); // not 2015-03-15 (DOC)
  assert.equal(ramesh.premiumAmount, 12500);
  assert.equal(ramesh.mobile, '9000000001');
  assert.equal(ramesh.policyStatus, 'In Force');
  assert.equal(r.headerColumns.find((c) => c.field === 'dueDate').text, 'Due Date');
});

test('text PDF: missing mobile is kept empty and only warned about', { skip }, async () => {
  const r = await extractAndParse(lib.pdfjs, load('sample-a-standard.pdf'));
  const s = byPolicy(r.records, '990000055')[0];
  assert.equal(s.mobile, '');
  assert.ok(s.warnings.mobile);
  assert.deepEqual(s.errors, {});
});

test('text PDF: invalid date 31-02-2026 is a failed record, never silently corrected', { skip }, async () => {
  const r = await extractAndParse(lib.pdfjs, load('sample-a-standard.pdf'));
  const bad = byPolicy(r.records, '990000088')[0];
  assert.equal(bad.dueDate, '');
  assert.ok(bad.errors.dueDate);
  assert.equal(bad.needsReview, true);
  assert.equal(r.summary.failed, 1);
  assert.equal(r.summary.ok, 7);
});

test('text PDF: multiple policies for one customer are all extracted', { skip }, async () => {
  const r = await extractAndParse(lib.pdfjs, load('sample-a-standard.pdf'));
  const rk = r.records.filter((x) => x.customerName === 'Ramesh Kumar');
  assert.equal(rk.length, 2);
  assert.notEqual(rk[0].policyNumber, rk[1].policyNumber);
});

test('text PDF, two-line headers over two pages with wrapped names', { skip }, async () => {
  const r = await extractAndParse(lib.pdfjs, load('sample-b-twoline-headers.pdf'));
  assert.equal(r.numPages, 2);
  assert.equal(r.records.length, 5);
  assert.equal(byPolicy(r.records, '990001011')[0].customerName, 'Gopalakrishnan Venkataraman');
  assert.equal(byPolicy(r.records, '990001055')[0].customerName, 'Karthik Subramanian');
  assert.equal(byPolicy(r.records, '990001022')[0].premiumAmount, 2450.5);
  assert.equal(byPolicy(r.records, '990001055')[0].premiumAmount, 125000);
  assert.equal(byPolicy(r.records, '990001011')[0].dueDate, '2026-12-12');
  assert.deepEqual(r.headerColumns.map((c) => c.field).sort(), ['dueDate', 'mobile', 'name', 'policyNumber', 'premiumAmount', 'status']);
});

test('text PDF with no header or table: pattern-based extraction', { skip }, async () => {
  const r = await extractAndParse(lib.pdfjs, load('sample-c-no-header.pdf'));
  assert.equal(r.headerFound, false);
  assert.equal(r.records.length, 3);
  const v = byPolicy(r.records, '990002022')[0];
  assert.equal(v.customerName, 'Vijay Anand');
  assert.equal(v.dueDate, '2026-12-17');
  assert.equal(v.premiumAmount, 11250);
  assert.equal(v.mobile, '9000000022');
  assert.ok(r.records.every((x) => x.needsReview), 'pattern-only rows always wait for the advisor to check them');
});

test('scanned PDF: no text layer is detected and nothing is invented', { skip }, async () => {
  const r = await extractAndParse(lib.pdfjs, load('sample-d-scanned.pdf'));
  assert.deepEqual(r.scannedPages, [1]);
  assert.equal(r.records.length, 0);
});

test('OCR word boxes are parsed and every OCR record is forced into manual review', () => {
  const words = tsvToWords(fs.readFileSync(path.join(FIXTURES, 'sample-d-scanned.tsv'), 'utf8'));
  const r = parseOcrPages([{ page: 1, words }]);
  assert.equal(r.records.length, 3);
  assert.equal(byPolicy(r.records, '990003011')[0].dueDate, '2026-12-20');
  assert.equal(byPolicy(r.records, '990003022')[0].premiumAmount, 13800);
  assert.ok(r.records.every((x) => x.needsReview && x.viaOcr && x.confidence <= 0.7));
});

test('duplicates inside one file are flagged; a later installment of the same policy is not', { skip }, async () => {
  const a = await extractAndParse(lib.pdfjs, load('sample-e-duplicates.pdf'));
  assert.equal(a.records.length, 2);
  assert.equal(a.summary.duplicates, 0); // different due dates -> two valid installments
  const doubled = [...a.records, { ...a.records[0] }];
  const { markInternalDuplicates } = await import('../../public/js/core/parser.js');
  markInternalDuplicates(doubled);
  assert.equal(doubled[2].duplicateInFile, true);
  assert.equal(doubled[0].duplicateInFile, undefined);
});

test('garbage input does not crash and yields no records', () => {
  assert.deepEqual(parsePages([{ page: 1, rows: buildRows([]) }]).records, []);
  const items = [{ str: 'hello world', x: 10, y: 700, w: 50, h: 9 }, { str: 'nothing here', x: 10, y: 680, w: 50, h: 9 }];
  assert.deepEqual(parsePages([{ page: 1, rows: buildRows(items) }]).records, []);
});

test('LIC monthly premium-due list (S.No PolicyNo Name D.o.C Pln/Tm Mod FUP Flg InstPrem Due ...): FUP is month-only, day comes from D.o.C', { skip }, async () => {
  const r = await extractAndParse(lib.pdfjs, load('sample-h-lic-monthly.pdf'));
  const recs = r.records;
  assert.equal(recs.length, 4, 'heading, agent code and footer lines are not policies');
  assert.deepEqual(recs.map((x) => x.policyNumber), ['990000011', '990000012', '990000013', '990000014']);
  assert.equal(byPolicy(recs, '990000011')[0].dueDate, '2026-05-27');
  assert.equal(byPolicy(recs, '990000011')[0].premiumAmount, 832);
  assert.equal(byPolicy(recs, '990000011')[0].extra?.dueDateDerived ?? byPolicy(recs, '990000011')[0].dueDateDerived, true);
  assert.equal(byPolicy(recs, '990000012')[0].customerName, 'Long Test Customer Name Two', 'a date glued to a long name is not part of the name');
  assert.equal(byPolicy(recs, '990000012')[0].dueDate, '2026-07-24');
  assert.equal(byPolicy(recs, '990000013')[0].dueDate, '2026-02-28', 'commencement day 31 is clamped to the last day of February');
  assert.equal(byPolicy(recs, '990000013')[0].mode, 'Mly');
  assert.equal(byPolicy(recs, '990000011')[0].estCommission, 1164.8, 'EstCom column is read');
  assert.equal(byPolicy(recs, '990000011')[0].totalPremium, 5824);
  assert.equal(byPolicy(recs, '990000011')[0].instalmentsDue, 7);
  assert.ok(recs.every((x) => !x.needsReview && Object.keys(x.errors).length === 0));
});
