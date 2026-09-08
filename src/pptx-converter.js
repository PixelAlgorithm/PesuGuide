/**
 * PPT/PPTX to PDF Converter
 * Supports dual modes:
 * 1. Native High-Fidelity Conversion via optional local companion (PowerPoint AppleScript / LibreOffice)
 * 2. In-browser Client-side PPTX -> PDF Parser using JSZip + pdf-lib + HTML Canvas
 */
import { CONFIG } from './config.js';

export class PptxConverter {
  /**
   * Detect file format from header bytes (Magic Bytes)
   * @param {Uint8Array} bytes
   * @returns {'pdf' | 'pptx' | 'ppt' | 'unknown'}
   */
  static detectFormat(bytes) {
    if (!bytes || bytes.length < 4) return 'unknown';

    // %PDF (0x25 0x50 0x44 0x46)
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return 'pdf';
    }

    // PK\x03\x04 (0x50 0x4B 0x03 0x04) - Zip based (PPTX, DOCX, XLSX)
    if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) {
      return 'pptx';
    }

    // Binary OLE CFB (0xD0 0xCF 0x11 0xE0) - Legacy PPT
    if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) {
      return 'ppt';
    }

    return 'unknown';
  }

  /**
   * Check if local conversion server is running
   */
  static async checkLocalServer() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(CONFIG.LOCAL_SERVER.PING_URL, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        return { available: true, engine: data.engine || 'Local Converter' };
      }
    } catch {
      // Local server not running, will use built-in JS engine
    }
    return { available: false, engine: 'Built-in JS Engine' };
  }

  /**
   * Converts a PPT/PPTX buffer to a PDF buffer
   * @param {ArrayBuffer | Uint8Array} fileBuffer
   * @param {string} filename
   * @param {Function} onProgress
   * @returns {Promise<Uint8Array>}
   */
  static async convertToPdf(fileBuffer, filename = 'presentation.pptx', onProgress = null) {
    const bytes = fileBuffer instanceof Uint8Array ? fileBuffer : new Uint8Array(fileBuffer);
    const format = this.detectFormat(bytes);

    if (format === 'pdf') {
      return bytes;
    }

    // Check if local companion server is active
    const local = await this.checkLocalServer();
    if (local.available) {
      if (onProgress) onProgress({ stage: 'converting', message: `Converting with ${local.engine}...` });
      try {
        const formData = new FormData();
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        formData.append('file', blob, filename);

        const res = await fetch(CONFIG.LOCAL_SERVER.URL, {
          method: 'POST',
          body: formData
        });

        if (res.ok) {
          const pdfBuffer = await res.arrayBuffer();
          return new Uint8Array(pdfBuffer);
        }
      } catch (err) {
        console.warn('Local companion conversion failed, falling back to built-in converter:', err);
      }
    }

    // Built-in JavaScript PPTX converter
    if (format === 'pptx') {
      return await this.convertPptxInBrowser(bytes, filename, onProgress);
    }

    if (format === 'ppt') {
      throw new Error('Legacy binary .ppt format requires the local companion converter with Microsoft PowerPoint or LibreOffice.');
    }

    throw new Error(`Unsupported file format detected (${format}). Expected PDF or PPTX.`);
  }

  /**
   * Client-side PPTX -> PDF converter using JSZip and pdf-lib
   */
  static async convertPptxInBrowser(bytes, filename, onProgress = null) {
    if (!window.JSZip) {
      throw new Error('JSZip library is required for client-side PPTX conversion.');
    }
    if (!window.PDFLib) {
      throw new Error('PDFLib library is required for generating PDF.');
    }

    const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
    const zip = await window.JSZip.loadAsync(bytes);

    // Discover slides in presentation.xml
    let slideCount = 0;
    const slideFiles = [];
    zip.forEach((path) => {
      const match = path.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
      if (match) {
        slideFiles.push({ path, num: parseInt(match[1], 10) });
      }
    });

    slideFiles.sort((a, b) => a.num - b.num);
    slideCount = slideFiles.length;

    if (slideCount === 0) {
      throw new Error('No slide XML entries found in PPTX archive.');
    }

    // Determine slide dimensions from presentation.xml (default 16:9: 960 x 540 pt)
    let pageWidth = 960;
    let pageHeight = 540;
    try {
      const presXml = await zip.file('ppt/presentation.xml')?.async('text');
      if (presXml) {
        const szMatch = presXml.match(/<p:sldSz\s+[^>]*cx="(\d+)"\s+cy="(\d+)"/);
        if (szMatch) {
          // OpenXML EMU (English Metric Units): 1 inch = 914400 EMU = 72 points
          pageWidth = Math.round((parseInt(szMatch[1], 10) / 914400) * 72);
          pageHeight = Math.round((parseInt(szMatch[2], 10) / 914400) * 72);
        }
      }
    } catch (e) {
      console.warn('Could not parse slide size from presentation.xml:', e);
    }

    const pdfDoc = await PDFDocument.create();
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (let idx = 0; idx < slideFiles.length; idx++) {
      const slide = slideFiles[idx];
      if (onProgress) {
        onProgress({
          stage: 'converting',
          message: `Converting slide ${idx + 1} of ${slideFiles.length}...`,
          percent: Math.round(((idx + 1) / slideFiles.length) * 100)
        });
      }

      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      // Clean background
      page.drawRectangle({
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
        color: rgb(0.98, 0.98, 0.99)
      });

      // Subtle top header bar
      page.drawRectangle({
        x: 0,
        y: pageHeight - 6,
        width: pageWidth,
        height: 6,
        color: rgb(0.08, 0.45, 0.85)
      });

      // Extract slide content (text, paragraphs, images)
      try {
        const slideXml = await zip.file(slide.path)?.async('text');
        if (slideXml) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(slideXml, 'application/xml');

          // Check relationships for images
          const relsPath = `ppt/slides/_rels/slide${slide.num}.xml.rels`;
          const relsXml = await zip.file(relsPath)?.async('text');
          const relsMap = {};
          if (relsXml) {
            const relsDoc = parser.parseFromString(relsXml, 'application/xml');
            relsDoc.querySelectorAll('Relationship').forEach(rel => {
              const id = rel.getAttribute('Id');
              const target = rel.getAttribute('Target');
              if (id && target) relsMap[id] = target;
            });
          }

          // Embedded images in slide
          const blips = Array.from(doc.querySelectorAll('blip[r\\:embed], blip[*|embed]'));
          for (const blip of blips) {
            const embedId = blip.getAttribute('r:embed') || blip.getAttribute('embed');
            let targetPath = relsMap[embedId];
            if (targetPath) {
              targetPath = targetPath.replace(/^\.\.\//, 'ppt/');
              const imgFile = zip.file(targetPath);
              if (imgFile) {
                const imgBytes = await imgFile.async('uint8array');
                try {
                  let embeddedImg = null;
                  if (targetPath.endsWith('.png')) {
                    embeddedImg = await pdfDoc.embedPng(imgBytes);
                  } else if (targetPath.endsWith('.jpg') || targetPath.endsWith('.jpeg')) {
                    embeddedImg = await pdfDoc.embedJpg(imgBytes);
                  }
                  if (embeddedImg) {
                    const imgDims = embeddedImg.scaleToFit(pageWidth * 0.45, pageHeight * 0.45);
                    page.drawImage(embeddedImg, {
                      x: pageWidth - imgDims.width - 30,
                      y: 40,
                      width: imgDims.width,
                      height: imgDims.height
                    });
                  }
                } catch (imgErr) {
                  console.warn('Could not embed slide image:', imgErr);
                }
              }
            }
          }

          // Extract text paragraphs
          const paragraphs = Array.from(doc.querySelectorAll('p\\:sp, sp'));
          let currentY = pageHeight - 50;

          for (const sp of paragraphs) {
            const txBody = sp.querySelector('txBody');
            if (!txBody) continue;

            const pElements = Array.from(txBody.querySelectorAll('p'));
            for (const p of pElements) {
              const isTitle = currentY === (pageHeight - 50);
              const textRuns = Array.from(p.querySelectorAll('r'));
              let lineText = '';

              for (const r of textRuns) {
                const t = r.querySelector('t');
                if (t) lineText += t.textContent;
              }

              lineText = lineText.replace(/\s+/g, ' ').trim();
              if (!lineText) continue;

              const fontSize = isTitle ? 20 : 13;
              const font = isTitle ? fontBold : fontRegular;
              const textColor = isTitle ? rgb(0.1, 0.15, 0.25) : rgb(0.2, 0.25, 0.3);

              // Simple word wrap
              const words = lineText.split(' ');
              let currentLine = '';

              for (const word of words) {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                const width = font.widthOfTextAtSize(testLine, fontSize);

                if (width > pageWidth - 80 && currentLine) {
                  page.drawText(currentLine, {
                    x: 40,
                    y: Math.max(30, currentY),
                    size: fontSize,
                    font,
                    color: textColor
                  });
                  currentY -= fontSize + 6;
                  currentLine = word;
                } else {
                  currentLine = testLine;
                }
              }

              if (currentLine && currentY > 30) {
                page.drawText(currentLine, {
                  x: 40,
                  y: Math.max(30, currentY),
                  size: fontSize,
                  font,
                  color: textColor
                });
                currentY -= fontSize + (isTitle ? 16 : 8);
              }

              if (currentY < 40) break;
            }
          }
        }
      } catch (err) {
        console.warn(`Error parsing slide ${slide.num} content:`, err);
      }

      // Slide footer
      page.drawText(`${slide.num} / ${slideFiles.length}`, {
        x: pageWidth - 70,
        y: 16,
        size: 9,
        font: fontRegular,
        color: rgb(0.6, 0.6, 0.65)
      });
      page.drawText(filename.replace(/\.[^/.]+$/, ''), {
        x: 40,
        y: 16,
        size: 9,
        font: fontRegular,
        color: rgb(0.6, 0.6, 0.65)
      });
    }

    return await pdfDoc.save();
  }
}
