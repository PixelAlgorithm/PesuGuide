/**
 * Popup UI Controller
 * Manages user interactions, course selection, unit filtering, live progress, and download actions.
 */
import { PesuScraper } from './src/pesu-scraper.js';
import { CourseOrchestrator } from './src/orchestrator.js';
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
let orchestrator = null;
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

// Start Download execution
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
  logContent.innerHTML = '';

  orchestrator = new CourseOrchestrator();
  const options = {
    downloadMode: downloadModeSelect ? downloadModeSelect.value : 'zip',
    mergeUnitPdfs: mergeUnitPdfsCheck.checked,
    saveIndividualFiles: saveIndividualCheck.checked
  };

  addLog(`Starting processing for ${targetSubjects.length} course(s)...`, 'info');

  const aggregatedSummary = {
    subject: isAllSubjects ? `${semesterSelect.options[semesterSelect.selectedIndex]?.text} (All Courses)` : targetSubjects[0].displayName,
    unitsFound: 0,
    filesFound: 0,
    filesDownloaded: 0,
    pptxConverted: 0,
    pdfsMerged: 0,
    failed: 0,
    failedList: []
  };

  for (let sIdx = 0; sIdx < targetSubjects.length; sIdx++) {
    if (orchestrator.isCancelled) break;

    const sub = targetSubjects[sIdx];
    progressHeading.textContent = `Course ${sIdx + 1} of ${targetSubjects.length}: ${sub.code}`;
    progressSubHeading.textContent = sub.title;
    addLog(`>>> Processing ${sub.code} - ${sub.title}`, 'info');

    try {
      const summary = await orchestrator.processSubject(sub, selectedUnits, options, (event) => {
        if (event.status === 'downloading') {
          progressSubHeading.textContent = `Unit: ${event.unitName} (${event.unitProgress})`;
          currentUnitVal.textContent = event.unitName;
          currentFileVal.textContent = event.currentFile;
          progressPercent.textContent = `${event.percent}%`;
          overallProgressBar.style.width = `${event.percent}%`;
          addLog(`Downloaded: ${event.currentFile}`, 'info');
        } else if (event.status === 'converting') {
          currentFileVal.textContent = `Converting ${event.currentFile}...`;
          addLog(`Converting presentation: ${event.currentFile}`, 'warn');
        } else if (event.status === 'merging') {
          currentFileVal.textContent = event.message;
          addLog(event.message, 'info');
        } else if (event.status === 'merged_complete') {
          currentFileVal.textContent = `Generated ${event.mergedFilename}`;
          addLog(`✅ Merged PDF saved: ${event.mergedFilename}`, 'info');
        } else if (event.status === 'unit_empty') {
          addLog(event.message, 'warn');
        } else if (event.status === 'completed') {
          if (event.lastDownloadId) lastCompletedDownloadId = event.lastDownloadId;
        }
      });

      aggregatedSummary.unitsFound += summary.unitsFound;
      aggregatedSummary.filesFound += summary.filesFound;
      aggregatedSummary.filesDownloaded += summary.filesDownloaded;
      aggregatedSummary.pptxConverted += summary.pptxConverted;
      aggregatedSummary.pdfsMerged += summary.pdfsMerged;
      aggregatedSummary.failed += summary.failed;
      aggregatedSummary.failedList.push(...summary.failedList);
      if (summary.emptyUnits) {
        aggregatedSummary.emptyUnits = aggregatedSummary.emptyUnits || [];
        aggregatedSummary.emptyUnits.push(...summary.emptyUnits);
      }

    } catch (err) {
      console.error(`Failed processing subject ${sub.code}:`, err);
      addLog(`Error processing ${sub.code}: ${err.message}`, 'error');
    }
  }

  // Finished or Cancelled
  progressSpinner.classList.add('hidden');
  startBtn.classList.remove('hidden');
  cancelBtn.classList.add('hidden');
  openFolderBtn.classList.remove('hidden');

  if (orchestrator.isCancelled) {
    progressHeading.textContent = 'Cancelled';
    progressSubHeading.textContent = 'Processing was stopped safely.';
    addLog('Process was cancelled by user.', 'warn');
  } else {
    progressHeading.textContent = 'Completed!';
    progressSubHeading.textContent = 'All requested materials have been organized.';
    progressPercent.textContent = '100%';
    overallProgressBar.style.width = '100%';
    addLog('All files downloaded and merged successfully!', 'info');
  }

  // Show summary modal
  showSummaryModal(aggregatedSummary);
});

// Cancel button
cancelBtn.addEventListener('click', () => {
  if (orchestrator) {
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Stopping...';
    orchestrator.cancel();
    addLog('Stopping queue safely...', 'warn');
  }
});

// Open folder
function triggerOpenFolder() {
  chrome.runtime.sendMessage({
    action: 'OPEN_DOWNLOADS_FOLDER',
    downloadId: lastCompletedDownloadId
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
    const uniqueEmpty = Array.from(new Set(sum.emptyUnits)).sort((a, b) => a - b);
    emptyUnitsList.textContent = `Unit ${uniqueEmpty.join(', Unit ')}`;
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
