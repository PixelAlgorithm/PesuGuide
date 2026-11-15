import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PDFLib = require('../lib/pdf-lib.min.js');
globalThis.PDFLib = PDFLib;
globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };

const { CourseOrchestrator } = await import('../src/orchestrator.js');

async function makePdf(label) {
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage([200, 200]).drawText(label);
  return new Uint8Array(await doc.save());
}
const pdfA = await makePdf('a');
const pdfB = await makePdf('b');
const docx = new Uint8Array([0x50, 0x4b, 3, 4, ...new TextEncoder().encode('word/document.xml')]);

// fake network: wrapper page -> iframe -> pdf ; content-disposition docx ; direct pdf
const routes = {
  'https://www.pesuacademy.com/Academy/a/dl/1': { body: new TextEncoder().encode('<html><body><iframe src="https://files.pesuacademy.com/elearning/a.pdf"></iframe></body></html>'), headers: { 'content-type': 'text/html' } },
  'https://files.pesuacademy.com/elearning/a.pdf': { body: pdfA, headers: { 'content-type': 'application/pdf' } },
  'https://files.pesuacademy.com/elearning/b': { body: pdfB, headers: {} },
  'https://files.pesuacademy.com/elearning/note': { body: docx, headers: { 'content-disposition': 'attachment; filename="notes.docx"' } },
  'https://files.pesuacademy.com/elearning/bad': { body: new TextEncoder().encode('<html><body>nothing here</body></html>'), headers: {} },
};
globalThis.fetch = async (url) => {
  const r = routes[url];
  if (!r) return { ok: false, status: 404, statusText: 'nf', headers: new Headers(), url };
  return { ok: true, status: 200, url, headers: new Headers(r.headers), arrayBuffer: async () => r.body.buffer.slice(r.body.byteOffset, r.body.byteOffset + r.body.byteLength) };
};

const orch = new CourseOrchestrator();
orch.abortController = new AbortController();

// 1. wrapper resolution
const r1 = await orch.fetchResolved('https://www.pesuacademy.com/Academy/a/dl/1');
assert.equal(r1.type, 'pdf');
// 2. docx via disposition
const r2 = await orch.fetchResolved('https://files.pesuacademy.com/elearning/note');
assert.equal(r2.type, 'docx'); assert.equal(r2.baseName, 'notes');
// 3. dead-end wrapper
await assert.rejects(() => orch.fetchResolved('https://files.pesuacademy.com/elearning/bad'), /not a downloadable file/);

// 4. full subject run, slides + notes, direct mode
const saved = [];
orch.triggerChromeDownload = async (blob, path) => { saved.push(path); return saved.length; };
orch.scraper.scanSubjectSlides = async (id, sel, _p, ctype) => {
  const files = ctype === 3
    ? [{ docId: 'n1', title: 'Unit notes', fullUrl: 'https://files.pesuacademy.com/elearning/note' }]
    : [{ docId: 's1', title: 'Intro', fullUrl: 'https://www.pesuacademy.com/Academy/a/dl/1' }, { docId: 's2', title: 'Second', fullUrl: 'https://files.pesuacademy.com/elearning/b' }];
  return { units: [{ unitNumber: 1, files }], totalFiles: files.length };
};
const events = [];
const summary = await orch.processSubject({ id: 9, code: 'UE24CS242A', title: 'Web Technologies', displayName: 'UE24CS242A - Web Technologies' }, null,
  { downloadMode: 'direct', includeNotes: true, mergeUnitPdfs: true, mergeAllUnits: false }, (e) => events.push(e));
console.log(saved);
assert.equal(summary.failed, 0, JSON.stringify(summary.failedList));
assert.equal(summary.filesFound, 3);
assert.ok(saved.some(p => p.endsWith('web_technologies_unit_1_slide_01_intro.pdf')));
assert.ok(saved.some(p => p.includes('/notes/unit_1/') && p.endsWith('.docx')));
assert.ok(saved.some(p => p.endsWith('web_technologies_unit_1.pdf')), 'merged slides pdf');
const last = events.at(-1);
assert.equal(last.status, 'completed');
assert.ok(events.every(e => e.percent === undefined || e.percent <= 99 || e.status === 'completed'));
console.log('orchestrator tests passed');

// 5. ZIP mode packs slides + notes together
globalThis.JSZip = require('../lib/jszip.min.js');
const orch2 = new CourseOrchestrator();
let zipBlob = null, zipName = null;
orch2.triggerChromeDownload = async (blob, path) => { zipBlob = blob; zipName = path; return 1; };
orch2.scraper.scanSubjectSlides = orch.scraper.scanSubjectSlides;
await orch2.processSubject({ id: 9, code: 'X', title: 'Web Technologies', displayName: 'X - Web' }, null, { downloadMode: 'zip', includeNotes: true }, () => {});
assert.equal(zipName, 'web_technologies_units-1.zip');
const z = await globalThis.JSZip.loadAsync(await zipBlob.arrayBuffer());
const names = Object.keys(z.files);
console.log(names);
assert.ok(names.some(n => n.startsWith('slides/unit_1/') && n.endsWith('.pdf')));
assert.ok(names.some(n => n.startsWith('notes/unit_1/') && n.endsWith('.docx')));
console.log('zip test passed');
