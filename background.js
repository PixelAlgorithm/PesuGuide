/**
 * Background Service Worker
 * Coordinates extension lifecycle, downloads, and storage.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('PESU Academy Course Downloader extension installed.');
});

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'OPEN_DOWNLOADS_FOLDER') {
    if (request.downloadId) {
      chrome.downloads.show(request.downloadId);
    } else {
      chrome.downloads.showDefaultFolder();
    }
    sendResponse({ success: true });
    return true;
  }
});

// Listen for download filename determination to enforce clean names and prevent Chrome UUID fallback
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item && item.filename) {
    const cleanName = item.filename.split(/[\\/]/).pop();
    suggest({
      filename: cleanName,
      conflictAction: 'uniquify'
    });
  } else {
    suggest();
  }
});
