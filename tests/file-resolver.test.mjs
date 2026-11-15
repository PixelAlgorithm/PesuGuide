import assert from 'node:assert/strict';
import { sniffType, extractNextUrl, normalizeShareUrl, guessExt, guessBaseName } from '../src/file-resolver.js';

const enc = (s) => new TextEncoder().encode(s);
const BASE = 'https://www.pesuacademy.com/Academy/a/x';

assert.equal(sniffType(enc('%PDF-1.7 rest')).type, 'pdf');
assert.equal(sniffType(new Uint8Array([0xd0,0xcf,0x11,0xe0,0,0])).type, 'ppt');
assert.equal(sniffType(new Uint8Array([0xd0,0xcf,0x11,0xe0,0,0]), 'doc').type, 'doc');
const zipPpt = new Uint8Array([0x50,0x4b,3,4, ...enc('[Content_Types].xml ppt/slides/slide1.xml')]);
assert.equal(sniffType(zipPpt).type, 'pptx');
const zipDoc = new Uint8Array([0x50,0x4b,3,4, ...enc('word/document.xml')]);
assert.equal(sniffType(zipDoc).type, 'docx');
assert.equal(sniffType(enc('<!DOCTYPE html><html></html>')).type, 'html');
assert.equal(sniffType(enc('just some plain notes text here, nothing else')).type, 'text');

assert.equal(extractNextUrl('<meta http-equiv="refresh" content="0; url=/files/a.pdf">', BASE), 'https://www.pesuacademy.com/files/a.pdf');
assert.equal(extractNextUrl('<iframe src="https://files.pesuacademy.com/elearning/abc.pptx"></iframe>', BASE), 'https://files.pesuacademy.com/elearning/abc.pptx');
assert.equal(extractNextUrl('<a onclick="x" href="/Academy/a/referenceMeterials/downloadslidecoursedoc/123">', BASE), 'https://www.pesuacademy.com/Academy/a/referenceMeterials/downloadslidecoursedoc/123');
assert.equal(extractNextUrl('<script src="/a.js"></script>', BASE), null);
assert.equal(extractNextUrl('viewer.html?file=https%3A%2F%2Fx.com%2Fn.pdf', BASE), 'https://x.com/n.pdf');

assert.equal(normalizeShareUrl('https://drive.google.com/file/d/AbC_1/view'), 'https://drive.google.com/uc?export=download&id=AbC_1&confirm=t');
assert.equal(guessExt('attachment; filename="Unit 1.PPTX"', 'https://x/y'), 'pptx');
assert.equal(guessBaseName('attachment; filename="Unit 1.pdf"'), 'Unit 1');
console.log('file-resolver tests passed');
