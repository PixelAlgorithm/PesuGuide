/**
 * Popup UI Controller
 * Manages user interactions, course selection, unit filtering, live progress, and download actions.
 */
import { PesuScraper } from './src/pesu-scraper.js';
import { PptxConverter } from './src/pptx-converter.js';

// DOM Elements
const connectionBadge = document.getElementById('connectionBadge');
const loginPromptCard = document.getElementById('loginPromptCard');
const mainContent = document.getElementById('mainContent');
const openPesuBtn = document.getElementById('openPesuBtn');
const refreshLoginBtn = document.getElementById('refreshLoginBtn');
const reloadExtBtn = document.getElementById('reloadExtBtn');

const semesterSelect = document.getElementById('semesterSelect');
const subjectSelect = document.getElementById('subjectSelect');
const processAllSubjectsCheck = document.getElementById('processAllSubjectsCheck');
const unitsSection = document.getElementById('unitsSection');
const unitsContainer = document.getElementById('unitsContainer');
const selectAllUnits = document.getElementById('selectAllUnits');
const deselectAllUnits = document.getElementById('deselectAllUnits');

// Download List / Queue Elements
const addToQueueBtn = document.getElementById('addToQueueBtn');
const queueAddFeedback = document.getElementById('queueAddFeedback');
const queueSection = document.getElementById('queueSection');
const queueCountBadge = document.getElementById('queueCountBadge');
const clearQueueBtn = document.getElementById('clearQueueBtn');
const queueItemsContainer = document.getElementById('queueItemsContainer');

const converterBadge = document.getElementById('converterBadge');
const downloadModeSelect = document.getElementById('downloadModeSelect');
const mergeUnitPdfsCheck = document.getElementById('mergeUnitPdfsCheck');
const saveIndividualCheck = document.getElementById('saveIndividualCheck');

const progressSection = document.getElementById('progressSection');
const progressSpinner = document.getElementById('progressSpinner');
const progressHeading = document.getElementById('progressHeading');
const progressSubHeading = document.getElementById('progressSubHeading');
const progressPercent = document.getElementById('progressPercent');
const overallProgressBar = document.getElementById('overallProgressBar');
const currentUnitVal = document.getElementById('currentUnitVal');
const currentFileVal = document.getElementById('currentFileVal');
const logContent = document.getElementById('logContent');
const clearLogBtn = document.getElementById('clearLogBtn');

const startBtn = document.getElementById('startBtn');
const cancelBtn = document.getElementById('cancelBtn');
const openFolderBtn = document.getElementById('openFolderBtn');

const summaryModal = document.getElementById('summaryModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const modalDoneBtn = document.getElementById('modalDoneBtn');
const modalOpenFolderBtn = document.getElementById('modalOpenFolderBtn');
const statUnits = document.getElementById('statUnits');
const statFilesFound = document.getElementById('statFilesFound');
const statDownloaded = document.getElementById('statDownloaded');
const statConverted = document.getElementById('statConverted');
const statMerged = document.getElementById('statMerged');
const statFailed = document.getElementById('statFailed');
const failedFilesSection = document.getElementById('failedFilesSection');
const failedList = document.getElementById('failedList');

// Instances & State
const scraper = new PesuScraper();
let currentSubjects = [];
let lastCompletedDownloadId = null;
let downloadQueue = [];
let feedbackTimer = null;

// Helper: Append log
function addLog(message, type = 'info') {
  const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const row = document.createElement('div');
  row.className = 'log-entry';
  row.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-msg-${type}">${message}</span>`;
  logContent.appendChild(row);
  logContent.scrollTop = logContent.scrollHeight;
}

// Check local converter
async function updateConverterStatus() {
  const status = await PptxConverter.checkLocalServer();
  if (status.available) {
    converterBadge.textContent = `⚡ ${status.engine}`;
    converterBadge.title = 'Local PowerPoint/LibreOffice converter active (High fidelity)';
  } else {
    converterBadge.textContent = '📦 Built-in JS Engine';
    converterBadge.title = 'Using in-browser client-side PPTX converter';
  }
}

// Verify Login & Load Semesters
async function init() {
  connectionBadge.className = 'badge badge-warning';
  connectionBadge.innerHTML = '<span class="status-dot"></span> Checking session...';

  updateConverterStatus();

  const status = await scraper.checkLoginStatus();
  if (!status.loggedIn) {
    connectionBadge.className = 'badge badge-danger';
    connectionBadge.innerHTML = '<span class="status-dot"></span> Not Logged In';
    loginPromptCard.classList.remove('hidden');
    semesterSelect.innerHTML = '<option value="">⚠️ Sign in to PESU Academy first</option>';
    semesterSelect.disabled = true;
    subjectSelect.innerHTML = '<option value="">Select a semester first</option>';
    subjectSelect.disabled = true;
    startBtn.disabled = true;
    addLog(status.error || 'PESU Academy session not detected. Please sign in in the browser.', 'warn');
    return;
  }

  connectionBadge.className = 'badge badge-success';
  connectionBadge.innerHTML = '<span class="status-dot"></span> Connected';
  loginPromptCard.classList.add('hidden');
  semesterSelect.disabled = false;
  subjectSelect.disabled = false;
  startBtn.disabled = false;

  checkActiveBackgroundDownload();
  await loadQueue();

  // Ping background service worker to keep channel warm
  try {
    chrome.runtime.sendMessage({ action: 'PING' }, (res) => {
      if (chrome.runtime.lastError || !res?.pong) {
        console.warn('Background worker ping:', chrome.runtime.lastError?.message);
      }
    });
  } catch (e) {}

  await loadSemesters();
}

// Load Semesters
async function loadSemesters() {
  semesterSelect.disabled = true;
  semesterSelect.innerHTML = '<option value="" disabled selected>Loading semesters...</option>';
  try {
    const semesters = await scraper.getSemesters();
    semesterSelect.innerHTML = '';
    if (!semesters || semesters.length === 0) {
      semesterSelect.innerHTML = '<option value="">No semesters found</option>';
      return;
    }

    semesters.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.selected) opt.selected = true;
      semesterSelect.appendChild(opt);
    });

    semesterSelect.disabled = false;
    await loadSubjects(semesterSelect.value);
  } catch (err) {
    console.error('Failed to load semesters:', err);
    semesterSelect.innerHTML = `<option value="">⚠️ ${err.message || 'Failed to load semesters'}</option>`;
    semesterSelect.disabled = true;
    addLog(`Failed to load semesters: ${err.message}`, 'error');
    if (err.message && (err.message.includes('Session expired') || err.message.includes('Sign in'))) {
      connectionBadge.className = 'badge badge-danger';
      connectionBadge.innerHTML = '<span class="status-dot"></span> Session Expired';
      loginPromptCard.classList.remove('hidden');
    }
  }
}

// Load Subjects for selected semester
async function loadSubjects(semesterId) {
  if (!semesterId) return;
  subjectSelect.disabled = true;
  subjectSelect.innerHTML = '<option value="" disabled selected>Loading courses...</option>';
  unitsContainer.innerHTML = '<div class="empty-hint">Loading unit details...</div>';

  try {
    currentSubjects = await scraper.getSubjects(semesterId);
    subjectSelect.innerHTML = '';

    if (!currentSubjects || currentSubjects.length === 0) {
      subjectSelect.innerHTML = '<option value="">No courses found in this semester</option>';
      unitsContainer.innerHTML = '<div class="empty-hint">No courses found.</div>';
      return;
    }

    currentSubjects.forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub.id;
      opt.textContent = `${sub.code} - ${sub.title}`;
      subjectSelect.appendChild(opt);
    });

    subjectSelect.disabled = false;
    await loadUnits(subjectSelect.value);
  } catch (err) {
    console.error('Failed to load subjects:', err);
    subjectSelect.innerHTML = `<option value="">⚠️ ${err.message || 'Failed to load courses'}</option>`;
    unitsContainer.innerHTML = `<div class="empty-hint text-danger">${err.message}</div>`;
    addLog(`Failed to load courses: ${err.message}`, 'error');
    if (err.message && err.message.toLowerCase().includes('session')) {
      connectionBadge.className = 'badge badge-danger';
      connectionBadge.innerHTML = '<span class="status-dot"></span> Session Expired';
      loginPromptCard.classList.remove('hidden');
    }
  }
}

// Load Units for selected subject
async function loadUnits(subjectId) {
  if (!subjectId) return;
  unitsContainer.innerHTML = '<div class="empty-hint">Loading unit details...</div>';

  try {
    const units = await scraper.getUnits(subjectId);
    unitsContainer.innerHTML = '';

    if (units.length === 0) {
      unitsContainer.innerHTML = '<div class="empty-hint">No units found for this course.</div>';
      return;
    }

    units.forEach(u => {
      const item = document.createElement('div');
      item.className = 'unit-item';
      item.innerHTML = `
        <label>
          <input type="checkbox" class="unit-checkbox" value="${u.unitNumber}" checked>
          <span>${u.folderName}: ${u.rawName.replace(/^Unit\s*\d+\s*:\s*/i, '')}</span>
        </label>
        <span class="unit-badge">${u.folderName}</span>
      `;
      unitsContainer.appendChild(item);
    });
  } catch (err) {
    console.error('Failed to load units:', err);
    unitsContainer.innerHTML = `<div class="empty-hint">Failed to load units: ${err.message}</div>`;
  }
}

// Get selected unit numbers
function getSelectedUnitNumbers() {
  const checkboxes = document.querySelectorAll('.unit-checkbox:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.value, 10));
}

// Load persistent queue from storage
async function loadQueue() {
  try {
    const data = await chrome.storage.local.get('pesu_download_queue');
    downloadQueue = Array.isArray(data.pesu_download_queue) ? data.pesu_download_queue : [];
  } catch (err) {
    console.warn('Failed to load download queue:', err);
    downloadQueue = [];
  }
  renderQueue();
}

// Persist queue to storage
async function saveQueue() {
  try {
    await chrome.storage.local.set({ pesu_download_queue: downloadQueue });
  } catch (err) {
    console.warn('Failed to save download queue:', err);
  }
  renderQueue();
}

// Render queue items in popup
function renderQueue() {
  if (!queueSection || !queueItemsContainer || !queueCountBadge || !startBtn) return;

  const count = downloadQueue.length;
  queueCountBadge.textContent = count;

  if (count === 0) {
    queueSection.classList.add('hidden');
    queueItemsContainer.innerHTML = '';
    startBtn.innerHTML = '<span class="btn-icon">⬇️</span> Start Download';
    return;
  }

  queueSection.classList.remove('hidden');
  startBtn.innerHTML = `<span class="btn-icon">⬇️</span> Download List (${count} ${count === 1 ? 'item' : 'items'})`;

  queueItemsContainer.innerHTML = '';
  downloadQueue.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'queue-item';
    row.innerHTML = `
      <div class="queue-item-info">
        <div class="queue-item-header">
          <span class="queue-sem-tag">${item.semesterName || 'Sem'}</span>
          <span class="queue-item-title" title="${item.title}">${item.title}</span>
        </div>
        <div class="queue-item-detail">${item.unitSummary}</div>
      </div>
      <button type="button" class="queue-remove-btn" data-index="${index}" title="Remove from list">🗑️</button>
    `;
    queueItemsContainer.appendChild(row);
  });

  queueItemsContainer.querySelectorAll('.queue-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      removeFromQueue(idx);
    });
  });
}

// Show visual feedback pill
function showQueueFeedback(text = '✓ Added!') {
  if (!queueAddFeedback) return;
  queueAddFeedback.textContent = text;
  queueAddFeedback.classList.remove('hidden');
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    queueAddFeedback.classList.add('hidden');
  }, 2000);
}

// Add current selection to queue
function addToQueue() {
  const semesterId = semesterSelect.value;
  const semesterName = semesterSelect.options[semesterSelect.selectedIndex]?.text || 'Semester';
  const isAllSubjects = processAllSubjectsCheck.checked;

  if (!semesterId) {
    alert('Please select a semester first.');
    return;
  }

  if (isAllSubjects) {
    if (!currentSubjects || currentSubjects.length === 0) {
      alert('No courses found in this semester to add.');
      return;
    }

    const existingIndex = downloadQueue.findIndex(q => q.semesterId === semesterId && q.isAllSubjects);
    const item = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      semesterId,
      semesterName,
      isAllSubjects: true,
      title: `All Courses (${currentSubjects.length})`,
      subjects: currentSubjects.map(s => ({
        id: s.id,
        code: s.code,
        title: s.title,
        displayName: s.displayName || `${s.code} - ${s.title}`
      })),
      selectedUnits: null,
      unitSummary: `All ${currentSubjects.length} courses in ${semesterName}`
    };

    if (existingIndex >= 0) {
      downloadQueue[existingIndex] = item;
      showQueueFeedback('✓ Updated in list!');
    } else {
      // Remove any individual courses from this semester since user is adding the whole semester
      downloadQueue = downloadQueue.filter(q => !(q.semesterId === semesterId && !q.isAllSubjects));
      downloadQueue.push(item);
      showQueueFeedback(`✓ Added ${semesterName} (${currentSubjects.length} courses)!`);
    }

    saveQueue();
    return;
  }

  // Individual course selection
  const selectedCourse = currentSubjects.find(s => s.id === subjectSelect.value);
  if (!selectedCourse) {
    alert('Please select a course to add.');
    return;
  }

  const selectedUnits = getSelectedUnitNumbers();
  if (!selectedUnits || selectedUnits.length === 0) {
    alert('Please select at least one unit to add.');
    return;
  }

  const allCheckboxes = document.querySelectorAll('.unit-checkbox');
  const isAllUnits = allCheckboxes.length > 0 && selectedUnits.length === allCheckboxes.length;
  const unitSummary = isAllUnits ? 'All Units' : `Units: ${selectedUnits.join(', ')}`;

  // If the whole semester is already queued, alert user
  const semQueued = downloadQueue.some(q => q.semesterId === semesterId && q.isAllSubjects);
  if (semQueued) {
    alert(`The entire ${semesterName} is already in your download list.`);
    return;
  }

  const existingCourseIdx = downloadQueue.findIndex(q => !q.isAllSubjects && q.subject && q.subject.id === selectedCourse.id);
  const courseItem = {
    id: `queue_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    semesterId,
    semesterName,
    isAllSubjects: false,
    subject: {
      id: selectedCourse.id,
      code: selectedCourse.code,
      title: selectedCourse.title,
      displayName: selectedCourse.displayName || `${selectedCourse.code} - ${selectedCourse.title}`
    },
    selectedUnits: isAllUnits ? null : selectedUnits,
    title: `${selectedCourse.code} - ${selectedCourse.title}`,
    unitSummary
  };

  if (existingCourseIdx >= 0) {
    downloadQueue[existingCourseIdx] = courseItem;
    showQueueFeedback('✓ Course updated!');
  } else {
    downloadQueue.push(courseItem);
    showQueueFeedback(`✓ Added ${selectedCourse.code}!`);
  }

  saveQueue();
}

function removeFromQueue(index) {
  if (index >= 0 && index < downloadQueue.length) {
    downloadQueue.splice(index, 1);
    saveQueue();
  }
}

function clearQueue(e) {
  if (e) e.preventDefault();
  downloadQueue = [];
  saveQueue();
}

// Event Listeners
semesterSelect.addEventListener('change', () => loadSubjects(semesterSelect.value));
subjectSelect.addEventListener('change', () => loadUnits(subjectSelect.value));

processAllSubjectsCheck.addEventListener('change', () => {
  if (processAllSubjectsCheck.checked) {
    subjectSelect.disabled = true;
    unitsSection.classList.add('hidden');
  } else {
    subjectSelect.disabled = false;
    unitsSection.classList.remove('hidden');
  }
});

selectAllUnits.addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelectorAll('.unit-checkbox').forEach(cb => cb.checked = true);
});

deselectAllUnits.addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelectorAll('.unit-checkbox').forEach(cb => cb.checked = false);
});

if (addToQueueBtn) addToQueueBtn.addEventListener('click', addToQueue);
if (clearQueueBtn) clearQueueBtn.addEventListener('click', clearQueue);

if (reloadExtBtn) {
  reloadExtBtn.addEventListener('click', () => {
    reloadExtBtn.textContent = '⏳';
    addLog('Reloading extension...', 'info');
    if (chrome.runtime.reload) {
      chrome.runtime.reload();
    } else {
      location.reload();
    }
  });
}

openPesuBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.pesuacademy.com/Academy/' });
});

refreshLoginBtn.addEventListener('click', init);

clearLogBtn.addEventListener('click', (e) => {
  e.preventDefault();
  logContent.innerHTML = '';
});

// Check and resume active background download if popup is reopened
function checkActiveBackgroundDownload() {
  chrome.storage.local.get('pesu_download_state').then(data => {
    const state = data.pesu_download_state;
    if (state && state.status === 'running') {
      handleProgressUpdate({
        status: 'downloading',
        unitName: state.unit,
        currentFile: state.file,
        percent: state.percent,
        logs: state.logs,
        message: `Resumed background processing: ${state.subject || ''}`
      });
    } else if (state && state.status === 'completed') {
      if (state.lastDownloadId) lastCompletedDownloadId = state.lastDownloadId;
      openFolderBtn.classList.remove('hidden');
      if (state.completedAt && (Date.now() - state.completedAt < 60000) && state.summary) {
        showSummaryModal(state.summary);
      }
    }
  });
}

// Handle live progress updates from background/offscreen worker
function handleProgressUpdate(event) {
  if (!event) return;

  progressSection.classList.remove('hidden');
  startBtn.classList.add('hidden');
  cancelBtn.classList.remove('hidden');

  if (event.status === 'started' || event.status === 'scanning') {
    progressHeading.textContent = 'Discovering Materials...';
    progressSubHeading.textContent = event.message || 'Scanning units and classes...';
  } else if (event.status === 'downloading') {
    progressHeading.textContent = 'Downloading Slides (Parallel)';
    progressSubHeading.textContent = `${event.unitName || ''} (${event.unitProgress || ''})`;
    currentUnitVal.textContent = event.unitName || '—';
    currentFileVal.textContent = event.currentFile || '—';
    progressPercent.textContent = `${event.percent || 0}%`;
    overallProgressBar.style.width = `${event.percent || 0}%`;
  } else if (event.status === 'converting') {
    currentFileVal.textContent = event.currentFile || 'Converting...';
  } else if (event.status === 'merging') {
    currentFileVal.textContent = event.message || 'Merging unit PDFs...';
  } else if (event.status === 'merged_complete') {
    currentFileVal.textContent = `Generated ${event.mergedFilename || ''}`;
  } else if (event.status === 'course_completed') {
    progressHeading.textContent = 'Processing Courses...';
    if (event.subject) progressSubHeading.textContent = event.subject;
    currentFileVal.textContent = event.currentFile || 'Course completed';
    progressPercent.textContent = `${event.percent || 0}%`;
    overallProgressBar.style.width = `${event.percent || 0}%`;
  } else if (event.status === 'completed') {
    progressSpinner.classList.add('hidden');
    startBtn.classList.remove('hidden');
    cancelBtn.classList.add('hidden');
    openFolderBtn.classList.remove('hidden');
    progressHeading.textContent = 'Completed!';
    progressSubHeading.textContent = 'All requested materials have been organized.';
    progressPercent.textContent = '100%';
    overallProgressBar.style.width = '100%';
    if (event.lastDownloadId) lastCompletedDownloadId = event.lastDownloadId;
    if (event.queueCleared) {
      downloadQueue = [];
      renderQueue();
    }
    if (event.summary) {
      showSummaryModal(event.summary);
    }
  } else if (event.status === 'cancelled') {
    progressSpinner.classList.add('hidden');
    startBtn.classList.remove('hidden');
    cancelBtn.classList.add('hidden');
    progressHeading.textContent = 'Cancelled';
    progressSubHeading.textContent = 'Processing was stopped safely.';
  } else if (event.status === 'failed') {
    progressSpinner.classList.add('hidden');
    startBtn.classList.remove('hidden');
    cancelBtn.classList.add('hidden');
    progressHeading.textContent = 'Failed';
    progressSubHeading.textContent = event.error || 'An error occurred during download.';
  }

  // Sync activity logs
  if (event.logs && Array.isArray(event.logs) && event.logs.length > 0) {
    logContent.innerHTML = '';
    event.logs.forEach(l => {
      const row = document.createElement('div');
      row.className = 'log-entry';
      row.innerHTML = `<span class="log-time">[${l.time}]</span> <span class="log-msg-${l.type || 'info'}">${l.message}</span>`;
      logContent.appendChild(row);
    });
    logContent.scrollTop = logContent.scrollHeight;
  }
}

// Runtime listener for background events
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'DOWNLOAD_PROGRESS') {
    handleProgressUpdate(request.data);
  }
});

// Start Download execution: delegates to persistent background worker
startBtn.addEventListener('click', async () => {
  const options = {
    downloadMode: downloadModeSelect ? downloadModeSelect.value : 'zip',
    mergeUnitPdfs: mergeUnitPdfsCheck.checked,
    saveIndividualFiles: saveIndividualCheck.checked
  };

  // If items exist in the Download List, execute queue batch download
  if (downloadQueue.length > 0) {
    startBtn.classList.add('hidden');
    cancelBtn.classList.remove('hidden');
    openFolderBtn.classList.add('hidden');
    progressSection.classList.remove('hidden');
    progressSpinner.classList.remove('hidden');
    progressHeading.textContent = 'Starting Download List...';
    progressSubHeading.textContent = `${downloadQueue.length} queued item(s)`;
    logContent.innerHTML = '';

    addLog(`Initiating download for ${downloadQueue.length} queued target(s)...`, 'info');

    chrome.runtime.sendMessage({
      action: 'START_QUEUE_DOWNLOAD',
      queue: downloadQueue,
      options
    }, (res) => {
      if (chrome.runtime.lastError || (res && !res.success)) {
        const rawErr = chrome.runtime.lastError?.message || res?.error || 'Failed to start queue download';
        if (rawErr.includes('message port closed') || rawErr.includes('Could not establish connection')) {
          addLog('⚠️ Background worker needs reload. Click the 🔄 button in the top right to reload and retry.', 'warn');
        } else {
          addLog(`Failed to start: ${rawErr}`, 'error');
        }
        startBtn.classList.remove('hidden');
        cancelBtn.classList.add('hidden');
        progressSpinner.classList.add('hidden');
      }
    });
    return;
  }

  // Otherwise, run single-selection download directly
  const isAllSubjects = processAllSubjectsCheck.checked;
  let targetSubjects = [];

  if (isAllSubjects) {
    targetSubjects = currentSubjects;
  } else {
    const selected = currentSubjects.find(s => s.id === subjectSelect.value);
    if (selected) targetSubjects = [selected];
  }

  if (targetSubjects.length === 0) {
    alert('Please select at least one course to download, or add items to the Download List.');
    return;
  }

  const selectedUnits = isAllSubjects ? null : getSelectedUnitNumbers();
  if (!isAllSubjects && (!selectedUnits || selectedUnits.length === 0)) {
    alert('Please select at least one unit to download.');
    return;
  }

  // Setup UI for running state
  startBtn.classList.add('hidden');
  cancelBtn.classList.remove('hidden');
  openFolderBtn.classList.add('hidden');
  progressSection.classList.remove('hidden');
  progressSpinner.classList.remove('hidden');
  progressHeading.textContent = 'Starting background download...';
  progressSubHeading.textContent = targetSubjects[0].displayName || targetSubjects[0].code;
  logContent.innerHTML = '';

  const semesterName = semesterSelect.options[semesterSelect.selectedIndex]?.text || 'Semester';
  const queueTitle = isAllSubjects 
    ? `All ${targetSubjects.length} Courses in ${semesterName}` 
    : (targetSubjects[0].displayName || targetSubjects[0].code);

  progressSubHeading.textContent = queueTitle;
  addLog(`Delegating ${queueTitle} to persistent background worker...`, 'info');

  chrome.runtime.sendMessage({
    action: 'START_DOWNLOAD',
    subjects: targetSubjects,
    isAllSubjects,
    semesterName,
    selectedUnits,
    options
  }, (res) => {
    if (chrome.runtime.lastError || (res && !res.success)) {
      const rawErr = chrome.runtime.lastError?.message || res?.error || 'Failed to start background download';
      if (rawErr.includes('message port closed') || rawErr.includes('Could not establish connection')) {
        addLog('⚠️ Background worker needs reload. Click the 🔄 button in the top right to reload and retry.', 'warn');
      } else {
        addLog(`Failed to start: ${rawErr}`, 'error');
      }
      startBtn.classList.remove('hidden');
      cancelBtn.classList.add('hidden');
      progressSpinner.classList.add('hidden');
    }
  });
});

// Cancel button: signals background worker to stop
cancelBtn.addEventListener('click', () => {
  cancelBtn.disabled = true;
  cancelBtn.textContent = 'Stopping...';
  addLog('⏹️ Stopping background download...', 'warn');

  chrome.runtime.sendMessage({ action: 'CANCEL_DOWNLOAD' }, () => {
    // Immediately update UI to stopped/cancelled state
    progressSpinner.classList.add('hidden');
    startBtn.classList.remove('hidden');
    cancelBtn.classList.add('hidden');
    cancelBtn.disabled = false;
    cancelBtn.innerHTML = '<span class="btn-icon">⏹️</span> Cancel / Stop';
    progressHeading.textContent = 'Cancelled';
    progressSubHeading.textContent = 'Processing was stopped safely.';
  });
});

// Open folder: executed with direct user gesture for reliable macOS Finder focus
function triggerOpenFolder() {
  const dId = (lastCompletedDownloadId && typeof lastCompletedDownloadId === 'number')
    ? lastCompletedDownloadId
    : null;

  if (typeof chrome !== 'undefined' && chrome.downloads) {
    if (dId) {
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
    } else {
      chrome.downloads.showDefaultFolder();
    }
  }

  // Also message background service worker
  try {
    chrome.runtime.sendMessage({
      action: 'OPEN_DOWNLOADS_FOLDER',
      downloadId: dId
    }, () => {
      if (chrome.runtime.lastError) {}
    });
  } catch (e) {}
}

openFolderBtn.addEventListener('click', triggerOpenFolder);
modalOpenFolderBtn.addEventListener('click', triggerOpenFolder);

// Summary Modal
function showSummaryModal(sum) {
  statUnits.textContent = sum.unitsFound;
  statFilesFound.textContent = sum.filesFound;
  statDownloaded.textContent = sum.filesDownloaded;
  statConverted.textContent = sum.pptxConverted;
  statMerged.textContent = sum.pdfsMerged;
  statFailed.textContent = sum.failed;

  if (sum.failed > 0 && sum.failedList.length > 0) {
    failedFilesSection.classList.remove('hidden');
    failedList.innerHTML = sum.failedList.map(item => `
      <div class="failed-item">
        <strong>${item.unit} — ${item.file}</strong>: ${item.reason}
      </div>
    `).join('');
  } else {
    failedFilesSection.classList.add('hidden');
  }

  const emptyUnitsNotice = document.getElementById('emptyUnitsNotice');
  const emptyUnitsList = document.getElementById('emptyUnitsList');
  if (sum.emptyUnits && sum.emptyUnits.length > 0 && emptyUnitsNotice && emptyUnitsList) {
    const uniqueEmpty = Array.from(new Set(sum.emptyUnits)).map(u => String(u).startsWith('Unit') || String(u).includes('Unit') ? String(u) : `Unit ${u}`);
    emptyUnitsList.textContent = uniqueEmpty.join(', ');
    emptyUnitsNotice.classList.remove('hidden');
  } else if (emptyUnitsNotice) {
    emptyUnitsNotice.classList.add('hidden');
  }

  summaryModal.classList.remove('hidden');
}

closeModalBtn.addEventListener('click', () => summaryModal.classList.add('hidden'));
modalDoneBtn.addEventListener('click', () => summaryModal.classList.add('hidden'));

// Initialize on popup load
init();
