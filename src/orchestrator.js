/**
 * PESU Course Materials Orchestrator
 * Coordinates discovery, download, conversion, merging, and file organization.
 * Supports packaging into a single clean ZIP or direct folder downloads.
 */
import { CONFIG } from './config.js';
import { PesuScraper } from './pesu-scraper.js';
import { PptxConverter } from './pptx-converter.js';
import { PdfMerger } from './pdf-merger.js';

/**
 * Formats subject title or code into a clean, readable slug
 * e.g. "Machine Learning" -> "machine_learning"
 * e.g. "UE20CS301 - Machine Learning" -> "machine_learning"
 * e.g. "CS301" -> "cs301"
 */
export function formatSubjectSlug(subject) {
  if (!subject) return 'subject';

  let name = (subject.title || '').trim();
  if (!name && subject.displayName) {
    const parts = subject.displayName.split(/\s*-\s*/);
    name = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
  }
  if (!name && subject.code) {
    name = subject.code;
  }

  // Remove parenthesized or bracketed qualifiers like (Theory), [Lab], (Elective 1)
  name = name.replace(/\([^)]*\)|\[[^\]]*\]/g, '');

  // Convert non-alphanumeric chars to spaces so words remain distinct
  name = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim();

  // Convert spaces to single underscores and lowercase
  name = name.toLowerCase().replace(/\s+/g, '_').replace(/^_+|_+$/g, '');

  // Fallback to cleaned code or 'subject' if empty
  if (!name) {
    name = (subject.code || 'subject')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  return name || 'subject';
}

/**
 * Formats slide title into a clean slug, omitting gibberish UUIDs/hashes
 * e.g. "Decision Trees" -> "decision_trees"
 * e.g. "d65d3b19-af80-482f-8703-a12848c9099c" -> "" (clean omission)
 */
export function formatSlideSlug(title) {
  if (!title) return '';
  let clean = title.trim();

  // Strip common file extensions
  clean = clean.replace(/\.(pdf|pptx|ppt|txt|bin|docx)$/i, '');

  // Detect UUIDs, hex hashes, long numeric ids, or generic placeholder names
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);
  const isHexHash = /^[0-9a-f]{16,}$/i.test(clean);
  const isNumericId = /^\d{6,}$/.test(clean);
  const isGeneric = /^(slide|document|download|file|presentation)[\s_\-\d]*$/i.test(clean);

  if (isUuid || isHexHash || isNumericId || isGeneric) {
    return '';
  }

  clean = clean.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  clean = clean.toLowerCase().replace(/\s+/g, '_').replace(/^_+|_+$/g, '');

  // Limit length to keep filenames concise
  if (clean.length > 50) {
    clean = clean.substring(0, 50).replace(/_+$/, '');
  }

  return clean;
}

/**
 * Formats ZIP filename in the format: subjectname_units-x,x,x.zip
 * e.g., "software_engineering_units-1,2.zip"
 * e.g., "software_engineering_units-1,2,3,4.zip"
 */
export function formatZipFilename(subjectSlug, downloadedUnits, selectedUnitNumbers = null) {
  let unitNums = [];
  if (downloadedUnits && downloadedUnits.length > 0) {
    unitNums = downloadedUnits.map(u => (typeof u === 'object' ? u.unitNumber : u));
  } else if (selectedUnitNumbers && selectedUnitNumbers.length > 0) {
    unitNums = selectedUnitNumbers;
  }

  unitNums = Array.from(new Set(unitNums)).sort((a, b) => a - b);

  if (unitNums.length > 0) {
    return `${subjectSlug}_units-${unitNums.join(',')}.zip`;
  }
  return `${subjectSlug}_units.zip`;
}

export class CourseOrchestrator {
  constructor() {
    this.scraper = new PesuScraper();
    this.isCancelled = false;
    this.completedFiles = new Set();
    this.summary = {
      subject: '',
      unitsFound: 0,
      filesFound: 0,
      filesDownloaded: 0,
      pptxConverted: 0,
      pdfsMerged: 0,
      emptyUnits: [],
      failed: 0,
      failedList: []
    };
  }

  /**
   * Stop processing cleanly
   */
  cancel() {
    this.isCancelled = true;
  }

  /**
   * Load history of previously downloaded files for idempotency
   */
  async loadHistory(subjectKey) {
    try {
      const data = await chrome.storage.local.get(`pesu_history_${subjectKey}`);
      const list = data[`pesu_history_${subjectKey}`] || [];
      this.completedFiles = new Set(list);
    } catch {
      this.completedFiles = new Set();
    }
  }

  /**
   * Record a completed file for idempotency
   */
  async saveCompletedFile(subjectKey, docId) {
    this.completedFiles.add(docId);
    try {
      await chrome.storage.local.set({
        [`pesu_history_${subjectKey}`]: Array.from(this.completedFiles)
      });
    } catch (e) {
      console.warn('Could not persist download history:', e);
    }
  }

  /**
   * Triggers file download in Chrome with explicit MIME type, File object, and path
   */
  async triggerChromeDownload(blob, filepath) {
    const mimeType = filepath.endsWith('.zip') ? 'application/zip' : 'application/pdf';
    let fileBlob = blob;
    if (!(blob instanceof Blob)) {
      fileBlob = new Blob([blob], { type: mimeType });
    }

    const basename = filepath.split(/[\\/]/).pop();

    // Notify background script of the pending download filename so onDeterminingFilename enforces it
    try {
      await chrome.runtime.sendMessage({
        action: 'SET_PENDING_DOWNLOAD_NAME',
        filename: basename
      });
    } catch {}

    let fileObj;
    try {
      fileObj = new File([fileBlob], basename, { type: mimeType });
    } catch {
      fileObj = fileBlob;
    }

    const url = URL.createObjectURL(fileObj);

    // 1. Primary: HTML5 Anchor Tag Download
    // In Blink/Chromium, <a download="filename"> directly supplies the filename
    // to the native OS Save As dialog and Downloads manager, avoiding blob UUID fallback.
    if (typeof document !== 'undefined' && document.body) {
      const a = document.createElement('a');
      a.href = url;
      a.download = basename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      // Clean up after download intent has been handled
      setTimeout(() => {
        try { document.body.removeChild(a); } catch {}
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }, 1000);

      return Promise.resolve(Date.now());
    }

    // 2. Fallback: chrome.downloads.download
    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: url,
        filename: basename,
        conflictAction: 'uniquify',
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          URL.revokeObjectURL(url);
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          const listener = (delta) => {
            if (delta.id === downloadId) {
              if (delta.state && delta.state.current === 'complete') {
                chrome.downloads.onChanged.removeListener(listener);
                setTimeout(() => URL.revokeObjectURL(url), 10000);
                resolve(downloadId);
              } else if (delta.error) {
                chrome.downloads.onChanged.removeListener(listener);
                URL.revokeObjectURL(url);
                reject(new Error(`Download failed: ${delta.error.current}`));
              }
            }
          };
          chrome.downloads.onChanged.addListener(listener);
        }
      });
    });
  }

  /**
   * Sanitize string for filesystem directory and file names
   */
  sanitizeName(name) {
    return name
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Fetches file buffer from PESU Academy slide download URL
   */
  async fetchFileBuffer(url, retries = CONFIG.DOWNLOADS.RETRY_ATTEMPTS) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise(r => setTimeout(r, CONFIG.DOWNLOADS.RETRY_DELAY_MS * attempt));
      }
    }
  }

  /**
   * Main execution function for a subject
   */
  async processSubject(subject, selectedUnitNumbers = null, options = {}, onProgress = null) {
    this.isCancelled = false;
    const subjectSlug = formatSubjectSlug(subject);
    const subjectFolder = this.sanitizeName(subject.displayName || `${subject.code} - ${subject.title}`);
    const subjectKey = subject.id;
    await this.loadHistory(subjectKey);

    const isZipMode = options.downloadMode === 'zip' || options.downloadMode === undefined;
    const zip = (isZipMode && window.JSZip) ? new window.JSZip() : null;

    this.summary = {
      subject: subject.displayName,
      unitsFound: 0,
      filesFound: 0,
      filesDownloaded: 0,
      pptxConverted: 0,
      pdfsMerged: 0,
      failed: 0,
      failedList: []
    };

    if (onProgress) {
      onProgress({
        status: 'scanning',
        message: `Discovering units and slide materials for ${subject.displayName}...`
      });
    }

    const scanResult = await this.scraper.scanSubjectSlides(subject.id, selectedUnitNumbers, onProgress);
    const units = scanResult.units;

    this.summary.unitsFound = units.length;
    this.summary.filesFound = scanResult.totalFiles;

    let overallFileIndex = 0;
    let lastDownloadId = null;

    for (let uIdx = 0; uIdx < units.length; uIdx++) {
      if (this.isCancelled) {
        if (onProgress) onProgress({ status: 'cancelled', message: 'Download safely cancelled by user.' });
        break;
      }

      const unit = units[uIdx];
      const unitNumber = unit.unitNumber;
      const unitFolderName = `unit_${unitNumber}`;
      const files = unit.files;
      const unitPdfBuffers = [];

      if (files.length === 0) {
        this.summary.emptyUnits = this.summary.emptyUnits || [];
        this.summary.emptyUnits.push(unitNumber);
        if (onProgress) {
          onProgress({
            status: 'unit_empty',
            unitNumber: unitNumber,
            unitName: `Unit ${unitNumber}`,
            message: `⚠️ Unit ${unitNumber}: No slides uploaded on PESU Academy (Skipping empty unit).`
          });
        }
        continue;
      }

      for (let fIdx = 0; fIdx < files.length; fIdx++) {
        if (this.isCancelled) break;

        const file = files[fIdx];
        overallFileIndex++;
        const slideIndexPadded = String(fIdx + 1).padStart(2, '0');
        const slideSlug = formatSlideSlug(file.title);

        // Clean slide PDF name: subjectname_unit_x_slide_01.pdf
        const slidePdfFilename = slideSlug
          ? `${subjectSlug}_unit_${unitNumber}_slide_${slideIndexPadded}_${slideSlug}.pdf`
          : `${subjectSlug}_unit_${unitNumber}_slide_${slideIndexPadded}.pdf`;

        const displayTitle = slideSlug 
          ? `Slide ${slideIndexPadded} (${slideSlug.replace(/_/g, ' ')})`
          : `Slide ${slideIndexPadded}`;

        if (onProgress) {
          onProgress({
            status: 'downloading',
            unitName: `Unit ${unitNumber}`,
            unitProgress: `${fIdx + 1} / ${files.length}`,
            overallProgress: `${overallFileIndex} / ${scanResult.totalFiles}`,
            currentFile: displayTitle,
            percent: Math.round((overallFileIndex / scanResult.totalFiles) * 100)
          });
        }

        try {
          const fileBytes = await this.fetchFileBuffer(file.fullUrl);
          const detectedType = PptxConverter.detectFormat(fileBytes);

          let finalPdfBytes = null;

          if (detectedType === 'pdf') {
            finalPdfBytes = fileBytes;
          } else if (detectedType === 'pptx' || detectedType === 'ppt') {
            if (onProgress) {
              onProgress({
                status: 'converting',
                unitName: `Unit ${unitNumber}`,
                currentFile: `${displayTitle} (${detectedType.toUpperCase()} -> PDF)`
              });
            }
            finalPdfBytes = await PptxConverter.convertToPdf(fileBytes, `${slidePdfFilename.replace('.pdf', '')}.${detectedType}`, onProgress);
            this.summary.pptxConverted++;
          } else {
            // Check if bytes start with %PDF despite detection
            const headerStr = String.fromCharCode(...fileBytes.slice(0, 10));
            if (headerStr.includes('%PDF')) {
              finalPdfBytes = fileBytes;
            } else {
              finalPdfBytes = fileBytes;
            }
          }

          // If ZIP mode: add individual slide to ZIP folder
          if (zip && options.saveIndividualFiles !== false) {
            zip.file(`slides/${unitFolderName}/${slidePdfFilename}`, finalPdfBytes);
          } else if (!zip && options.saveIndividualFiles !== false && options.downloadMode !== 'merged_only') {
            // Direct download with clean readable filename
            const relativePath = `${CONFIG.DOWNLOADS.ROOT_FOLDER}/${subjectSlug}/${unitFolderName}/${slidePdfFilename}`;
            const blob = new Blob([finalPdfBytes], { type: 'application/pdf' });
            lastDownloadId = await this.triggerChromeDownload(blob, relativePath);
          }

          if (finalPdfBytes) {
            unitPdfBuffers.push({
              buffer: finalPdfBytes,
              title: displayTitle,
              filename: slidePdfFilename
            });
          }

          this.summary.filesDownloaded++;
          await this.saveCompletedFile(subjectKey, file.docId);

        } catch (err) {
          console.error(`Error processing file ${displayTitle}:`, err);
          this.summary.failed++;
          this.summary.failedList.push({
            unit: `Unit ${unitNumber}`,
            file: displayTitle,
            reason: err.message
          });
        }
      }

      // Merge unit PDFs into readable subjectname_unit_x.pdf format
      if (!this.isCancelled && unitPdfBuffers.length > 0 && options.mergeUnitPdfs !== false) {
        const mergedFilename = `${subjectSlug}_unit_${unitNumber}.pdf`;

        if (onProgress) {
          onProgress({
            status: 'merging',
            unitName: `Unit ${unitNumber}`,
            message: `Merging ${unitPdfBuffers.length} slides into ${mergedFilename}...`
          });
        }

        try {
          const mergeResult = await PdfMerger.mergePdfs(
            unitPdfBuffers,
            `${subject.displayName} - Unit ${unitNumber}`,
            (p) => {
              if (onProgress) {
                onProgress({
                  status: 'merging',
                  unitName: `Unit ${unitNumber}`,
                  message: `Merging page ${p.index} of ${p.total} for ${mergedFilename}... (${p.percent}%)`
                });
              }
            }
          );

          // If ZIP mode: place merged unit PDF right at the root of the ZIP
          if (zip) {
            zip.file(mergedFilename, mergeResult.bytes);
          } else {
            // Direct or merged_only mode:
            // Download as subjectname_unit_x.pdf
            const mergedPath = (options.downloadMode === 'merged_only')
              ? `${CONFIG.DOWNLOADS.ROOT_FOLDER}/${mergedFilename}`
              : `${CONFIG.DOWNLOADS.ROOT_FOLDER}/${subjectSlug}/${mergedFilename}`;

            const mergedBlob = new Blob([mergeResult.bytes], { type: 'application/pdf' });
            lastDownloadId = await this.triggerChromeDownload(mergedBlob, mergedPath);
          }

          this.summary.pdfsMerged++;

          if (onProgress) {
            onProgress({
              status: 'merged_complete',
              unitName: `Unit ${unitNumber}`,
              mergedFilename,
              message: `Saved ${mergedFilename}`
            });
          }

        } catch (err) {
          console.error(`Error merging unit PDF for ${mergedFilename}:`, err);
          this.summary.failedList.push({
            unit: `Unit ${unitNumber}`,
            file: mergedFilename,
            reason: `Merge failed: ${err.message}`
          });
        }
      }
    }

    // If ZIP mode and processing completed, trigger single clean ZIP download
    if (zip && !this.isCancelled && this.summary.filesDownloaded > 0) {
      const downloadedUnits = units.filter(u => u.files && u.files.length > 0);
      const zipFilename = formatZipFilename(subjectSlug, downloadedUnits, selectedUnitNumbers);

      if (onProgress) {
        onProgress({
          status: 'merging',
          unitName: 'All Units',
          message: `Packaging organized materials into ${zipFilename}...`
        });
      }

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      lastDownloadId = await this.triggerChromeDownload(zipBlob, zipFilename);
    }

    if (onProgress) {
      onProgress({
        status: this.isCancelled ? 'cancelled' : 'completed',
        summary: this.summary,
        lastDownloadId
      });
    }

    return this.summary;
  }
}
