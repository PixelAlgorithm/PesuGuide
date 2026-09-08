/**
 * Background Service Worker
 * Coordinates extension lifecycle, downloads, and storage.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('PESU Academy Course Downloader extension installed.');
});

let pendingDownloadName = null;

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'OPEN_DOWNLOADS_FOLDER') {
    if (request.downloadId && typeof request.downloadId === 'number') {
      chrome.downloads.show(request.downloadId);
    } else {
      chrome.downloads.showDefaultFolder();
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'SET_PENDING_DOWNLOAD_NAME') {
    pendingDownloadName = request.filename;
    sendResponse({ success: true });
    return true;
  }
});

// Listen for download filename determination to enforce clean names and prevent Chrome UUID fallback
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (pendingDownloadName) {
    const desired = pendingDownloadName;
    pendingDownloadName = null;
    suggest({
      filename: desired,
      conflictAction: 'uniquify'
    });
    return;
  }

  if (item && item.filename) {
    const cleanName = item.filename.split(/[\\/]/).pop();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(cleanName);
    if (!isUuid && cleanName.includes('.')) {
      suggest({
        filename: cleanName,
        conflictAction: 'uniquify'
      });
      return;
    }
  }

  suggest();
});
