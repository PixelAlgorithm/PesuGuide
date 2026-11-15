/**
 * Popup UI Controller
 * Manages user interactions, course selection, unit filtering, live progress, and download actions.
 */
import { PesuScraper } from './src/pesu-scraper.js';
import { PptxConverter } from './src/pptx-converter.js';
import { checkForUpdate, getUpdateInfo, dismissUpdate, currentVersion, applyBadge } from './src/updater.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
const selectedUnitsBadge = document.getElementById('selectedUnitsBadge');
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
const mergeAllUnitsCheck = document.getElementById('mergeAllUnitsCheck');
const saveIndividualCheck = document.getElementById('saveIndividualCheck');
const includeSlidesCheck = document.getElementById('includeSlidesCheck');
const includeNotesCheck = document.getElementById('includeNotesCheck');

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
const statKept = document.getElementById('statKept');
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
  row.innerHTML = `<span class="log-time">${time}</span> <span class="log-msg-${esc(type)}">${esc(message)}</span>`;
  logContent.appendChild(row);
  logContent.scrollTop = logContent.scrollHeight;
}

// Modern Vector SVG Icons
const SVG_ICONS = {
  download: '<svg class="btn-svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>',
  stop: '<svg class="btn-svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect width="14" height="14" x="5" y="5" rx="2"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
};

// Check local converter
async function updateConverterStatus() {
  const status = await PptxConverter.checkLocalServer();
  if (status.available) {
    converterBadge.textContent = status.engine || 'Local converter';
    converterBadge.title = 'Local PowerPoint/LibreOffice converter active (High fidelity)';
  } else {
    converterBadge.textContent = 'Built-in converter';
    converterBadge.title = 'Using in-browser client-side PPTX converter';
  }
}

// Verify Login & Load Semesters
async function init() {
  connectionBadge.className = 'badge badge-warning';
  connectionBadge.innerHTML = '<span class="status-dot"></span> Checking';

  updateConverterStatus();

  const status = await scraper.checkLoginStatus();
  if (!status.loggedIn) {
    connectionBadge.className = 'badge badge-danger';
    connectionBadge.innerHTML = '<span class="status-dot"></span> Signed out';
    loginPromptCard.classList.remove('hidden');
    semesterSelect.innerHTML = '<option value="">Sign in to PESU Academy first</option>';
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
  checkForUpdates(false);
}

// Load Semesters
async function loadSemesters() {
  semesterSelect.disabled = true;
  semesterSelect.innerHTML = '<option value="" disabled selected>Loading…</option>';
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
    semesterSelect.innerHTML = `<option value="">${esc(err.message || 'Failed to load semesters')}</option>`;
    semesterSelect.disabled = true;
    addLog(`Failed to load semesters: ${err.message}`, 'error');
    if (err.message && (err.message.includes('Session expired') || err.message.includes('Sign in'))) {
      connectionBadge.className = 'badge badge-danger';
      connectionBadge.innerHTML = '<span class="status-dot"></span> Session expired';
      loginPromptCard.classList.remove('hidden');
    }
  }
}

// Load Subjects for selected semester
async function loadSubjects(semesterId) {
  if (!semesterId) return;
  subjectSelect.disabled = true;
  subjectSelect.innerHTML = '<option value="" disabled selected>Loading courses...</option>';
  unitsContainer.innerHTML = '<div class="empty-hint">Loading units…</div>';

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
    subjectSelect.innerHTML = `<option value="">${esc(err.message || 'Failed to load courses')}</option>`;
    unitsContainer.innerHTML = `<div class="empty-hint text-danger">${esc(err.message)}</div>`;
    addLog(`Failed to load courses: ${err.message}`, 'error');
    if (err.message && err.message.toLowerCase().includes('session')) {
      connectionBadge.className = 'badge badge-danger';
      connectionBadge.innerHTML = '<span class="status-dot"></span> Session expired';
      loginPromptCard.classList.remove('hidden');
    }
  }
}

// Load Units for selected subject
async function loadUnits(subjectId) {
  if (!subjectId) return;
  unitsContainer.innerHTML = '<div class="empty-hint">Loading units…</div>';

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
      const title = String(u.rawName || '').replace(/^Unit\s*\d+\s*[:\-–]?\s*/i, '').trim();
      item.innerHTML = `
        <label>
          <input type="checkbox" class="unit-checkbox" value="${esc(u.unitNumber)}" checked>
          <span class="check-box" aria-hidden="true"></span>
          <span class="unit-label">
            <span class="unit-no">Unit ${esc(u.unitNumber)}</span>
            <span class="unit-name">${esc(title || u.folderName)}</span>
          </span>
        </label>
      `;
      const cb = item.querySelector('.unit-checkbox');
      if (cb) cb.addEventListener('change', updateStartButtonState);
      unitsContainer.appendChild(item);
    });
    updateStartButtonState();
  } catch (err) {
    console.error('Failed to load units:', err);
    unitsContainer.innerHTML = `<div class="empty-hint text-danger">Couldn't load units: ${esc(err.message)}</div>`;
    updateStartButtonState();
  }
}

// Get selected unit numbers
function getSelectedUnitNumbers() {
  const checkboxes = document.querySelectorAll('.unit-checkbox:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.value, 10));
}

// Update dynamic label on Start Download button and unit selection badge
function updateStartButtonState() {
  if (!startBtn) return;
  const queueCount = downloadQueue.length;
  if (queueCount > 0) {
    startBtn.innerHTML = `${SVG_ICONS.download}<span>Download list · ${queueCount} ${queueCount === 1 ? 'course' : 'courses'}</span>`;
    if (selectedUnitsBadge) selectedUnitsBadge.classList.add('hidden');
    return;
  }

  const isAllSubjects = processAllSubjectsCheck && processAllSubjectsCheck.checked;
  if (isAllSubjects) {
    const totalCourses = currentSubjects ? currentSubjects.length : 0;
    startBtn.innerHTML = `${SVG_ICONS.download}<span>Download ${materialLabel()} · ${totalCourses} courses</span>`;
    if (selectedUnitsBadge) selectedUnitsBadge.classList.add('hidden');
    return;
  }

  const selectedUnits = getSelectedUnitNumbers();
  const allUnitCheckboxes = document.querySelectorAll('.unit-checkbox');
  const totalUnits = allUnitCheckboxes.length;

  if (selectedUnitsBadge) {
    if (totalUnits > 0) {
      selectedUnitsBadge.textContent = `${selectedUnits.length}/${totalUnits}`;
      selectedUnitsBadge.classList.remove('hidden');
    } else {
      selectedUnitsBadge.classList.add('hidden');
    }
  }

  if (totalUnits === 0) {
    startBtn.innerHTML = `${SVG_ICONS.download}<span>Start download</span>`;
  } else if (selectedUnits.length === 0) {
    startBtn.innerHTML = `${SVG_ICONS.download}<span>Select a unit</span>`;
  } else {
    const what = materialLabel();
    const count = selectedUnits.length === totalUnits ? 'all units' : `${selectedUnits.length} unit${selectedUnits.length === 1 ? '' : 's'}`;
    startBtn.innerHTML = `${SVG_ICONS.download}<span>Download ${what} · ${count}</span>`;
  }
}

function materialLabel() {
  const slides = !includeSlidesCheck || includeSlidesCheck.checked;
  const notes = includeNotesCheck && includeNotesCheck.checked;
  if (slides && notes) return 'slides + notes';
  if (notes) return 'notes';
  return 'slides';
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
    updateStartButtonState();
    return;
  }

  queueSection.classList.remove('hidden');
  updateStartButtonState();

  queueItemsContainer.innerHTML = '';
  downloadQueue.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'queue-item';
    row.innerHTML = `
      <div class="queue-item-info">
        <div class="queue-item-header">
          <span class="queue-sem-tag">${esc(item.semesterName || 'Sem')}</span>
          <span class="queue-item-title" title="${esc(item.title)}">${esc(item.title)}</span>
        </div>
        <div class="queue-item-detail">${esc(item.unitSummary)}</div>
      </div>
      <button type="button" class="queue-remove-btn" data-index="${index}" title="Remove from list">
        ${SVG_ICONS.trash}
      </button>
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
function showQueueFeedback(text = 'Added to list') {
  if (!queueAddFeedback) return;
  queueAddFeedback.innerHTML = `${SVG_ICONS.check}<span>${esc(text)}</span>`;
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
    const newItem = {
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
      downloadQueue[existingIndex] = newItem;
      showQueueFeedback('Updated in list');
    } else {
      // Remove any individual courses from this semester since user is adding the whole semester
      downloadQueue = downloadQueue.filter(q => !(q.semesterId === semesterId && !q.isAllSubjects));
      downloadQueue.push(newItem);
      renderQueue();
      showQueueFeedback(`Added ${semesterName} (${currentSubjects.length} courses)`);
    }

    saveQueue();
    return;
  }

  // Individual course selection
  const selectedCourse = currentSubjects.find(s => String(s.id) === String(subjectSelect.value)) || currentSubjects[0];
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
  const newItem = {
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
    downloadQueue[existingCourseIdx] = newItem;
    showQueueFeedback('Course updated in list');
  } else {
    downloadQueue.push(newItem);
    renderQueue();
    showQueueFeedback(`Added ${selectedCourse.code}`);
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
  updateStartButtonState();
});

selectAllUnits.addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelectorAll('.unit-checkbox').forEach(cb => cb.checked = true);
  updateStartButtonState();
});

deselectAllUnits.addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelectorAll('.unit-checkbox').forEach(cb => cb.checked = false);
  updateStartButtonState();
});

if (addToQueueBtn) addToQueueBtn.addEventListener('click', addToQueue);
if (clearQueueBtn) clearQueueBtn.addEventListener('click', clearQueue);

if (reloadExtBtn) {
  reloadExtBtn.addEventListener('click', () => {
    reloadExtBtn.classList.add('rotating');
    addLog('Reloading extension worker...', 'info');
    setTimeout(() => {
      if (chrome.runtime.reload) {
        chrome.runtime.reload();
      } else {
        location.reload();
      }
    }, 150);
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
    progressHeading.textContent = 'Finding files…';
    progressSubHeading.textContent = event.message || 'Scanning units and classes...';
  } else if (event.status === 'downloading') {
    progressHeading.textContent = 'Downloading';
    progressSubHeading.textContent = `${event.unitName || ''} (${event.unitProgress || ''})`;
    currentUnitVal.textContent = event.unitName || '—';
    currentFileVal.textContent = event.currentFile || '—';
    progressPercent.textContent = `${event.percent || 0}%`;
    overallProgressBar.style.width = `${event.percent || 0}%`;
    overallProgressBar.parentElement.setAttribute('aria-valuenow', String(event.percent || 0));
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
    overallProgressBar.parentElement.setAttribute('aria-valuenow', String(event.percent || 0));
  } else if (event.status === 'completed') {
    progressSpinner.classList.add('hidden');
    startBtn.classList.remove('hidden');
    cancelBtn.classList.add('hidden');
    openFolderBtn.classList.remove('hidden');
    progressHeading.textContent = 'Finished';
    progressSubHeading.textContent = 'Everything requested has been saved.';
    progressPercent.textContent = '100%';
    overallProgressBar.style.width = '100%';
    overallProgressBar.parentElement.setAttribute('aria-valuenow', '100');
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
      row.innerHTML = `<span class="log-time">${esc(l.time)}</span> <span class="log-msg-${esc(l.type || 'info')}">${esc(l.message)}</span>`;
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
    mergeUnitPdfs: mergeUnitPdfsCheck ? mergeUnitPdfsCheck.checked : true,
    mergeAllUnits: mergeAllUnitsCheck ? mergeAllUnitsCheck.checked : true,
    saveIndividualFiles: saveIndividualCheck ? saveIndividualCheck.checked : true,
    includeSlides: includeSlidesCheck ? includeSlidesCheck.checked : true,
    includeNotes: includeNotesCheck ? includeNotesCheck.checked : false
  };

  if (!options.includeSlides && !options.includeNotes) {
    addLog('Choose slides, notes, or both before downloading.', 'warn');
    progressSection.classList.remove('hidden');
    return;
  }
  persistPreferences();

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
          addLog('Background worker needs a reload. Use the reload button at the top right, then retry.', 'warn');
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

  // Otherwise, run single-selection download directly with selected units
  const isAllSubjects = processAllSubjectsCheck && processAllSubjectsCheck.checked;
  let targetSubjects = [];

  if (isAllSubjects) {
    targetSubjects = currentSubjects;
  } else {
    const selected = currentSubjects.find(s => String(s.id) === String(subjectSelect.value)) || currentSubjects[0];
    if (selected) targetSubjects = [selected];
  }

  if (!targetSubjects || targetSubjects.length === 0) {
    alert('Please select at least one course to download.');
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

  const semesterName = semesterSelect.options[semesterSelect.selectedIndex]?.text || 'Semester';
  const unitLabel = (!isAllSubjects && selectedUnits && selectedUnits.length > 0)
    ? `Units ${selectedUnits.join(', ')}`
    : 'All Units';
  const queueTitle = isAllSubjects 
    ? `All ${targetSubjects.length} Courses in ${semesterName}` 
    : `${targetSubjects[0].displayName || targetSubjects[0].code} (${unitLabel})`;

  progressHeading.textContent = `Downloading ${targetSubjects[0].code}...`;
  progressSubHeading.textContent = queueTitle;
  logContent.innerHTML = '';
  addLog(`Starting download for ${queueTitle}...`, 'info');

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
        addLog('Background worker needs a reload. Use the reload button at the top right, then retry.', 'warn');
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
  cancelBtn.innerHTML = `${SVG_ICONS.stop}<span>Stopping...</span>`;
  addLog('Stopping background download...', 'warn');

  chrome.runtime.sendMessage({ action: 'CANCEL_DOWNLOAD' }, () => {
    // Immediately update UI to stopped/cancelled state
    progressSpinner.classList.add('hidden');
    startBtn.classList.remove('hidden');
    cancelBtn.classList.add('hidden');
    cancelBtn.disabled = false;
    cancelBtn.innerHTML = `${SVG_ICONS.stop}<span>Cancel / Stop</span>`;
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
  const keptNotice = document.getElementById('keptOriginalNotice');
  if (keptNotice) {
    statKept.textContent = sum.keptOriginal || 0;
    keptNotice.classList.toggle('hidden', !(sum.keptOriginal > 0));
  }

  if (sum.failed > 0 && sum.failedList.length > 0) {
    failedFilesSection.classList.remove('hidden');
    failedList.innerHTML = sum.failedList.map(item => `
      <div class="failed-item">
        <strong>${esc(item.unit)} · ${esc(item.file)}</strong><br>${esc(item.reason)}
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

// ───────── Updates ─────────
// The service worker checks GitHub every few hours and caches the result, so
// the popup can render instantly from storage and only hits the network when
// the user asks (or the cache is stale).
const updateBanner = document.getElementById('updateBanner');
const updateVersionStr = document.getElementById('updateVersionStr');
const updateNotes = document.getElementById('updateNotes');
const downloadUpdateBtn = document.getElementById('downloadUpdateBtn');
const dismissUpdateBtn = document.getElementById('dismissUpdateBtn');
const updateStatus = document.getElementById('updateStatus');
const checkUpdateBtn = document.getElementById('checkUpdateBtn');
const versionTag = document.getElementById('versionTag');
let latestInfo = null;

function timeAgo(ts) {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} h ago` : `${Math.round(hrs / 24)} d ago`;
}

async function renderUpdateState(errorMsg) {
  const { info, available, dismissed } = await getUpdateInfo();
  latestInfo = info;
  const mine = `v${currentVersion()}`;

  if (available && info) {
    updateStatus.textContent = `${info.tag} available`;
    updateStatus.classList.add('is-new');
    updateVersionStr.textContent = info.tag;
    const firstLine = (info.notes || '').split('\n').filter(l => !/^\s*#/.test(l)).map(l => l.replace(/^[*\-\s]+/, '').trim()).find(Boolean);
    updateNotes.textContent = firstLine || `You are on ${mine}.`;
    updateBanner.classList.toggle('hidden', !!dismissed);
  } else {
    updateStatus.classList.remove('is-new');
    updateStatus.textContent = errorMsg
      ? `Couldn't check (${errorMsg})`
      : `${mine} · up to date · checked ${timeAgo(info?.checkedAt)}`;
    updateBanner.classList.add('hidden');
  }
}

async function checkForUpdates(force = false) {
  if (checkUpdateBtn) { checkUpdateBtn.disabled = true; checkUpdateBtn.textContent = 'Checking…'; }
  const result = await checkForUpdate({ force });
  await applyBadge();
  await renderUpdateState(result.ok ? null : result.error);
  if (checkUpdateBtn) { checkUpdateBtn.disabled = false; checkUpdateBtn.textContent = 'Check now'; }
}

if (versionTag) versionTag.textContent = `v${currentVersion()}`;
if (checkUpdateBtn) checkUpdateBtn.addEventListener('click', () => checkForUpdates(true));

if (dismissUpdateBtn) {
  dismissUpdateBtn.addEventListener('click', async () => {
    if (latestInfo) await dismissUpdate(latestInfo.version);
    await applyBadge();
    updateBanner.classList.add('hidden');
  });
}

if (downloadUpdateBtn) {
  downloadUpdateBtn.addEventListener('click', () => {
    if (!latestInfo) return;
    const openRelease = () => chrome.tabs.create({ url: latestInfo.htmlUrl });
    if (latestInfo.zipUrl && chrome.downloads) {
      downloadUpdateBtn.disabled = true;
      downloadUpdateBtn.textContent = 'Downloading…';
      chrome.downloads.download({ url: latestInfo.zipUrl, filename: latestInfo.zipName, saveAs: false }, () => {
        downloadUpdateBtn.textContent = 'Downloaded';
        updateNotes.textContent = 'Unzip it over your PesUGuide folder, then reload the extension.';
        setTimeout(() => {
          downloadUpdateBtn.textContent = 'Release page';
          downloadUpdateBtn.disabled = false;
          downloadUpdateBtn.onclick = openRelease;
        }, 1800);
      });
    } else {
      openRelease();
    }
  });
}

// ───────── Preferences ─────────
const PREF_KEY = 'pesu_prefs';
function persistPreferences() {
  chrome.storage.local.set({
    [PREF_KEY]: {
      includeSlides: includeSlidesCheck.checked,
      includeNotes: includeNotesCheck.checked,
      downloadMode: downloadModeSelect.value,
      mergeUnitPdfs: mergeUnitPdfsCheck.checked,
      mergeAllUnits: mergeAllUnitsCheck.checked,
      saveIndividual: saveIndividualCheck.checked
    }
  });
}

async function restorePreferences() {
  const prefs = (await chrome.storage.local.get(PREF_KEY))[PREF_KEY];
  if (!prefs) return;
  includeSlidesCheck.checked = prefs.includeSlides !== false;
  includeNotesCheck.checked = prefs.includeNotes === true;
  if (prefs.downloadMode) downloadModeSelect.value = prefs.downloadMode;
  mergeUnitPdfsCheck.checked = prefs.mergeUnitPdfs !== false;
  mergeAllUnitsCheck.checked = prefs.mergeAllUnits !== false;
  saveIndividualCheck.checked = prefs.saveIndividual !== false;
  updateStartButtonState();
}

[includeSlidesCheck, includeNotesCheck, downloadModeSelect, mergeUnitPdfsCheck, mergeAllUnitsCheck, saveIndividualCheck]
  .forEach(el => el && el.addEventListener('change', () => { persistPreferences(); updateStartButtonState(); }));

restorePreferences();
renderUpdateState();

// Initialize on popup load
init();

// Open external links reliably in a new Chrome tab
document.querySelectorAll('a[href^="http"]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: link.href });
    } else {
      window.open(link.href, '_blank');
    }
  });
});
