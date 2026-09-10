/**
 * Background Service Worker (Manifest V3)
 * Coordinates course downloads, organization, PPTX conversion, and PDF merging in the background.
 * Keeps running uninterrupted even if the extension popup is closed or minimized.
 */
import './lib/jszip.min.js';
import './lib/pdf-lib.min.js';
import { CourseOrchestrator, formatSubjectSlug, pendingFilenameMap, pendingFilenameQueue, registerDownloadFilename } from './src/orchestrator.js';

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
    if (dId && chrome.downloads) {
      chrome.downloads.search({ id: dId }, (items) => {
        if (!chrome.runtime.lastError && items && items.length > 0 && items[0].state === 'complete' && items[0].exists) {
          try {
            chrome.downloads.show(dId);
            if (chrome.runtime.lastError) {
              chrome.downloads.showDefaultFolder();
            }
          } catch (e) {
            chrome.downloads.showDefaultFolder();
          }
        } else {
          chrome.downloads.showDefaultFolder();
        }
      });
    } else if (chrome.downloads) {
      chrome.downloads.showDefaultFolder();
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'SET_PENDING_DOWNLOAD_NAME') {
    if (request.filename) {
      registerDownloadFilename(request.url || null, request.filename);
      pendingDownloadName = request.filename;
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'PING') {
    sendResponse({ success: true, pong: true, version: '1.4' });
    return true;
  }

  if (request.action === 'START_DOWNLOAD') {
    try {
      const subjects = request.subjects || (request.subject ? [request.subject] : []);
      const semesterName = request.semesterName || 'Semester';
      const isAllSubjects = !!request.isAllSubjects;
      const courseTasks = subjects.map(s => ({
        semesterName,
        subject: s,
        selectedUnits: isAllSubjects ? null : request.selectedUnits
      }));
      const queueTitle = isAllSubjects 
        ? `All ${subjects.length} Courses in ${semesterName}` 
        : (subjects[0]?.displayName || subjects[0]?.code || 'Course');

      // Acknowledge popup immediately
      sendResponse({ success: true, started: true });

      // Run background processing safely
      setTimeout(() => {
        runCourseTasksDownload(courseTasks, request.options || {}, queueTitle, false, semesterName, false)
          .catch(err => {
            console.error('Download execution error:', err);
            addLog(`Download failed: ${err.message}`, 'error');
          });
      }, 0);
    } catch (err) {
      console.error('START_DOWNLOAD dispatch error:', err);
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  if (request.action === 'START_QUEUE_DOWNLOAD') {
    try {
      const queue = request.queue || [];
      const courseTasks = [];
      const distinctSemesters = new Set();

      for (const item of queue) {
        if (!item) continue;
        const semName = item.semesterName || 'Semester';
        distinctSemesters.add(semName);

        if (item.isAllSubjects && Array.isArray(item.subjects)) {
          for (const sub of item.subjects) {
            if (sub && (sub.id || sub.code)) {
              courseTasks.push({
                semesterName: semName,
                subject: sub,
                selectedUnits: null
              });
            }
          }
        } else if (item.subject && (item.subject.id || item.subject.code)) {
          courseTasks.push({
            semesterName: semName,
            subject: item.subject,
            selectedUnits: item.selectedUnits || null
          });
        }
      }

      if (courseTasks.length === 0) {
        sendResponse({ success: false, error: 'No valid courses found in download list.' });
        return true;
      }

      const hasMultipleSemesters = distinctSemesters.size > 1;
      const primarySemester = distinctSemesters.size === 1 ? Array.from(distinctSemesters)[0] : 'Bundle';
      const queueTitle = `Download List (${courseTasks.length} courses across ${distinctSemesters.size} semester${distinctSemesters.size === 1 ? '' : 's'})`;

      // Acknowledge popup immediately so message port is never closed abruptly
      sendResponse({ success: true, started: true });

      // Run background processing safely
      setTimeout(() => {
        runCourseTasksDownload(courseTasks, request.options || {}, queueTitle, hasMultipleSemesters, primarySemester, true)
          .catch(err => {
            console.error('Queue download execution error:', err);
            addLog(`Queue download failed: ${err.message}`, 'error');
          });
      }, 0);
    } catch (err) {
      console.error('START_QUEUE_DOWNLOAD dispatch error:', err);
      sendResponse({ success: false, error: err.message });
    }
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

async function runCourseTasksDownload(courseTasks, options = {}, queueTitle = '', hasMultipleSemesters = false, primarySemester = 'Semester', isFromQueue = false) {
  if (!Array.isArray(courseTasks) || courseTasks.length === 0) {
    addLog('No courses to download.', 'warn');
    return;
  }

  if (activeOrchestrator && !activeOrchestrator.isCancelled) {
    activeOrchestrator.cancel();
  }

  activeOrchestrator = new CourseOrchestrator();
  currentLogs = [];
  startKeepAlive();

  const titlePrefix = queueTitle || (courseTasks[0]?.subject?.displayName || courseTasks[0]?.subject?.code || 'Course Materials');
  addLog(`Starting background download for ${titlePrefix}...`, 'info');

  const isMultiCourse = courseTasks.length > 1;
  const isZipMode = options.downloadMode === 'zip' || options.downloadMode === undefined;
  const JSZipClass = (typeof JSZip !== 'undefined' && JSZip) ||
                     (typeof window !== 'undefined' && window.JSZip) ||
                     (typeof self !== 'undefined' && self.JSZip) ||
                     (typeof globalThis !== 'undefined' && globalThis.JSZip);

  // If multiple courses are being downloaded in ZIP mode, bundle all courses into one master ZIP
  const masterZip = (isMultiCourse && isZipMode && JSZipClass) ? new JSZipClass() : null;

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

  for (let tIdx = 0; tIdx < courseTasks.length; tIdx++) {
    if (activeOrchestrator.isCancelled) break;

    const task = courseTasks[tIdx];
    const sub = task.subject;
    const semName = task.semesterName || primarySemester || 'Semester';
    const subTitle = sub.displayName || `${sub.code} - ${sub.title}`;
    const courseHeader = isMultiCourse 
      ? `[${tIdx + 1}/${courseTasks.length}] ${sub.code}`
      : sub.code;

    const subjectSlug = formatSubjectSlug(sub);
    const courseFolderName = `${sub.code.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${subjectSlug}`.replace(/^_+|_+$/g, '');
    const semClean = semName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    let folderPrefix = '';
    if (masterZip) {
      if (hasMultipleSemesters) {
        folderPrefix = `${semClean}/${courseFolderName}`;
      } else {
        folderPrefix = courseFolderName;
      }
    }

    const courseOptions = masterZip ? {
      ...options,
      sharedZip: masterZip,
      folderPrefix,
      skipZipDownload: true
    } : options;

    addLog(`>>> Processing Course ${tIdx + 1} of ${courseTasks.length}: [${semName}] ${subTitle}`, 'info');

    const courseInitialState = {
      status: 'running',
      subject: courseHeader,
      percent: Math.round((tIdx / courseTasks.length) * 100),
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
        task.selectedUnits,
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
          const courseBasePercent = (tIdx / courseTasks.length) * 100;
          const courseRelativePercent = ((progress.percent || 0) / courseTasks.length);
          const totalPercent = Math.min(99, Math.round(courseBasePercent + courseRelativePercent));

          // When processing multiple courses, an individual course's completion is NOT overall completion
          const isIntermediateCourseCompletion = isMultiCourse && (tIdx < courseTasks.length - 1) && (progress.status === 'completed');
          const currentStatus = isIntermediateCourseCompletion ? 'course_completed' : progress.status;

          const updatedState = {
            status: activeOrchestrator.isCancelled ? 'cancelled' : 'running',
            subject: isMultiCourse ? `${courseHeader} - ${sub.title}` : subTitle,
            percent: isMultiCourse ? totalPercent : (progress.percent || 0),
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
        addLog(`✅ Completed [${tIdx + 1}/${courseTasks.length}] ${sub.code} (${summary.filesDownloaded} files downloaded, ${summary.pdfsMerged} merged PDFs)`, 'info');
      } else {
        addLog(`ℹ️ [${tIdx + 1}/${courseTasks.length}] ${sub.code}: No materials downloaded.`, 'warn');
      }
    } catch (err) {
      console.error(`Error processing subject ${sub.code}:`, err);
      addLog(`Error processing ${sub.code}: ${err.message}`, 'error');
    }
  }

  // If masterZip was used for multiple courses, package and download the single master ZIP
  if (masterZip && !activeOrchestrator.isCancelled && aggregatedSummary.filesDownloaded > 0) {
    let bundleZipFilename = 'pesu_materials_bundle.zip';
    if (hasMultipleSemesters) {
      bundleZipFilename = 'pesu_multisem_materials.zip';
    } else {
      const semClean = (primarySemester || 'semester')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      bundleZipFilename = `${semClean}_bundle.zip`;
    }

    addLog(`📦 Packaging all ${courseTasks.length} courses into single ZIP: ${bundleZipFilename}...`, 'info');
    broadcastProgress({
      status: 'merging',
      subject: titlePrefix,
      unitName: 'All Courses',
      currentFile: `Saving ${bundleZipFilename} to disk...`,
      message: `Packaging and saving ${bundleZipFilename} to disk...`,
      percent: 99,
      logs: currentLogs
    });

    try {
      const zipBlob = await masterZip.generateAsync({
        type: 'blob',
        compression: 'STORE',
        streamFiles: true
      });
      registerDownloadFilename(null, bundleZipFilename);
      lastDownloadId = await activeOrchestrator.triggerChromeDownload(zipBlob, bundleZipFilename);
      addLog(`✅ Single organized ZIP downloaded: ${bundleZipFilename}`, 'info');
    } catch (zipErr) {
      console.error('Failed to generate bundle zip:', zipErr);
      addLog(`Failed to package ${bundleZipFilename}: ${zipErr.message}`, 'error');
    }
  }

  if (!activeOrchestrator.isCancelled && isFromQueue) {
    await chrome.storage.local.remove('pesu_download_queue');
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
    queueCleared: (!activeOrchestrator.isCancelled && isFromQueue),
    message: finalStatus === 'cancelled' 
      ? 'Processing was stopped safely.' 
      : `All ${courseTasks.length} course(s) processed successfully!`
  });
  stopKeepAlive();
}

// Listen for download filename determination to enforce clean names and prevent Chrome UUID fallback
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  let desired = null;

  // 1. Exact match by download URL (blob: or data:)
  if (item && item.url && pendingFilenameMap.has(item.url)) {
    desired = pendingFilenameMap.get(item.url);
    pendingFilenameMap.delete(item.url);
  }

  // 2. FIFO queue of pending requested filenames
  if (!desired && pendingFilenameQueue.length > 0) {
    desired = pendingFilenameQueue.shift();
  }

  // 3. Current target filename from the active orchestrator
  if (!desired && activeOrchestrator && activeOrchestrator.currentTargetFilename) {
    desired = activeOrchestrator.currentTargetFilename;
  }

  // 4. If legacy pendingDownloadName was set
  if (!desired && pendingDownloadName) {
    desired = pendingDownloadName;
    pendingDownloadName = null;
  }

  // 5. Check if item.filename already has a clean semantic name (and not a UUID, hash, or generic)
  if (!desired && item && item.filename) {
    const rawName = item.filename.split(/[\\/]/).pop();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(rawName);
    const isHexHash = /^[0-9a-f]{16,}/i.test(rawName);
    const isGeneric = /^(download|file|presentation|slide|document)(\.[a-z0-9]+)?$/i.test(rawName);

    if (!isUuid && !isHexHash && !isGeneric && rawName.includes('.')) {
      desired = item.filename;
    }
  }

  if (desired) {
    // Normalize path separators and avoid any illegal root characters
    const cleanPath = desired.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    suggest({
      filename: cleanPath,
      conflictAction: 'uniquify'
    });
    return;
  }

  suggest({ conflictAction: 'uniquify' });
});
