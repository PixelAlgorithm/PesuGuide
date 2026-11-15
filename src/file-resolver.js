/**
 * File resolver helpers
 *
 * PESU Academy "link" items (the chain-link rows under Slides / Notes) do not
 * always point straight at a file. Depending on how faculty uploaded them, a
 * link can be:
 *   - a direct PDF / PPTX / DOCX download,
 *   - a download endpoint that answers with Content-Disposition,
 *   - a small HTML wrapper (viewer, redirect, meta refresh, iframe),
 *   - a Google Drive share link.
 *
 * These helpers are pure (no chrome.* / DOM access) so they can run in the
 * service worker, the popup and in Node tests.
 */

const DOC_EXT = 'pdf|pptx?|ppsx?|docx?|xlsx?|txt|rtf|zip|odt|odp|csv|md';
const DOC_EXT_RE = new RegExp(`\\.(${DOC_EXT})(?:$|[?#&;])`, 'i');

function ascii(bytes, start, end) {
  let s = '';
  const stop = Math.min(end, bytes.length);
  for (let i = Math.max(0, start); i < stop; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * Detect the real file type from magic bytes. `hintExt` (from URL or
 * Content-Disposition) only disambiguates formats that share a signature.
 * @returns {{type: string, ext: string}}  type: pdf|pptx|ppt|docx|xlsx|doc|xls|zip|png|jpg|gif|html|text|unknown
 */
export function sniffType(bytes, hintExt = '') {
  const hint = (hintExt || '').toLowerCase().replace(/^\./, '');
  if (!bytes || bytes.length < 4) return { type: 'unknown', ext: 'bin' };

  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { type: 'pdf', ext: 'pdf' };

  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    // OOXML containers keep their part names in local headers (start) and the
    // central directory (end). Look at both ends.
    const probe = ascii(b, 0, 120000) + ascii(b, b.length - 120000, b.length);
    if (probe.includes('ppt/')) return { type: 'pptx', ext: hint === 'ppsx' ? 'ppsx' : 'pptx' };
    if (probe.includes('word/')) return { type: 'docx', ext: 'docx' };
    if (probe.includes('xl/')) return { type: 'xlsx', ext: 'xlsx' };
    if (hint === 'pptx' || hint === 'ppsx') return { type: 'pptx', ext: hint };
    if (hint === 'docx') return { type: 'docx', ext: 'docx' };
    if (hint === 'xlsx') return { type: 'xlsx', ext: 'xlsx' };
    return { type: 'zip', ext: 'zip' };
  }

  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    if (hint === 'doc') return { type: 'doc', ext: 'doc' };
    if (hint === 'xls') return { type: 'xls', ext: 'xls' };
    return { type: 'ppt', ext: 'ppt' };
  }

  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: 'png', ext: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'jpg', ext: 'jpg' };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { type: 'gif', ext: 'gif' };

  const head = ascii(b, 0, 600).toLowerCase();
  if (head.includes('%pdf')) return { type: 'pdf', ext: 'pdf' }; // junk before header
  const trimmed = head.trimStart();
  if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || trimmed.includes('<head') || trimmed.includes('<body') || trimmed.includes('<script') || trimmed.includes('<meta')) {
    return { type: 'html', ext: 'html' };
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return { type: 'json', ext: 'json' };

  // Printable text → treat as plain text note
  let printable = 0;
  const n = Math.min(b.length, 512);
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 0xc2) printable++;
  }
  if (printable / n > 0.97) return { type: 'text', ext: hint === 'md' ? 'md' : 'txt' };

  return { type: 'unknown', ext: hint || 'bin' };
}

export function decodeText(bytes, max = 400000) {
  const slice = bytes.length > max ? bytes.subarray(0, max) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(slice);
  } catch {
    return ascii(slice, 0, slice.length);
  }
}

/** Pull a file extension out of Content-Disposition or a URL. */
export function guessExt(contentDisposition, url) {
  const cd = contentDisposition || '';
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (m) {
    const name = decodeURIComponentSafe(m[1]);
    const e = name.match(/\.([a-z0-9]{2,5})$/i);
    if (e) return e[1].toLowerCase();
  }
  try {
    const u = new URL(url);
    const e = u.pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (e) return e[1].toLowerCase();
  } catch {}
  return '';
}

/** Filename (without extension) suggested by Content-Disposition, if any. */
export function guessBaseName(contentDisposition) {
  const m = (contentDisposition || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!m) return '';
  return decodeURIComponentSafe(m[1]).replace(/\.[a-z0-9]{2,5}$/i, '').trim();
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/** Rewrite share links into direct-download links. */
export function normalizeShareUrl(url) {
  if (!url) return url;
  let m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/i);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}&confirm=t`;
  m = url.match(/drive\.google\.com\/(?:open|uc)\?[^#]*\bid=([\w-]+)/i);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}&confirm=t`;
  m = url.match(/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]+)/i);
  if (m) {
    const fmt = { document: 'pdf', presentation: 'pdf', spreadsheets: 'xlsx' }[m[1].toLowerCase()];
    return `https://docs.google.com/${m[1]}/d/${m[2]}/export?format=${fmt}`;
  }
  // dropbox ?dl=0 → ?dl=1
  if (/dropbox\.com\//i.test(url)) return url.replace(/([?&])dl=0/, '$1dl=1');
  return url;
}

function toAbsolute(candidate, baseUrl) {
  if (!candidate) return null;
  const c = decodeEntities(candidate.trim()).replace(/\\\//g, '/');
  if (!c || /^(javascript:|mailto:|tel:|data:|#|about:)/i.test(c)) return null;
  try {
    return new URL(c, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Inspect an HTML/JSON wrapper page and return the most likely URL of the real
 * file, or null if nothing looks downloadable.
 */
export function extractNextUrl(text, baseUrl) {
  if (!text) return null;
  const candidates = [];
  const push = (raw, weight) => {
    const abs = toAbsolute(raw, baseUrl);
    if (abs && abs !== baseUrl) candidates.push({ url: abs, weight });
  };

  let m;

  // 1. <meta http-equiv="refresh" content="0; url=...">
  const meta = text.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>]+)["']/i);
  if (meta) push(meta[1], 100);

  // 2. pdf.js style viewer: ?file=<encoded url>
  const viewerRe = /[?&]file=([^&"'\s<>]+)/gi;
  while ((m = viewerRe.exec(text))) push(decodeURIComponentSafe(m[1]), 95);

  // 3. PESU download endpoints (slide / course doc)
  const pesuRe = /(\/Academy\/[^\s"'<>)]*download[^\s"'<>)]*)/gi;
  while ((m = pesuRe.exec(text))) push(m[1], 90);

  // 4. loadIframe('path', 'id')
  const iframeFn = /loadIframe\s*\(\s*['"]([^'"]+)['"]/gi;
  while ((m = iframeFn.exec(text))) push(m[1].split('#')[0], 88);

  // 5. iframe / embed / object / source / video sources
  const embedRe = /<(?:iframe|embed|source)\b[^>]*\bsrc=["']([^"']+)["']/gi;
  while ((m = embedRe.exec(text))) push(m[1].split('#')[0], 80);
  const objRe = /<object\b[^>]*\bdata=["']([^"']+)["']/gi;
  while ((m = objRe.exec(text))) push(m[1].split('#')[0], 80);

  // 6. Absolute URLs that end in a document extension
  const absRe = new RegExp(`https?:\\\\?/\\\\?/[^\\s"'<>)\\\\]+?\\.(?:${DOC_EXT})(?:\\?[^\\s"'<>)]*)?`, 'gi');
  while ((m = absRe.exec(text))) push(m[0], 75);

  // 7. href / data-* / JS navigations
  const hrefRe = /(?:href|data-url|data-href|data-src|data-link)=["']([^"']+)["']/gi;
  while ((m = hrefRe.exec(text))) {
    const v = m[1];
    if (DOC_EXT_RE.test(v) || /download|getfile|attachment|export/i.test(v)) push(v, 70);
  }
  const navRe = /(?:location\.href|location\.assign|location\.replace|window\.open)\s*(?:=|\()\s*['"]([^'"]+)['"]/gi;
  while ((m = navRe.exec(text))) push(m[1], 65);

  // 8. <a download href="...">
  const dlRe = /<a\b[^>]*\bdownload\b[^>]*\bhref=["']([^"']+)["']/gi;
  while ((m = dlRe.exec(text))) push(m[1], 60);

  // 9. JSON payloads {"url": "..."} / {"link": "..."}
  const jsonRe = /"(?:url|link|href|path|file|fileUrl|downloadUrl)"\s*:\s*"([^"]+)"/gi;
  while ((m = jsonRe.exec(text))) push(m[1], 55);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.weight - a.weight);
  // Drop analytics / static asset noise
  const clean = candidates.filter(c => !/\.(css|js|woff2?|ttf|svg|ico)(?:[?#]|$)/i.test(c.url) && !/google-analytics|googletagmanager|fonts\.g/i.test(c.url));
  return (clean[0] || null)?.url || null;
}
