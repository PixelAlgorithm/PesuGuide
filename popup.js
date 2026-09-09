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

const semesterSelect = document.getElementById('semesterSelect');
const subjectSelect = document.getElementById('subjectSelect');
const processAllSubjectsCheck = document.getElementById('processAllSubjectsCheck');
const unitsSection = document.getElementById('unitsSection');
const unitsContainer = document.getElementById('unitsContainer');
const selectAllUnits = document.getElementById('selectAllUnits');
const deselectAllUnits = document.getElementById('deselectAllUnits');

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

// Instances
const scraper = new PesuScraper();
let currentSubjects = [];
let lastCompletedDownloadId = null;

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
    } else if (state && state.status === 'completed' && state.completedAt && (Date.now() - state.completedAt < 60000)) {
      if (state.lastDownloadId) lastCompletedDownloadId = state.lastDownloadId;
      if (state.summary) {
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
  const isAllSubjects = processAllSubjectsCheck.checked;
  let targetSubjects = [];

  if (isAllSubjects) {
    targetSubjects = currentSubjects;
  } else {
    const selected = currentSubjects.find(s => s.id === subjectSelect.value);
    if (selected) targetSubjects = [selected];
  }

  if (targetSubjects.length === 0) {
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
  progressHeading.textContent = 'Starting background download...';
  progressSubHeading.textContent = targetSubjects[0].displayName || targetSubjects[0].code;
  logContent.innerHTML = '';

  const options = {
    downloadMode: downloadModeSelect ? downloadModeSelect.value : 'zip',
    mergeUnitPdfs: mergeUnitPdfsCheck.checked,
    saveIndividualFiles: saveIndividualCheck.checked
  };

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
      const err = chrome.runtime.lastError?.message || res?.error || 'Failed to start background download';
      addLog(`Failed to start: ${err}`, 'error');
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
  chrome.runtime.sendMessage({ action: 'CANCEL_DOWNLOAD' }, () => {
    addLog('Cancel signal dispatched to background worker.', 'warn');
    setTimeout(() => {
      cancelBtn.disabled = false;
      cancelBtn.innerHTML = '<span class="btn-icon">⏹️</span> Cancel / Stop';
    }, 1000);
  });
});

// Open folder
function triggerOpenFolder() {
  chrome.runtime.sendMessage({
    action: 'OPEN_DOWNLOADS_FOLDER',
    downloadId: lastCompletedDownloadId
  }, (res) => {
    if (chrome.runtime.lastError) {
      console.warn('Could not open downloads folder:', chrome.runtime.lastError.message);
    }
  });
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
