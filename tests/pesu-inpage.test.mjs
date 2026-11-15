import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.PDFLib = require('../lib/pdf-lib.min.js');
globalThis.JSZip = require('../lib/jszip.min.js');
globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
const { CourseOrchestrator } = await import('../src/orchestrator.js');
const { PptxConverter } = await import('../src/pptx-converter.js');

// A minimal real PPTX (one slide with a title)
const z = new JSZip();
z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
z.file('ppt/presentation.xml', '<p:presentation xmlns:p="x"><p:sldSz cx="9144000" cy="6858000"/></p:presentation>');
z.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="x" xmlns:a="y"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>JavaScript Basics</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
const pptx = await z.generateAsync({ type: 'uint8array' });

const orch = new CourseOrchestrator();
orch.abortController = new AbortController();
let inFlight = 0, maxInFlight = 0, pageCalls = 0;
orch.scraper.fetchInPage = async (url) => {
  pageCalls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise(r => setTimeout(r, 30));
  inFlight--;
  return { bytes: pptx, finalUrl: url, contentDisposition: 'attachment; filename="JS Basics.pptx"' };
};
globalThis.fetch = async () => { throw new Error('direct fetch must not be used for PESU links'); };
orch.scraper.scanSubjectSlides = async () => ({
  units: [{ unitNumber: 1, files: [1, 2, 3, 4, 5, 6].map(i => ({ docId: String(9000 + i), title: `Topic ${i}`, fullUrl: `https://www.pesuacademy.com/Academy/a/referenceMeterials/downloadslidecoursedoc/${9000 + i}` })) }],
  totalFiles: 6
});
// Local converter not running in tests
PptxConverter.checkLocalServer = async () => ({ available: false });

let zipBlob;
orch.triggerChromeDownload = async (b) => { zipBlob = b; return 1; };
const sum = await orch.processSubject({ id: 1, code: 'UE24CS242A', title: 'Web Technologies', displayName: 'UE24CS242A - Web Technologies' }, [1], { downloadMode: 'zip' }, () => {});
console.log({ downloaded: sum.filesDownloaded, failed: sum.failed, converted: sum.pptxConverted, kept: sum.keptOriginal, reasons: sum.failedList.map(f => f.reason) });
assert.equal(pageCalls, 6, 'all PESU links fetched via the tab');
assert.equal(maxInFlight, 1, 'one PESU request at a time');
assert.equal(sum.failed, 0);
assert.equal(sum.filesDownloaded, 6);
const names = Object.keys((await JSZip.loadAsync(await zipBlob.arrayBuffer())).files).filter(n => !n.endsWith('/'));
console.log(names);
assert.equal(names.filter(n => n.startsWith('slides/unit_1/')).length, 6);
console.log('in-page PESU download tests passed');
