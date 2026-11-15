/**
 * PESU Course Materials Orchestrator
 * Coordinates discovery, download, conversion, merging, and file organization.
 * Supports packaging into a single clean ZIP or direct folder downloads.
 */
import { CONFIG } from './config.js';
import { PesuScraper } from './pesu-scraper.js';
import { PptxConverter } from './pptx-converter.js';
import { PdfMerger } from './pdf-merger.js';
import { saveBlobToDB, deleteBlobFromDB } from './idb-helper.js';
import { ensureOffscreenDocument } from './offscreen-client.js';
import { sniffType, decodeText, extractNextUrl, normalizeShareUrl, guessExt, guessBaseName } from './file-resolver.js';

// Material kinds PesuGuide can fetch. `contentType` is PESU Academy's tab id.
export const MATERIAL_KINDS = {
  slides: { key: 'slides', contentType: 2, label: 'Slide', plural: 'slides', folder: 'slides', filePart: 'slide', mergedSuffix: '' },
  notes: { key: 'notes', contentType: 3, label: 'Note', plural: 'notes', folder: 'notes', filePart: 'note', mergedSuffix: '_notes' }
};

// Global registry tracking clean target filenames across all download contexts
export const pendingFilenameMap = new Map();
export const pendingFilenameQueue = [];

export function registerDownloadFilename(url, filename) {
  if (!filename) return;
  const safeName = filename.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (url) {
    pendingFilenameMap.set(url, safeName);
  }
  pendingFilenameQueue.push(safeName);
  if (pendingFilenameQueue.length > 50) {
    pendingFilenameQueue.shift();
  }
}

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

/**
 * Concurrently processes an array of items with a maximum concurrency limit
 */
export async function asyncPool(concurrency, items, iteratorFn) {
  const ret = [];
  const executing = new Set();
  for (const [index, item] of items.entries()) {
    const p = Promise.resolve().then(() => iteratorFn(item, index));
    ret.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  return Promise.all(ret);
}

const MIME_BY_EXT = {
  pdf: 'application/pdf', zip: 'application/zip',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif'
};

export function mimeForPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

export class CourseOrchestrator {
  constructor() {
    this.scraper = new PesuScraper({ keepAlive: true });
    this.isCancelled = false;
    this.summary = {
      unitsFound: 0,
      filesFound: 0,
      filesDownloaded: 0,
      pptxConverted: 0,
      pdfsMerged: 0,
      failed: 0,
      failedList: [],
      emptyUnits: []
    };
    this.completedFiles = new Set();
    this.abortController = null;
    this.currentTargetFilename = null;
    this.pesuQueue = Promise.resolve();
  }

  /**
   * Stop processing cleanly and immediately abort active fetches
   */
  cancel() {
    this.isCancelled = true;
    if (this.abortController) {
      try { this.abortController.abort(); } catch {}
    }
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
   * Triggers file download in Chrome with explicit MIME type, File object, and path.
   * Utilizes an Offscreen Document with IndexedDB to pass blobs with ZERO memory copy,
   * completely eliminating giant base64 data URLs, CPU lockups, and browser crashes.
   */
  async triggerChromeDownload(blob, filepath) {
    if (this.isCancelled) return null;

    const mimeType = mimeForPath(filepath);
    const basename = filepath.split(/[\\/]/).pop();
    const fileBlob = (blob instanceof Blob) ? blob : new Blob([blob], { type: mimeType });

    this.currentTargetFilename = filepath;
    registerDownloadFilename(null, filepath);

    // 1. Direct DOM context (Popup or Window)
    if (typeof document !== 'undefined' && document.body && typeof URL !== 'undefined' && URL.createObjectURL) {
      const url = URL.createObjectURL(fileBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = basename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        try { document.body.removeChild(a); } catch {}
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }, 1000);

      return Promise.resolve(Date.now());
    }

    // 2. Service Worker context: Attempt zero-copy Offscreen Document download first
    try {
      const hasOffscreen = await ensureOffscreenDocument();
      if (hasOffscreen) {
        const key = `dl_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        await saveBlobToDB(key, fileBlob);

        // Create zero-copy blob: URL in offscreen document
        const blobUrl = await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            deleteBlobFromDB(key).catch(() => {});
            reject(new Error('Offscreen blob URL creation timed out (8s)'));
          }, 8000);

          chrome.runtime.sendMessage({
            action: 'OFFSCREEN_CREATE_BLOB_URL',
            key,
            mimeType
          }, (res) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
              deleteBlobFromDB(key).catch(() => {});
              return reject(new Error(chrome.runtime.lastError.message));
            }
            if (res && res.success && res.url) {
              resolve(res.url);
            } else {
              deleteBlobFromDB(key).catch(() => {});
              reject(new Error(res?.error || 'Failed to create blob URL in offscreen worker'));
            }
          });
        });

        // Register blobUrl with desired filename in both local registry and background
        registerDownloadFilename(blobUrl, filepath);

        // Download natively via chrome.downloads in the Service Worker where the API is available
        return await new Promise((resolve, reject) => {
          chrome.downloads.download({
            url: blobUrl,
            filename: basename,
            conflictAction: 'uniquify',
            saveAs: false
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              chrome.runtime.sendMessage({ action: 'OFFSCREEN_REVOKE_BLOB_URL', url: blobUrl, key }).catch(() => {});
              return reject(new Error(chrome.runtime.lastError.message));
            }

            if (!downloadId) {
              chrome.runtime.sendMessage({ action: 'OFFSCREEN_REVOKE_BLOB_URL', url: blobUrl, key }).catch(() => {});
              return resolve(null);
            }

            let finished = false;
            const cleanup = () => {
              if (finished) return;
              finished = true;
              try { chrome.downloads.onChanged.removeListener(onChangedListener); } catch {}
              clearTimeout(fallbackTimer);
              setTimeout(() => {
                chrome.runtime.sendMessage({ action: 'OFFSCREEN_REVOKE_BLOB_URL', url: blobUrl, key }).catch(() => {});
              }, 10000);
              resolve(downloadId);
            };

            const onChangedListener = (delta) => {
              if (delta.id === downloadId && delta.state) {
                if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
                  cleanup();
                }
              }
            };

            chrome.downloads.onChanged.addListener(onChangedListener);

            chrome.downloads.search({ id: downloadId }, (items) => {
              if (items && items[0] && (items[0].state === 'complete' || items[0].state === 'interrupted')) {
                cleanup();
              }
            });

            // Safety fallback timeout
            const fallbackTimer = setTimeout(cleanup, 60000);
          });
        });
      }
    } catch (offscreenErr) {
      console.warn('Offscreen document download failed, seamlessly falling back to Data URL download:', offscreenErr);
    }

    // 3. Fallback: Ultra-reliable Data URL download directly in Service Worker
    let dataUrl = '';
    if (typeof FileReader !== 'undefined') {
      dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onloadend = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(fileBlob);
      });
    } else {
      const arrayBuffer = await fileBlob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunk = 32768;
      for (let i = 0; i < uint8.length; i += chunk) {
        binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunk));
      }
      dataUrl = `data:${mimeType};base64,${btoa(binary)}`;
    }

    registerDownloadFilename(dataUrl, filepath);

    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: dataUrl,
        filename: basename,
        conflictAction: 'uniquify',
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(downloadId);
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
   * Fetches a slide/note link and follows wrapper pages until real file bytes
   * arrive. Handles direct downloads, Content-Disposition endpoints, HTML
   * wrappers (meta refresh / iframe / viewer) and Drive share links.
   * @returns {{bytes: Uint8Array, type: string, ext: string, baseName: string}}
   */
  async fetchResolved(url, maxHops = 4) {
    let current = normalizeShareUrl(url);
    const visited = new Set();

    for (let hop = 0; hop <= maxHops; hop++) {
      if (this.isCancelled) throw new Error('Download cancelled by user');
      if (visited.has(current)) break;
      visited.add(current);

      const { bytes, finalUrl, contentDisposition } = await this.fetchWithMeta(current);
      const hintExt = guessExt(contentDisposition, finalUrl || current);
      const sniffed = sniffType(bytes, hintExt);

      if (sniffed.type !== 'html' && sniffed.type !== 'json') {
        return { bytes, type: sniffed.type, ext: sniffed.ext, baseName: guessBaseName(contentDisposition) };
      }

      const next = extractNextUrl(decodeText(bytes), finalUrl || current);
      if (!next) {
        const text = decodeText(bytes, 4000).toLowerCase();
        if (/sign in|j_username|session\s*expired/.test(text)) {
          throw new Error('Session expired - sign in to PESU Academy again');
        }
        throw new Error('Link opened a web page, not a downloadable file');
      }
      current = normalizeShareUrl(next);
    }
    throw new Error('Link redirected too many times without reaching a file');
  }

  /**
   * PESU's own endpoints are fetched one at a time from inside the PESU tab
   * (they reject parallel / background-worker requests with 500 or empty
   * bodies). Anything else (S3, CloudFront, Drive) is fetched directly.
   */
  async fetchWithMeta(url, retries = CONFIG.DOWNLOADS.RETRY_ATTEMPTS) {
    const isPesuSession = /^https?:\/\/www\.pesuacademy\.com\//i.test(url);
    if (isPesuSession) {
      const run = () => this.scraper.fetchInPage(url);
      const queued = this.pesuQueue.then(run, run);
      this.pesuQueue = queued.catch(() => {});
      try {
        return await queued;
      } catch (pageErr) {
        if (this.isCancelled) throw new Error('Download cancelled by user');
        // Last resort: a direct request from the background worker
        try {
          return await this.fetchDirect(url, retries, true);
        } catch {
          throw pageErr;
        }
      }
    }
    return this.fetchDirect(url, retries, false);
  }

  async fetchDirect(url, retries, isPesuSession) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      if (this.isCancelled) throw new Error('Download cancelled by user');
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: isPesuSession ? 'include' : 'omit',
          redirect: 'follow',
          signal: this.abortController ? this.abortController.signal : undefined
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buf = await response.arrayBuffer();
        if (buf.byteLength === 0) throw new Error('Server returned an empty file');
        return {
          bytes: new Uint8Array(buf),
          finalUrl: response.url || url,
          contentDisposition: response.headers.get('content-disposition') || ''
        };
      } catch (err) {
        if (this.isCancelled || err.name === 'AbortError') throw new Error('Download cancelled by user');
        // 4xx will not get better on retry
        if (/HTTP 4\d\d/.test(err.message) || attempt === retries) throw err;
        await new Promise(r => setTimeout(r, CONFIG.DOWNLOADS.RETRY_DELAY_MS * attempt));
      }
    }
  }

  /**
   * Processes one kind of material (slides or notes) for a subject.
   * Files are added to options.sharedZip when packaging as ZIP, otherwise
   * downloaded straight to disk. Summary counters accumulate on this.summary.
   */
  async processMaterial(subject, selectedUnitNumbers, options, onProgress, kind, subjectSlug, subjectKey) {
    const zip = options.sharedZip || null;
    const kindTag = kind.mergedSuffix; // '' for slides, '_notes' for notes
    const noun = kind.plural;

    if (onProgress) {
      onProgress({
        status: 'scanning',
        message: `Discovering ${noun} for ${subject.displayName}...`
      });
    }

    const scanResult = await this.scraper.scanSubjectSlides(subject.id, selectedUnitNumbers, onProgress, kind.contentType);
    const units = scanResult.units;

    this.summary.unitsFound = Math.max(this.summary.unitsFound, units.length);
    this.summary.filesFound += scanResult.totalFiles;

    let overallFileIndex = 0;
    let lastDownloadId = null;
    const allUnitsMergedList = [];

    for (let uIdx = 0; uIdx < units.length; uIdx++) {
      if (this.isCancelled) {
        if (onProgress) onProgress({ status: 'cancelled', message: 'Download safely cancelled by user.' });
        break;
      }

      const unit = units[uIdx];
      const unitNumber = unit.unitNumber;
      const unitFolderName = `unit_${unitNumber}`;
      const files = unit.files;

      if (files.length === 0) {
        this.summary.emptyUnits = this.summary.emptyUnits || [];
        this.summary.emptyUnits.push(kind.key === 'notes' ? `Unit ${unitNumber} (notes)` : unitNumber);
        if (onProgress) {
          onProgress({
            status: 'unit_empty',
            unitNumber: unitNumber,
            unitName: `Unit ${unitNumber}`,
            message: `⚠️ Unit ${unitNumber}: No ${noun} uploaded on PESU Academy (skipping).`
          });
        }
        continue;
      }

      // Parallel download scheme with preserved chronological order
      const concurrency = CONFIG.DOWNLOADS.CONCURRENT_DOWNLOADS || 4;
      const unitPdfBuffers = new Array(files.length).fill(null);
      let unitCompleted = 0;

      await asyncPool(concurrency, files, async (file, fIdx) => {
        if (this.isCancelled) return;

        const slideIndexPadded = String(fIdx + 1).padStart(2, '0');
        const slideSlug = formatSlideSlug(file.title);

        // Base name without extension: subject_unit_1_slide_01_title
        const baseName = slideSlug
          ? `${subjectSlug}_unit_${unitNumber}_${kind.filePart}_${slideIndexPadded}_${slideSlug}`
          : `${subjectSlug}_unit_${unitNumber}_${kind.filePart}_${slideIndexPadded}`;
        const slidePdfFilename = `${baseName}.pdf`;

        const displayTitle = slideSlug
          ? `${kind.label} ${slideIndexPadded} (${slideSlug.replace(/_/g, ' ')})`
          : `${kind.label} ${slideIndexPadded}`;

        if (onProgress) {
          onProgress({
            status: 'downloading',
            unitName: `Unit ${unitNumber}`,
            unitProgress: `${unitCompleted} / ${files.length}`,
            overallProgress: `${overallFileIndex} / ${scanResult.totalFiles}`,
            currentFile: displayTitle,
            percent: Math.round((overallFileIndex / Math.max(1, scanResult.totalFiles)) * 100)
          });
        }

        try {
          const resolved = await this.fetchResolved(file.fullUrl);
          const fileBytes = resolved.bytes;
          const detectedType = resolved.type;

          let finalPdfBytes = null;
          let rawFile = null; // { bytes, ext } for formats we can't turn into PDF

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
            try {
              finalPdfBytes = await PptxConverter.convertToPdf(fileBytes, `${baseName}.${resolved.ext}`, onProgress);
              this.summary.pptxConverted++;
            } catch (convErr) {
              // Never lose the file: keep the original presentation
              rawFile = { bytes: fileBytes, ext: resolved.ext };
              this.summary.keptOriginal++;
              if (onProgress) {
                onProgress({
                  status: 'downloading',
                  message: `⚠️ ${displayTitle}: could not convert to PDF (${convErr.message}). Saved original .${resolved.ext}.`
                });
              }
            }
          } else {
            // docx, xlsx, txt, images, zip... keep as-is with the right extension
            rawFile = { bytes: fileBytes, ext: resolved.ext };
          }

          const entryName = (ext) => `${baseName}.${ext}`;
          const subPath = (name) => kind.key === 'slides'
            ? `${unitFolderName}/${name}`
            : `${kind.folder}/${unitFolderName}/${name}`;

          if (finalPdfBytes) {
            unitPdfBuffers[fIdx] = {
              buffer: finalPdfBytes,
              title: displayTitle,
              filename: slidePdfFilename,
              index: fIdx
            };
          }

          const outBytes = finalPdfBytes || (rawFile && rawFile.bytes);
          const outName = finalPdfBytes ? slidePdfFilename : (rawFile ? entryName(rawFile.ext) : null);

          if (outBytes && options.saveIndividualFiles !== false || rawFile) {
            if (zip) {
              const zipPath = options.folderPrefix
                ? `${options.folderPrefix}/${kind.folder}/${unitFolderName}/${outName}`
                : `${kind.folder}/${unitFolderName}/${outName}`;
              zip.file(zipPath, outBytes);
            } else if (options.downloadMode !== 'merged_only' || rawFile) {
              // Direct download with clean readable filename
              const relativePath = `${CONFIG.DOWNLOADS.ROOT_FOLDER}/${subjectSlug}/${subPath(outName)}`;
              const blob = new Blob([outBytes]);
              lastDownloadId = await this.triggerChromeDownload(blob, relativePath);
            }
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
        } finally {
          unitCompleted++;
          overallFileIndex++;
          if (onProgress) {
            onProgress({
              status: 'downloading',
              unitName: `Unit ${unitNumber}`,
              unitProgress: `${unitCompleted} / ${files.length}`,
              overallProgress: `${overallFileIndex} / ${scanResult.totalFiles}`,
              currentFile: displayTitle,
              percent: Math.round((overallFileIndex / Math.max(1, scanResult.totalFiles)) * 100)
            });
          }
        }
      });

      const validUnitPdfBuffers = unitPdfBuffers.filter(Boolean);

      // Merge unit PDFs into readable subjectname_unit_x.pdf format and/or queue for multi-unit merge
      if (!this.isCancelled && validUnitPdfBuffers.length > 0 && (options.mergeUnitPdfs !== false || options.mergeAllUnits !== false)) {
        const mergedFilename = `${subjectSlug}_unit_${unitNumber}${kindTag}.pdf`;

        if (onProgress && options.mergeUnitPdfs !== false) {
          onProgress({
            status: 'merging',
            unitName: `Unit ${unitNumber}`,
            message: `Merging ${validUnitPdfBuffers.length} slides into ${mergedFilename}...`
          });
        }

        try {
          const mergeResult = await PdfMerger.mergePdfs(
            validUnitPdfBuffers,
            `${subject.displayName} - Unit ${unitNumber}${kind.key === 'notes' ? ' Notes' : ''}`,
            (p) => {
              if (onProgress && options.mergeUnitPdfs !== false) {
                onProgress({
                  status: 'merging',
                  unitName: `Unit ${unitNumber}`,
                  message: `Merging page ${p.index} of ${p.total} for ${mergedFilename}... (${p.percent}%)`
                });
              }
            },
            () => this.isCancelled
          );

          if (this.isCancelled) break;

          if (options.mergeUnitPdfs !== false) {
            // If ZIP mode: place merged unit PDF right at the root (or under folderPrefix)
            if (zip) {
              const mergedPath = options.folderPrefix
                ? `${options.folderPrefix}/${mergedFilename}`
                : mergedFilename;
              zip.file(mergedPath, mergeResult.bytes);
            } else {
              // Direct or merged_only mode:
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
          }

          if (options.mergeAllUnits !== false && mergeResult.bytes && mergeResult.bytes.length > 0) {
            allUnitsMergedList.push({
              buffer: mergeResult.bytes,
              title: `Unit ${unitNumber}`
            });
          }

        } catch (err) {
          console.error(`Error merging unit PDF for ${mergedFilename}:`, err);
          this.summary.failedList.push({
            unit: `Unit ${unitNumber}`,
            file: mergedFilename,
            reason: `Merge failed: ${err.message}`
          });
        } finally {
          validUnitPdfBuffers.length = 0;
          unitPdfBuffers.length = 0;
        }
      }
    }

    // Merge all processed units into a single combined master PDF if enabled (e.g. Unit 1 + Unit 2)
    if (!this.isCancelled && allUnitsMergedList.length > 0 && options.mergeAllUnits !== false && (allUnitsMergedList.length > 1 || options.mergeUnitPdfs === false)) {
      const activeUnitNums = units.filter(u => u.files && u.files.length > 0).map(u => u.unitNumber).sort((a, b) => a - b);
      const unitsTag = activeUnitNums.length > 0 ? `units_${activeUnitNums.join('_')}` : 'all_units';
      const allUnitsMergedFilename = `${subjectSlug}_${unitsTag}${kindTag}_merged.pdf`;

      if (onProgress) {
        onProgress({
          status: 'merging',
          unitName: 'All Selected Units',
          message: `Merging Unit ${activeUnitNums.join(' + Unit ')} into ${allUnitsMergedFilename}...`
        });
      }

      try {
        let combinedPdfBytes = null;

        if (allUnitsMergedList.length === 1) {
          combinedPdfBytes = allUnitsMergedList[0].buffer;
        } else {
          const combinedResult = await PdfMerger.mergePdfs(
            allUnitsMergedList,
            `${subject.displayName} - Combined ${kind.key === 'notes' ? 'Notes' : 'Units'} (${activeUnitNums.join(', ')})`,
            (p) => {
              if (onProgress) {
                onProgress({
                  status: 'merging',
                  unitName: 'All Selected Units',
                  message: `Combining Unit ${activeUnitNums.join(' + Unit ')}: page ${p.index}/${p.total} (${p.percent}%)`
                });
              }
            },
            () => this.isCancelled
          );
          combinedPdfBytes = combinedResult.bytes;
        }

        if (!this.isCancelled && combinedPdfBytes && combinedPdfBytes.length > 0) {
          if (zip) {
            const destPath = options.folderPrefix
              ? `${options.folderPrefix}/${allUnitsMergedFilename}`
              : allUnitsMergedFilename;
            zip.file(destPath, combinedPdfBytes);
          } else {
            const destPath = (options.downloadMode === 'merged_only')
              ? `${CONFIG.DOWNLOADS.ROOT_FOLDER}/${allUnitsMergedFilename}`
              : `${CONFIG.DOWNLOADS.ROOT_FOLDER}/${subjectSlug}/${allUnitsMergedFilename}`;

            const combinedBlob = new Blob([combinedPdfBytes], { type: 'application/pdf' });
            lastDownloadId = await this.triggerChromeDownload(combinedBlob, destPath);
          }

          this.summary.pdfsMerged++;

          if (onProgress) {
            onProgress({
              status: 'merged_complete',
              unitName: 'All Selected Units',
              mergedFilename: allUnitsMergedFilename,
              message: `✅ Created combined multi-unit PDF: ${allUnitsMergedFilename}`
            });
          }
        }
      } catch (err) {
        console.error(`Error creating combined units PDF ${allUnitsMergedFilename}:`, err);
        this.summary.failedList.push({
          unit: 'All Selected Units',
          file: allUnitsMergedFilename,
          reason: `Combined merge failed: ${err.message}`
        });
      }
    }

    return { units, lastDownloadId };
  }

  /**
   * Main execution function for a subject: slides and/or notes.
   * options.includeSlides (default true), options.includeNotes (default false)
   */
  async processSubject(subject, selectedUnitNumbers = null, options = {}, onProgress = null) {
    this.isCancelled = false;
    this.abortController = new AbortController();
    const subjectSlug = formatSubjectSlug(subject);
    const subjectKey = subject.id;
    await this.loadHistory(subjectKey);

    const kinds = [];
    if (options.includeSlides !== false) kinds.push(MATERIAL_KINDS.slides);
    if (options.includeNotes === true) kinds.push(MATERIAL_KINDS.notes);
    if (kinds.length === 0) kinds.push(MATERIAL_KINDS.slides);

    const isZipMode = options.downloadMode === 'zip' || options.downloadMode === undefined;
    const JSZipClass = (typeof JSZip !== 'undefined' && JSZip) ||
                       (typeof window !== 'undefined' && window.JSZip) ||
                       (typeof self !== 'undefined' && self.JSZip) ||
                       (typeof globalThis !== 'undefined' && globalThis.JSZip);
    const zip = options.sharedZip || ((isZipMode && JSZipClass) ? new JSZipClass() : null);
    const passOptions = { ...options, sharedZip: zip };

    this.summary = {
      subject: subject.displayName,
      unitsFound: 0,
      filesFound: 0,
      filesDownloaded: 0,
      pptxConverted: 0,
      keptOriginal: 0,
      pdfsMerged: 0,
      failed: 0,
      failedList: [],
      emptyUnits: []
    };

    let lastDownloadId = null;
    const downloadedUnitMap = new Map();

    for (let k = 0; k < kinds.length; k++) {
      if (this.isCancelled) break;
      const kind = kinds[k];

      // Map each pass onto its share of 0-100 so the bar never jumps backwards
      const scaled = onProgress && ((evt) => {
        if (!evt) return;
        const next = { ...evt };
        if (typeof next.percent === 'number') {
          next.percent = Math.min(99, Math.round((k * 100 + next.percent) / kinds.length));
        }
        if (kinds.length > 1 && next.currentFile && next.status === 'downloading') {
          next.unitName = `${kind.label}s · ${next.unitName || ''}`.replace(/ · $/, '');
        }
        onProgress(next);
      });

      const result = await this.processMaterial(subject, selectedUnitNumbers, passOptions, scaled, kind, subjectSlug, subjectKey);
      if (result.lastDownloadId) lastDownloadId = result.lastDownloadId;
      for (const u of result.units) {
        if (u.files && u.files.length > 0) downloadedUnitMap.set(u.unitNumber, u);
      }
    }

    // Single clean ZIP (unless a multi-course bundle will be written by the caller)
    if (zip && !options.sharedZip && !options.skipZipDownload && !this.isCancelled && this.summary.filesDownloaded > 0) {
      const downloadedUnits = Array.from(downloadedUnitMap.values());
      const only = kinds.length === 1 ? kinds[0] : null;
      const zipBase = only && only.key === 'notes' ? `${subjectSlug}_notes` : subjectSlug;
      const zipFilename = formatZipFilename(zipBase, downloadedUnits, selectedUnitNumbers);

      if (onProgress) {
        onProgress({
          status: 'merging',
          unitName: 'All Units',
          currentFile: `Saving ${zipFilename} to disk...`,
          message: `Packaging and saving organized materials into ${zipFilename}...`,
          percent: 99
        });
      }

      // PDFs are already compressed, so STORE avoids CPU lockups and memory spikes
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'STORE',
        streamFiles: true
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
