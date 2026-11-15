/**
 * Helpers for talking to the offscreen document (offscreen.html).
 * The service worker has no DOM; the offscreen document does, so it handles
 * blob URLs for downloads and PPTX parsing for conversion.
 */
import { saveBlobToDB, getBlobFromDB, deleteBlobFromDB } from './idb-helper.js';

async function pingOffscreen(timeoutMs = 400) {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage({ action: 'OFFSCREEN_PING' }, (res) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError || !res || !res.ready) {
            resolve(false);
          } else {
            resolve(true);
          }
        }
      });
    } catch (e) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(false);
      }
    }
  });
}

async function waitForOffscreenReady(maxRetries = 25, intervalMs = 100) {
  for (let i = 0; i < maxRetries; i++) {
    const isReady = await pingOffscreen(300);
    if (isReady) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

let offscreenCreating = null;
export async function ensureOffscreenDocument() {
  if (typeof chrome === 'undefined' || !chrome.offscreen) return false;
  try {
    if (await chrome.offscreen.hasDocument()) {
      const alive = await pingOffscreen(300);
      if (alive) return true;
      try {
        await chrome.offscreen.closeDocument();
      } catch (e) {}
    }

    if (offscreenCreating) {
      await offscreenCreating;
      return await waitForOffscreenReady(15, 100);
    }

    offscreenCreating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS', 'DOM_PARSER'],
      justification: 'Create blob URLs for downloads and parse PPTX slide XML for PDF conversion'
    });
    await offscreenCreating;
    offscreenCreating = null;

    const ready = await waitForOffscreenReady(25, 100);
    return ready;
  } catch (e) {
    offscreenCreating = null;
    console.warn('Offscreen document creation error:', e);
    return false;
  }
}


/**
 * Convert a PPTX in the offscreen document. Bytes travel through IndexedDB
 * so large files are not copied through runtime messaging.
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function convertPptxOffscreen(bytes, filename, timeoutMs = 180000) {
  const ready = await ensureOffscreenDocument();
  if (!ready) throw new Error('Converter page could not start');
  const key = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await saveBlobToDB(key, bytes);
  try {
    const res = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PPTX conversion timed out')), timeoutMs);
      chrome.runtime.sendMessage({ action: 'OFFSCREEN_CONVERT_PPTX', key, filename }, (r) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!r || !r.success) return reject(new Error(r?.error || 'PPTX conversion failed'));
        resolve(r);
      });
    });
    const out = await getBlobFromDB(res.outKey);
    await deleteBlobFromDB(res.outKey).catch(() => {});
    if (!out) throw new Error('Converted PDF missing');
    return out instanceof Uint8Array ? out : new Uint8Array(out instanceof Blob ? await out.arrayBuffer() : out);
  } finally {
    deleteBlobFromDB(key).catch(() => {});
  }
}
