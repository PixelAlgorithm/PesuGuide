/**
 * Background Service Worker (Manifest V3)
 * Coordinates course downloads, organization, PPTX conversion, and PDF merging in the background.
 * Keeps running uninterrupted even if the extension popup is closed or minimized.
 */
import './lib/jszip.min.js';
import './lib/pdf-lib.min.js';
import { CourseOrchestrator, formatSubjectSlug } from './src/orchestrator.js';

let activeOrchestrator = null;
let keepAliveInterval = null;
let currentLogs = [];

function addLog(msg, type = 'info') {
  const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  currentLogs.push({ time, message: msg, type });
  if (currentLogs.length > 80) {
    currentLogs = currentLogs.slice(-80);
  }
}

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 10000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

function broadcastProgress(data) {
  chrome.runtime.sendMessage({
    action: 'DOWNLOAD_PROGRESS',
    data
  }).catch(() => {
    // Popup is closed/minimized, completely normal
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('PESU Academy Course Downloader background service worker initialized.');
});

let pendingDownloadName = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'OPEN_DOWNLOADS_FOLDER') {
    const dId = (request.downloadId && typeof request.downloadId === 'number') ? request.downloadId : null;
    if (dId) {
      chrome.downloads.search({ id: dId }, (items) => {
        if (!chrome.runtime.lastError && items && items.length > 0 && items[0].state === 'complete') {
          try {
            chrome.downloads.show(dId);
          } catch (e) {
            chrome.downloads.showDefaultFolder();
          }
        } else {
          // If the download is still in-progress or not complete, open downloads folder safely
          chrome.downloads.showDefaultFolder();
        }
      });
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

  if (request.action === 'START_DOWNLOAD') {
    const subjects = request.subjects || (request.subject ? [request.subject] : []);
    startBackgroundDownload(subjects, request.selectedUnits, request.options, request.isAllSubjects, request.semesterName);
    sendResponse({ success: true, started: true });
    return true;
  }

  if (request.action === 'CANCEL_DOWNLOAD') {
    if (activeOrchestrator) {
      activeOrchestrator.cancel();
      addLog('Download safely cancelled by user.', 'warn');
      chrome.storage.local.set({
        pesu_download_state: {
          status: 'cancelled',
          message: 'Download cancelled by user.',
          logs: currentLogs
        }
      });
      broadcastProgress({ status: 'cancelled', message: 'Download cancelled by user.', logs: currentLogs });
    }
    stopKeepAlive();
    sendResponse({ success: true });
    return true;
  }
});

async function startBackgroundDownload(subjects, selectedUnits, options, isAllSubjects = false, semesterName = '') {
  if (!Array.isArray(subjects)) {
    subjects = subjects ? [subjects] : [];
  }
  if (subjects.length === 0) return;

  if (activeOrchestrator && !activeOrchestrator.isCancelled) {
    activeOrchestrator.cancel();
  }

  activeOrchestrator = new CourseOrchestrator();
  currentLogs = [];
  startKeepAlive();

  const titlePrefix = isAllSubjects 
    ? `All ${subjects.length} Courses in Semester` 
    : (subjects[0].displayName || subjects[0].code);

  addLog(`Starting background download for ${titlePrefix}...`, 'info');

  const isZipMode = options.downloadMode === 'zip' || options.downloadMode === undefined;
  const JSZipClass = (typeof JSZip !== 'undefined' && JSZip) ||
                     (typeof window !== 'undefined' && window.JSZip) ||
                     (typeof self !== 'undefined' && self.JSZip) ||
                     (typeof globalThis !== 'undefined' && globalThis.JSZip);

  // When user requests all courses in single ZIP mode, bundle all courses into one master ZIP
  const masterZip = (isAllSubjects && isZipMode && JSZipClass) ? new JSZipClass() : null;

  const aggregatedSummary = {
    subject: titlePrefix,
    unitsFound: 0,
    filesFound: 0,
    filesDownloaded: 0,
    pptxConverted: 0,
    pdfsMerged: 0,
    failed: 0,
    failedList: [],
    emptyUnits: []
  };

  let lastDownloadId = null;

  for (let sIdx = 0; sIdx < subjects.length; sIdx++) {
    if (activeOrchestrator.isCancelled) break;

    const sub = subjects[sIdx];
    const subTitle = sub.displayName || `${sub.code} - ${sub.title}`;
    const courseHeader = isAllSubjects 
      ? `[${sIdx + 1}/${subjects.length}] ${sub.code}`
      : sub.code;

    const subjectSlug = formatSubjectSlug(sub);
    const courseFolderName = `${sub.code.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${subjectSlug}`.replace(/^_+|_+$/g, '');

    const courseOptions = masterZip ? {
      ...options,
      sharedZip: masterZip,
      folderPrefix: courseFolderName,
      skipZipDownload: true
    } : options;

    addLog(`>>> Processing Course ${sIdx + 1} of ${subjects.length}: ${subTitle}`, 'info');

    const courseInitialState = {
      status: 'running',
      subject: courseHeader,
      percent: Math.round((sIdx / subjects.length) * 100),
      unit: 'Discovering units...',
      file: `Preparing ${sub.code}...`,
      logs: currentLogs,
      summary: aggregatedSummary,
      startedAt: Date.now()
    };
    await chrome.storage.local.set({ pesu_download_state: courseInitialState });
    broadcastProgress({ status: 'started', state: courseInitialState });

    try {
      const summary = await activeOrchestrator.processSubject(
        sub,
        isAllSubjects ? null : selectedUnits,
        courseOptions,
        (progress) => {
          let msg = progress.message;
          if (!msg && progress.status === 'downloading') {
            msg = `[${sub.code}] Downloading: ${progress.currentFile || ''} (${progress.overallProgress || ''})`;
          } else if (!msg && progress.status === 'converting') {
            msg = `[${sub.code}] Converting: ${progress.currentFile || ''}`;
          } else if (!msg && progress.status === 'merging') {
            msg = `[${sub.code}] Merging unit PDF for ${progress.unitName || ''}...`;
          }

          if (msg) {
            const type = progress.status === 'unit_empty' ? 'warn' : (progress.status === 'failed' ? 'error' : 'info');
            addLog(msg, type);
          }

          if (progress.lastDownloadId) {
            lastDownloadId = progress.lastDownloadId;
          }

          // Calculate global progress across all courses
          const courseBasePercent = (sIdx / subjects.length) * 100;
          const courseRelativePercent = ((progress.percent || 0) / subjects.length);
          const totalPercent = Math.min(99, Math.round(courseBasePercent + courseRelativePercent));

          // When processing multiple courses, an individual course's completion is NOT overall completion
          const isIntermediateCourseCompletion = isAllSubjects && (sIdx < subjects.length - 1) && (progress.status === 'completed');
          const currentStatus = isIntermediateCourseCompletion ? 'course_completed' : progress.status;

          const updatedState = {
            status: activeOrchestrator.isCancelled ? 'cancelled' : 'running',
            subject: isAllSubjects ? `${courseHeader} - ${sub.title}` : subTitle,
            percent: isAllSubjects ? totalPercent : (progress.percent || 0),
            unit: progress.unitName || 'Processing...',
            file: progress.currentFile || progress.message || '',
            logs: currentLogs,
            summary: aggregatedSummary
          };

          chrome.storage.local.set({ pesu_download_state: updatedState });
          broadcastProgress({
            ...progress,
            status: currentStatus,
            percent: updatedState.percent,
            subject: updatedState.subject,
            logs: currentLogs
          });
        }
      );

      if (summary) {
        aggregatedSummary.unitsFound += summary.unitsFound || 0;
        aggregatedSummary.filesFound += summary.filesFound || 0;
        aggregatedSummary.filesDownloaded += summary.filesDownloaded || 0;
        aggregatedSummary.pptxConverted += summary.pptxConverted || 0;
        aggregatedSummary.pdfsMerged += summary.pdfsMerged || 0;
        aggregatedSummary.failed += summary.failed || 0;
        if (summary.failedList && summary.failedList.length > 0) {
          aggregatedSummary.failedList.push(...summary.failedList.map(item => ({
            ...item,
            unit: `[${sub.code}] ${item.unit}`
          })));
        }
        if (summary.emptyUnits && summary.emptyUnits.length > 0) {
          aggregatedSummary.emptyUnits.push(...summary.emptyUnits.map(u => `[${sub.code}] Unit ${u}`));
        }
        addLog(`✅ Completed [${sIdx + 1}/${subjects.length}] ${sub.code} (${summary.filesDownloaded} files downloaded, ${summary.pdfsMerged} merged PDFs)`, 'info');
      } else {
        addLog(`ℹ️ [${sIdx + 1}/${subjects.length}] ${sub.code}: No materials downloaded.`, 'warn');
      }
    } catch (err) {
      console.error(`Error processing subject ${sub.code}:`, err);
      addLog(`Error processing ${sub.code}: ${err.message}`, 'error');
    }
  }

  // If masterZip was used for all courses in the semester, package and download the single master ZIP
  if (masterZip && !activeOrchestrator.isCancelled && aggregatedSummary.filesDownloaded > 0) {
    const semClean = (semesterName || 'semester')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const semesterZipFilename = `${semClean}_all_courses.zip`;

    addLog(`📦 Packaging all ${subjects.length} courses into single ZIP: ${semesterZipFilename}...`, 'info');
    broadcastProgress({
      status: 'merging',
      subject: titlePrefix,
      unitName: 'All Courses',
      currentFile: `Saving ${semesterZipFilename} to disk...`,
      message: `Packaging and saving ${semesterZipFilename} to disk...`,
      percent: 99,
      logs: currentLogs
    });

    try {
      const zipBlob = await masterZip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });
      lastDownloadId = await activeOrchestrator.triggerChromeDownload(zipBlob, semesterZipFilename);
      addLog(`✅ Single organized ZIP downloaded: ${semesterZipFilename}`, 'info');
    } catch (zipErr) {
      console.error('Failed to generate semester zip:', zipErr);
      addLog(`Failed to package ${semesterZipFilename}: ${zipErr.message}`, 'error');
    }
  }

  const finalStatus = activeOrchestrator.isCancelled ? 'cancelled' : 'completed';
  const completedState = {
    status: finalStatus,
    subject: titlePrefix,
    percent: 100,
    summary: aggregatedSummary,
    lastDownloadId,
    logs: currentLogs,
    completedAt: Date.now()
  };

  await chrome.storage.local.set({ pesu_download_state: completedState });
  broadcastProgress({
    status: finalStatus,
    percent: 100,
    summary: aggregatedSummary,
    lastDownloadId,
    logs: currentLogs,
    message: finalStatus === 'cancelled' 
      ? 'Processing was stopped safely.' 
      : `All ${subjects.length} course(s) processed successfully!`
  });
  stopKeepAlive();
}

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
