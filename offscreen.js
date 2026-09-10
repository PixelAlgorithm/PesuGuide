/**
 * Offscreen Document Script (Manifest V3)
 * Provides DOM access to URL.createObjectURL() for memory-efficient, zero-copy file downloads.
 * Creates extension-origin blob URLs that can be downloaded natively via chrome.downloads in the Service Worker.
 */
import { getBlobFromDB, deleteBlobFromDB } from './src/idb-helper.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'OFFSCREEN_PING') {
    sendResponse({ success: true, ready: true });
    return true;
  }

  if (request.action === 'OFFSCREEN_CREATE_BLOB_URL') {
    createBlobUrl(request.key, request.mimeType)
      .then(url => sendResponse({ success: true, url }))
      .catch(err => {
        console.error('Failed to create blob URL in offscreen:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.action === 'OFFSCREEN_REVOKE_BLOB_URL') {
    if (request.url) {
      try {
        URL.revokeObjectURL(request.url);
      } catch (e) {}
    }
    if (request.key) {
      deleteBlobFromDB(request.key).catch(() => {});
    }
    sendResponse({ success: true });
    return true;
  }
});

async function createBlobUrl(key, mimeType) {
  const stored = await getBlobFromDB(key);
  if (!stored) {
    throw new Error('Blob not found in cache database.');
  }

  const blob = (stored instanceof Blob) 
    ? stored 
    : new Blob([stored], { type: mimeType || 'application/octet-stream' });

  return URL.createObjectURL(blob);
}
