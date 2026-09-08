/**
 * PDF Merger Utility
 * Merges multiple PDF file buffers into a single combined PDF document in order.
 * Built on top of pdf-lib.
 */

export class PdfMerger {
  /**
   * Merges an array of PDF buffers into a single PDF
   * @param {Array<{ buffer: ArrayBuffer | Uint8Array, title: string, filename?: string }>} pdfList
   * @param {string} unitTitle
   * @param {Function} onProgress
   * @returns {Promise<Uint8Array>} Merged PDF bytes
   */
  static async mergePdfs(pdfList, unitTitle = '', onProgress = null) {
    const pdfLib = (typeof window !== 'undefined' && window.PDFLib) ||
                   (typeof self !== 'undefined' && self.PDFLib) ||
                   (typeof globalThis !== 'undefined' && globalThis.PDFLib);
    if (!pdfLib) {
      throw new Error('PDFLib library is not loaded');
    }

    const { PDFDocument } = pdfLib;
    const mergedDoc = await PDFDocument.create();

    mergedDoc.setTitle(unitTitle || 'PESU Academy Course Unit');
    mergedDoc.setCreator('PESU Academy Course Downloader & Organizer');
    mergedDoc.setProducer('pdf-lib / PESU Tool');

    let totalPagesMerged = 0;
    const failedFiles = [];

    for (let i = 0; i < pdfList.length; i++) {
      const item = pdfList[i];
      if (onProgress) {
        onProgress({
          index: i + 1,
          total: pdfList.length,
          title: item.title,
          percent: Math.round(((i + 1) / pdfList.length) * 100)
        });
      }

      try {
        const srcDoc = await PDFDocument.load(item.buffer, {
          ignoreEncryption: true,
          throwOnInvalidObject: false
        });

        const pageIndices = srcDoc.getPageIndices();
        if (pageIndices.length > 0) {
          const copiedPages = await mergedDoc.copyPages(srcDoc, pageIndices);
          copiedPages.forEach(page => mergedDoc.addPage(page));
          totalPagesMerged += copiedPages.length;
        }
      } catch (err) {
        console.error(`Failed to merge PDF '${item.title}':`, err);
        failedFiles.push({ title: item.title, error: err.message });
      }
    }

    if (totalPagesMerged === 0 && pdfList.length > 0) {
      throw new Error('No valid PDF pages could be extracted to create merged unit PDF.');
    }

    const mergedBytes = await mergedDoc.save();
    return {
      bytes: mergedBytes,
      totalPages: totalPagesMerged,
      mergedCount: pdfList.length - failedFiles.length,
      failedFiles
    };
  }
}
