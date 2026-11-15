/**
 * PESU Academy API & DOM Scraper
 * Executes in world: 'MAIN' directly inside the PESU Academy webpage
 * so that jQuery (window.$), CSRF tokens, and session cookies are 100% native and identical.
 */
import { CONFIG } from './config.js';

const PESU_TAB_PATTERN = '*://www.pesuacademy.com/*';
const PESU_HOME = 'https://www.pesuacademy.com/Academy/s/studentProfilePESU';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}

export class PesuScraper {
  /**
   * @param {{ keepAlive?: boolean }} opts
   *   keepAlive: used by the background downloader. The scraper sticks to one
   *   PESU tab for the whole run, stops the browser from discarding it, and if
   *   the user navigates that tab elsewhere (or closes it) it reopens PESU
   *   Academy in a background tab instead of failing.
   */
  constructor(opts = {}) {
    this.csrfToken = null;
    this.keepAlive = !!opts.keepAlive;
    this.tabId = null;          // tab we are currently driving
    this.helperTabId = null;    // tab we opened ourselves (closed on release)
    this.pinnedTabs = new Set();
    this.badTabs = new Set();   // tabs that just hung/failed; avoid for this call
  }

  isPesuUrl(url) {
    return typeof url === 'string' && /^https?:\/\/www\.pesuacademy\.com\//i.test(url);
  }

  /**
   * Find an active or open PESU Academy tab
   */
  async getPesuTab() {
    try {
      // Prefer the tab we were already using, as long as it is still on PESU
      if (this.tabId != null) {
        const t = await chrome.tabs.get(this.tabId).catch(() => null);
        if (t && this.isPesuUrl(t.url) && !t.discarded && !t.frozen && !this.badTabs.has(t.id)) return t;
        this.tabId = null;
      }
      const tabs = await chrome.tabs.query({ url: PESU_TAB_PATTERN });
      const usable = (tabs || []).filter(t => !t.discarded && !t.frozen && !this.badTabs.has(t.id));
      if (usable.length > 0) {
        const activeTab = usable.find(t => t.active);
        const profileTab = usable.find(t => t.url.includes('/s/studentProfile'));
        return activeTab || profileTab || usable[0];
      }
      // A discarded PESU tab can be woken up rather than opening a new one
      const discarded = (tabs || []).find(t => t.discarded);
      if (discarded && this.keepAlive) {
        await chrome.tabs.reload(discarded.id);
        return await this.waitForTabReady(discarded.id);
      }
    } catch (e) {
      console.warn('Could not query tabs:', e);
    }
    return null;
  }

  /** Wait until a tab has finished loading and PESU's jQuery is available. */
  async waitForTabReady(tabId, timeoutMs = 25000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const t = await chrome.tabs.get(tabId).catch(() => null);
      if (!t) return null;
      if (t.status === 'complete' && this.isPesuUrl(t.url)) {
        try {
          const [probe] = await withTimeout(chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => !!(window.$ && window.$.ajax)
          }), 4000, 'probe timeout');
          if (probe && probe.result === true) return t;
        } catch {}
      }
      await sleep(400);
    }
    return null;
  }

  /**
   * Get a PESU tab to run in. In keepAlive mode, open one in the background
   * when none is left (your login cookie is shared, so it is signed in).
   */
  async acquireTab() {
    let tab = await this.getPesuTab();
    if (!tab && this.keepAlive) {
      if (this.helperTabId != null) {
        tab = await this.waitForTabReady(this.helperTabId, 5000);
        if (!tab) this.helperTabId = null;
      }
      if (!tab) {
        const created = await chrome.tabs.create({ url: PESU_HOME, active: false });
        this.helperTabId = created.id;
        tab = await this.waitForTabReady(created.id);
      }
    }
    if (!tab) return null;
    this.tabId = tab.id;
    if (this.keepAlive && !this.pinnedTabs.has(tab.id)) {
      this.pinnedTabs.add(tab.id);
      // Stop Brave/Chrome memory saver from unloading the tab mid-download
      chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
    }
    return tab;
  }

  /** Undo autoDiscardable changes and close any tab we opened. */
  async release() {
    for (const id of this.pinnedTabs) {
      chrome.tabs.update(id, { autoDiscardable: true }).catch(() => {});
    }
    this.pinnedTabs.clear();
    this.badTabs.clear();
    if (this.helperTabId != null) {
      chrome.tabs.remove(this.helperTabId).catch(() => {});
      this.helperTabId = null;
    }
    this.tabId = null;
  }

  /**
   * Execute function in the MAIN world of a PESU Academy tab.
   * Every PESU call returns a value (array/object), so an empty result means
   * the page went away while we were waiting. That is retried on a fresh tab
   * instead of being mistaken for "no slides uploaded".
   */
  async executeInMainWorld(func, args = [], opts = {}) {
    const timeoutMs = opts.timeoutMs || 30000;
    const attempts = this.keepAlive ? 4 : 1;
    let lastErr = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const tab = await this.acquireTab();
      if (!tab) {
        lastErr = new Error('No PESU Academy tab found. Open PESU Academy and sign in.');
        if (!this.keepAlive) throw lastErr;
        await sleep(1000);
        continue;
      }

      let results;
      try {
        results = await withTimeout(chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func,
          args
        }), timeoutMs, `PESU Academy tab did not answer in ${Math.round(timeoutMs / 1000)}s (frozen in background?)`);
      } catch (err) {
        // Tab navigated, closed, froze or crashed during the call
        lastErr = err;
        this.badTabs.add(tab.id);
        this.tabId = null;
        await sleep(700 * attempt);
        continue;
      }

      const result = results && results[0] ? results[0].result : undefined;
      if (result === undefined || result === null) {
        lastErr = new Error('PESU Academy tab stopped responding (did it navigate away?)');
        this.tabId = null;
        await sleep(700 * attempt);
        continue;
      }
      if (result && result.error) {
        if (result.retry && attempt < attempts) {
          lastErr = new Error(result.error);
          await sleep(1000 * attempt);
          continue;
        }
        throw new Error(result.error);
      }
      this.badTabs.delete(tab.id);
      return result;
    }
    throw lastErr || new Error('Script execution in PESU Academy tab failed.');
  }

  /**
   * Download a PESU Academy URL from inside the signed-in PESU tab, exactly
   * like a click would (same-origin cookies, Referer, CSRF header). PESU's
   * download endpoints answer 500 / empty bodies to requests that don't look
   * like they came from the page, so this is the reliable path for them.
   * @returns {{bytes: Uint8Array, finalUrl: string, contentDisposition: string}}
   */
  async fetchInPage(url) {
    const res = await this.executeInMainWorld(async (u) => {
      const csrf = document.querySelector('meta[name="csrf-token"]')?.content ||
                   (window.$ && window.$.ajaxSettings?.headers ? window.$.ajaxSettings.headers['X-CSRF-Token'] : '') || '';
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      let last = 'no response';
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 60000);
          const r = await fetch(u, {
            credentials: 'include',
            headers: csrf ? { 'X-CSRF-Token': csrf } : {},
            signal: ctrl.signal
          });
          const buf = new Uint8Array(await r.arrayBuffer());
          clearTimeout(timer);
          if (r.ok && buf.byteLength > 0) {
            let bin = '';
            for (let i = 0; i < buf.length; i += 0x8000) {
              bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
            }
            return { ok: true, b64: btoa(bin), finalUrl: r.url, cd: r.headers.get('content-disposition') || '' };
          }
          last = r.ok ? 'Server returned an empty file' : `HTTP ${r.status}`;
        } catch (e) {
          last = e.name === 'AbortError' ? 'Timed out after 60s' : e.message;
        }
        await wait(1200 * attempt);
      }
      return { error: `${last} (from PESU tab)` };
    }, [url], { timeoutMs: 200000 });

    const bin = atob(res.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, finalUrl: res.finalUrl || url, contentDisposition: res.cd || '' };
  }

  /**
   * Check if user is currently logged into PESU Academy
   */
  async checkLoginStatus() {
    const tab = await this.getPesuTab();
    if (!tab) {
      return { loggedIn: false, error: 'No PESU Academy tab is open. Please open PESU Academy.' };
    }

    try {
      return await this.executeInMainWorld(() => {
        const isLoginPage = !!(
          document.querySelector('input[name="j_username"]') ||
          document.querySelector('form[action*="authenticate"]') ||
          document.title.includes('Sign in') ||
          window.location.pathname.endsWith('/Academy/') ||
          window.location.pathname.endsWith('/Academy')
        );

        const isDashboard = !!(
          window.location.pathname.includes('/s/studentProfile') ||
          document.querySelector('#StudentProfilePESUContent') ||
          document.querySelector('.menu-name') ||
          document.querySelector('meta[name="csrf-token"]')
        );

        return {
          loggedIn: isDashboard && !isLoginPage,
          isLoginPage,
          isDashboard,
          url: window.location.href,
          title: document.title
        };
      });
    } catch (err) {
      return { loggedIn: false, error: err.message };
    }
  }

  /**
   * Get all semesters available for the student
   */
  async getSemesters() {
    return await this.executeInMainWorld(() => {
      return new Promise((resolve, reject) => {
        // First check if #semesters select is already in the DOM
        const existingSelect = document.querySelector('#semesters');
        if (existingSelect && existingSelect.options.length > 0) {
          const sems = Array.from(existingSelect.options).map(o => ({
            id: o.value.trim(),
            name: o.text.trim(),
            selected: o.selected
          })).filter(s => s.id && s.id !== '0');
          if (sems.length > 0) return resolve(sems);
        }

        const csrf = document.querySelector('meta[name="csrf-token"]')?.content ||
                     (window.$ && $.ajaxSettings?.headers ? $.ajaxSettings.headers['X-CSRF-Token'] : '');

        if (!window.$) {
          return resolve({ error: 'jQuery not found on PESU Academy page. Please refresh the page.' });
        }

        window.$.ajax({
          url: 'https://www.pesuacademy.com/Academy/s/studentProfile/getStudentSemestersPESU',
          type: 'GET',
          timeout: 20000,
          headers: {
            'X-CSRF-Token': csrf,
            'X-Requested-With': 'XMLHttpRequest'
          },
          success: (html) => {
            if (typeof html === 'string' && (html.includes('Sign in') || html.includes('sessionExpired'))) {
              return resolve({ error: 'Session expired. Please sign in to PESU Academy.' });
            }
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const options = Array.from(doc.querySelectorAll('option'));
            const sems = options.map(opt => ({
              id: opt.value.trim(),
              name: opt.textContent.trim(),
              selected: opt.hasAttribute('selected')
            })).filter(s => s.id && s.id !== '0');
            resolve(sems);
          },
          error: (xhr, status, err) => {
            resolve({ error: `Failed to load semesters (HTTP ${xhr.status}): ${err || status}` });
          }
        });
      });
    });
  }

  /**
   * Get all courses/subjects for a specific semester
   */
  async getSubjects(semesterId) {
    return await this.executeInMainWorld((semId) => {
      return new Promise((resolve, reject) => {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content ||
                     (window.$ && $.ajaxSettings?.headers ? $.ajaxSettings.headers['X-CSRF-Token'] : '');

        if (!window.$) {
          return resolve({ error: 'jQuery not found on PESU Academy page. Please refresh the page.' });
        }

        // Before querying subjects, ensure thisAction.menuId is 653 (My Courses)
        if (typeof window.thisAction !== 'undefined') {
          window.thisAction.menuId = 653;
          window.thisAction.controllerMode = 6403;
          window.thisAction.actionType = 5;
        }

        window.$.ajax({
          url: 'https://www.pesuacademy.com/Academy/s/studentProfilePESUAdmin',
          type: 'POST',
          timeout: 20000,
          data: {
            controllerMode: 6403,
            actionType: 38,
            id: semId,
            menuId: 653
          },
          headers: {
            'X-CSRF-Token': csrf,
            'X-Requested-With': 'XMLHttpRequest'
          },
          success: (html) => {
            if (typeof html === 'string' && (html.includes('Invalid CSRF Token') || html.includes('sessionExpired') || html.includes('Sign in'))) {
              return resolve({ error: 'Session expired or invalid CSRF token. Please refresh PESU Academy and sign in.' });
            }

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const rows = Array.from(doc.querySelectorAll('tr[id^="rowWiseCourseContent_"]'));

            const subjects = rows.map(r => {
              const subjectId = r.id.replace('rowWiseCourseContent_', '').trim();
              const code = r.cells[0] ? r.cells[0].innerText.split('\n')[0].trim() : '';
              const title = r.cells[1] ? r.cells[1].innerText.trim() : '';
              const type = r.cells[2] ? r.cells[2].innerText.trim() : '';
              const status = r.cells[3] ? r.cells[3].innerText.trim() : '';

              return {
                id: subjectId,
                code,
                title,
                type,
                status,
                displayName: `${code} - ${title}`
              };
            }).filter(s => s.id && s.code);

            resolve(subjects);
          },
          error: (xhr, status, err) => {
            resolve({ error: `Failed to load courses (HTTP ${xhr.status}): ${err || status}` });
          }
        });
      });
    }, [semesterId]);
  }

  /**
   * Get all units for a given subject
   */
  async getUnits(subjectId) {
    return await this.executeInMainWorld((subId) => {
      return new Promise((resolve) => {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content ||
                     (window.$ && $.ajaxSettings?.headers ? $.ajaxSettings.headers['X-CSRF-Token'] : '');

        window.$.ajax({
          url: 'https://www.pesuacademy.com/Academy/s/studentProfilePESUAdmin',
          type: 'GET',
          timeout: 20000,
          data: {
            controllerMode: 6403,
            actionType: 42,
            id: subId,
            menuId: 653
          },
          headers: {
            'X-CSRF-Token': csrf,
            'X-Requested-With': 'XMLHttpRequest'
          },
          success: (html) => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const unitLinks = Array.from(doc.querySelectorAll('#courselistunit li a'));

            const units = unitLinks.map((a, index) => {
              const onclick = a.getAttribute('onclick') || '';
              const match = onclick.match(/handleclassUnit\('([^']+)'\)/);
              const unitContentId = match ? match[1] : null;
              let rawName = a.innerText.trim();

              let unitNumber = index + 1;
              const numMatch = rawName.match(/Unit\s*(\d+)/i);
              if (numMatch) {
                unitNumber = parseInt(numMatch[1], 10);
              }

              return {
                unitNumber,
                unitContentId,
                rawName,
                folderName: `Unit ${unitNumber}`
              };
            }).filter(u => u.unitContentId);

            resolve(units);
          },
          error: (xhr, status, err) => {
            resolve({ error: `Failed to load units (HTTP ${xhr.status}): ${err || status}`, retry: true });
          }
        });
      });
    }, [subjectId]);
  }

  /**
   * Get all classes for a specific unit
   */
  async getUnitClasses(unitContentId, subjectId, contentType = 2) {
    return await this.executeInMainWorld((uContentId, subId, ctype) => {
      return new Promise((resolve) => {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content ||
                     (window.$ && $.ajaxSettings?.headers ? $.ajaxSettings.headers['X-CSRF-Token'] : '');

        window.$.ajax({
          url: 'https://www.pesuacademy.com/Academy/s/studentProfilePESUAdmin',
          type: 'GET',
          timeout: 20000,
          data: {
            controllerMode: 6403,
            actionType: 43,
            coursecontentid: uContentId,
            menuId: 653,
            selectedData: subId,
            subType: 3
          },
          headers: {
            'X-CSRF-Token': csrf,
            'X-Requested-With': 'XMLHttpRequest'
          },
          success: (html) => {
            const cleanHtml = (typeof html === 'string') ? html : '';
            if (cleanHtml.includes('No information available') || cleanHtml.includes('No subjects found')) {
              return resolve([]);
            }

            // Extract global unit IDs from any handleclasscoursecontentunit call anywhere in this unit's HTML
            const globalMatch = cleanHtml.match(/handleclasscoursecontentunit\s*\(\s*['"]?([^'",]+)['"]?\s*,\s*['"]?([^'",]+)['"]?\s*,\s*['"]?([^'",]+)['"]/i);
            const globalCourseUnitId = globalMatch ? globalMatch[1] : uContentId;
            const globalSubjectId = globalMatch ? globalMatch[2] : subId;
            const globalCourseContentId = globalMatch ? globalMatch[3] : uContentId;

            // In Chrome, DOMParser on a fragment without <table> drops <tr> tags.
            // Always wrap in <table> to preserve all table rows!
            const wrappedHtml = cleanHtml.includes('<table') ? cleanHtml : `<table><tbody>${cleanHtml}</tbody></table>`;
            const parser = new DOMParser();
            const doc = parser.parseFromString(wrappedHtml, 'text/html');

            let rows = [];
            if (window.$) {
              try {
                rows = window.$('<div>').html(cleanHtml).find('tr').toArray();
              } catch (e) {}
            }
            if (!rows || rows.length === 0) {
              rows = Array.from(doc.querySelectorAll('tr'));
            }

            const classes = [];
            const seenClasses = new Set();
            let rowClassCounter = 0;

            for (const row of rows) {
              // Skip table headers
              const ths = row.querySelectorAll ? row.querySelectorAll('th') : (window.$(row).find('th').toArray());
              const tds = row.querySelectorAll ? row.querySelectorAll('td') : (window.$(row).find('td').toArray());
              if (ths.length > 0 && tds.length === 0) {
                continue;
              }

              rowClassCounter++;
              const firstCell = tds[0];
              const cellText = firstCell ? (firstCell.textContent || firstCell.innerText || '').trim() : '';
              let className = cellText.replace(/\s+/g, ' ').trim();
              if (!className || /^(s\.?no|sl\.?no|class\s*name|topic|classes)$/i.test(className)) {
                className = `Class ${rowClassCounter}`;
              }

              // Search this row for any handleclasscoursecontentunit call (case-insensitive)
              const clickables = Array.from(row.querySelectorAll ? row.querySelectorAll('*') : window.$(row).find('*').toArray())
                .filter(el => el.getAttribute && el.getAttribute('onclick'));

              let matched = null;
              // 1. Prefer the requested content type (2 = Slides, 3 = Notes)
              const typedRe = new RegExp("handleclasscoursecontentunit\\s*\\(\\s*['\"]?([^'\",]+)['\"]?\\s*,\\s*['\"]?([^'\",]+)['\"]?\\s*,\\s*['\"]?([^'\",]+)['\"]?\\s*,\\s*['\"]?([^'\",]+)['\"]?\\s*,\\s*['\"]?" + ctype + "\\b", 'i');
              for (const el of clickables) {
                const oc = el.getAttribute('onclick') || '';
                const m = oc.match(typedRe);
                if (m) {
                  matched = m;
                  break;
                }
              }

              // 2. Any handleclasscoursecontentunit handler in row
              if (!matched) {
                for (const el of clickables) {
                  const oc = el.getAttribute('onclick') || '';
                  const m = oc.match(/handleclasscoursecontentunit\s*\(\s*['"]?([^'",]+)['"]?\s*,\s*['"]?([^'",]+)['"]?\s*,\s*['"]?([^'",]+)['"]?\s*,\s*['"]?([^'",]+)['"]/i);
                  if (m) {
                    matched = m;
                    break;
                  }
                }
              }

              let courseunitid, subjectid, coursecontentid, classNo;
              if (matched) {
                courseunitid = matched[1];
                subjectid = matched[2];
                coursecontentid = matched[3];
                classNo = matched[4];
              } else {
                // Fallback: extract classNo from data attributes or row index
                const rowEl = row.getAttribute ? row : (row[0] || row);
                const attrClassNo = rowEl.getAttribute ? (rowEl.getAttribute('data-classno') || rowEl.getAttribute('data-class-no') || rowEl.getAttribute('data-id')) : null;
                classNo = attrClassNo || String(rowClassCounter);
                courseunitid = globalCourseUnitId;
                subjectid = globalSubjectId;
                coursecontentid = globalCourseContentId;
              }

              const classKey = `${courseunitid}_${coursecontentid}_${classNo}`;
              if (!seenClasses.has(classKey)) {
                seenClasses.add(classKey);
                classes.push({
                  className,
                  courseunitid,
                  subjectid,
                  coursecontentid,
                  classNo
                });
              }
            }

            // Fallback: if no classes were found from rows, ensure at least one default class
            // so that actionType: 60 can inspect slides for this unit content
            if (classes.length === 0) {
              classes.push({
                className: 'Unit Materials',
                courseunitid: globalCourseUnitId,
                subjectid: globalSubjectId,
                coursecontentid: globalCourseContentId,
                classNo: '1'
              });
            }

            resolve(classes);
          },
          error: (xhr, status, err) => {
            resolve({ error: `Failed to load classes (HTTP ${xhr.status}): ${err || status}`, retry: true });
          }
        });
      });
    }, [unitContentId, subjectId, contentType]);
  }

  /**
   * Get all slide files for a specific class
   */
  async getClassSlideFiles(classInfo, contentType = 2) {
    return await this.executeInMainWorld((cls, ctype) => {
      return new Promise((resolve) => {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content ||
                     (window.$ && $.ajaxSettings?.headers ? $.ajaxSettings.headers['X-CSRF-Token'] : '');

        window.$.ajax({
          url: 'https://www.pesuacademy.com/Academy/s/studentProfilePESUAdmin',
          type: 'GET',
          timeout: 20000,
          data: {
            controllerMode: 6403,
            actionType: 60,
            selectedData: cls.subjectid,
            id: ctype,
            unitid: cls.courseunitid,
            coursecontentid: cls.coursecontentid,
            classno: cls.classNo,
            menuId: 653,
            subType: 3
          },
          headers: {
            'X-CSRF-Token': csrf,
            'X-Requested-With': 'XMLHttpRequest'
          },
          success: (html) => {
            const cleanHtml = (typeof html === 'string') ? html : '';
            const parser = new DOMParser();
            const doc = parser.parseFromString(cleanHtml, 'text/html');

            // Search whole document body and content area for all clickable links & preview cards
            const candidateLinks = Array.from(
              doc.querySelectorAll('a, [onclick], [data-url], [data-href], [data-link], [data-path], [data-src], iframe, embed, .link-preview, [class*="link"], [class*="slide"], [class*="card"], [class*="preview"]')
            );

            const files = [];
            const seenUrls = new Set();
            let linkIndex = 0;

            for (const a of candidateLinks) {
              let title = (a.textContent || a.innerText || a.getAttribute('title') || a.getAttribute('data-title') || '').trim();
              title = title
                .replace(/[\uE000-\uF8FF]/g, '')
                .replace(/[›»><]/g, '')
                .replace(/\s+/g, ' ')
                .trim();

              // Skip obvious navigation links (e.g. "Back to Units", "Previous", "Next")
              if (
                /^(back\s+to\s+units|back|previous|next)$/i.test(title) ||
                (a.className && /back_link|lefttogglemenulink/i.test(a.className))
              ) {
                continue;
              }

              const onclick = a.getAttribute('onclick') || '';
              const href = (a.getAttribute('href') || '').trim();
              const dataUrl = (a.getAttribute('data-url') || a.getAttribute('data-href') || a.getAttribute('data-link') || a.getAttribute('data-path') || a.getAttribute('data-src') || '').trim();

              if (onclick.includes('handleclassUnit') || onclick.includes('toggleLeftSideMenu')) {
                continue;
              }

              let path = '';
              let docId = '';

              // Case A: loadIframe('path', 'docId')
              const iframeMatch = onclick.match(/loadIframe\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i);
              if (iframeMatch) {
                path = iframeMatch[1].split('#')[0];
                docId = iframeMatch[2];
              }

              // Case B: downloadcoursedoc('<uuid>') / downloadslidecoursedoc(123) / ...
              // These are the "link" rows: clicking them opens a file download.
              // PESU's handler is e.g.
              //   downloadcoursedoc(e){ window.open("referenceMeterials/downloadcoursedoc/"+e) }
              // (a path relative to the current page), so the safest way to get
              // the real URL is to run that handler with window.open captured.
              if (!path) {
                const docMatch = onclick.match(/(download\w*)\s*\(\s*['"]?([\w-]+)['"]?/i);
                if (docMatch) {
                  const fnName = docMatch[1];
                  docId = docMatch[2];
                  const fn = window[fnName];
                  const fnSrc = typeof fn === 'function' ? String(fn) : '';
                  if (fnSrc && /window\.open\s*\(/.test(fnSrc) && !/location\s*(\.href)?\s*=|location\.(assign|replace)/.test(fnSrc)) {
                    const realOpen = window.open;
                    let captured = null;
                    try {
                      window.open = (u) => { captured = u; return null; };
                      fn.call(window, docId);
                    } catch (e) {
                    } finally {
                      window.open = realOpen;
                    }
                    if (captured) path = new URL(String(captured), window.location.href).toString();
                  }
                  if (!path && fnSrc) {
                    // Rebuild from the string literal in the handler: "<prefix>" + id
                    const um = fnSrc.match(/["']([^"']*download[^"']*\/)["']\s*\+\s*\w+\s*,?/i) ||
                               fnSrc.match(/["']([\w\/.-]*)["'][^;]*?\+\s*["'](\/download\w*\/)["']/i);
                    if (um) {
                      const prefix = um[2] ? um[1] + um[2] : um[1];
                      path = new URL(prefix + docId, window.location.href).toString();
                    }
                  }
                  if (!path) {
                    // Known PESU layout: handlers open "referenceMeterials/<fn>/<id>"
                    // relative to /Academy/s/
                    const endpoint = /slide/i.test(fnName) ? 'downloadslidecoursedoc' : 'downloadcoursedoc';
                    path = `https://www.pesuacademy.com/Academy/s/referenceMeterials/${endpoint}/${docId}`;
                  }
                }
              }

              // Case C: window.open('url', ...) or location.href = 'url'
              if (!path) {
                const winOpenMatch = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/i);
                if (winOpenMatch) {
                  path = winOpenMatch[1];
                } else {
                  const locMatch = onclick.match(/(?:location\.href|location\.assign)\s*=\s*['"]([^'"]+)['"]/i);
                  if (locMatch) {
                    path = locMatch[1];
                  }
                }
              }

              // Case D: Any URL embedded in onclick
              if (!path && onclick) {
                const rawUrlMatch = onclick.match(/(https?:\/\/[^\s'")]+|\/Academy\/[^\s'")]+)/i);
                if (rawUrlMatch) {
                  path = rawUrlMatch[1];
                }
              }

              // Case E: Direct href link
              if (!path && href && !href.startsWith('javascript:') && href !== '#' && !href.startsWith('#')) {
                path = href;
              }

              // Case F: data-url / data-href / data-link attribute
              if (!path && dataUrl && !dataUrl.startsWith('javascript:')) {
                path = dataUrl;
              }

              // Case G: iframe/embed src
              if (!path && (a.tagName === 'IFRAME' || a.tagName === 'EMBED')) {
                const src = a.getAttribute('src');
                if (src && !src.startsWith('javascript:')) {
                  path = src;
                }
              }

              if (!path) {
                continue;
              }

              // Normalize target URL & clean HTML entities like &amp;
              let fullUrl = path.replace(/&amp;/g, '&').replace(/['"]+$/, '');
              if (fullUrl.startsWith('//')) {
                fullUrl = `https:${fullUrl}`;
              } else if (fullUrl.startsWith('/')) {
                fullUrl = `https://www.pesuacademy.com${fullUrl}`;
              } else if (!/^https?:\/\//i.test(fullUrl)) {
                fullUrl = `https://www.pesuacademy.com/Academy/s/${fullUrl}`;
              }

              // Convert Google Drive links to direct download
              const gDriveFileMatch = fullUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
              if (gDriveFileMatch) {
                fullUrl = `https://drive.google.com/uc?export=download&id=${gDriveFileMatch[1]}&confirm=t`;
                if (!docId) docId = `gdrive_${gDriveFileMatch[1]}`;
              } else {
                const gDriveIdMatch = fullUrl.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/i);
                if (gDriveIdMatch) {
                  fullUrl = `https://drive.google.com/uc?export=download&id=${gDriveIdMatch[1]}&confirm=t`;
                  if (!docId) docId = `gdrive_${gDriveIdMatch[1]}`;
                }
              }

              linkIndex++;
              if (!docId) {
                docId = `slide_doc_${cls.classNo}_${linkIndex}`;
              }

              if (seenUrls.has(fullUrl)) {
                continue;
              }
              seenUrls.add(fullUrl);

              files.push({
                docId,
                title: title || cls.className || `Slide Document ${linkIndex}`,
                className: cls.className,
                relativeUrl: path,
                fullUrl: fullUrl
              });
            }

            // Fallback: search raw HTML string for any files.pesuacademy.com or CloudFront S3 links
            const unescapedHtml = cleanHtml.replace(/\\\//g, '/');
            const s3Matches = Array.from(unescapedHtml.matchAll(/https?:\/\/files\.pesuacademy\.com\/elearning\/[^\s'"<>]+\.(?:pptx?|pdf|ppt)[^\s'"<>]*/gi));
            for (const sm of s3Matches) {
              const cleanS3Url = sm[0].replace(/&amp;/g, '&').replace(/['"]+$/, '').split('#')[0];
              if (!seenUrls.has(cleanS3Url)) {
                seenUrls.add(cleanS3Url);
                linkIndex++;
                files.push({
                  docId: `s3_doc_${cls.classNo}_${linkIndex}`,
                  title: cls.className || `Slide Presentation ${linkIndex}`,
                  className: cls.className,
                  relativeUrl: cleanS3Url,
                  fullUrl: cleanS3Url
                });
              }
            }

            // Global Raw Regex for any generic presentations or documents
            const anyDocMatches = Array.from(unescapedHtml.matchAll(/https?:\/\/[a-zA-Z0-9_.-]+\.(?:s3[a-zA-Z0-9_.-]*\.amazonaws\.com|cloudfront\.net|pesuacademy\.com)\/[^\s'"<>]+\.(?:pptx?|pdf|ppt)[^\s'"<>]*/gi));
            for (const dm of anyDocMatches) {
              const cleanDocUrl = dm[0].replace(/&amp;/g, '&').replace(/['"]+$/, '').split('#')[0];
              if (!seenUrls.has(cleanDocUrl)) {
                seenUrls.add(cleanDocUrl);
                linkIndex++;
                files.push({
                  docId: `cloud_doc_${cls.classNo}_${linkIndex}`,
                  title: cls.className || `Slide Document ${linkIndex}`,
                  className: cls.className,
                  relativeUrl: cleanDocUrl,
                  fullUrl: cleanDocUrl
                });
              }
            }

            resolve(files);
          },
          error: (xhr, status, err) => {
            resolve({ error: `Failed to load file links (HTTP ${xhr.status}): ${err || status}`, retry: true });
          }
        });
      });
    }, [classInfo, contentType]);
  }

  /**
   * Discovers the entire hierarchy of slides for a subject
   */
  async scanSubjectSlides(subjectId, selectedUnitNumbers = null, onProgress = null, contentType = 2) {
    const units = await this.getUnits(subjectId);
    if (!Array.isArray(units)) {
      if (units && units.error) {
        throw new Error(units.error);
      }
      return { subjectId, units: [], totalFiles: 0 };
    }

    const targetUnits = (selectedUnitNumbers && Array.isArray(selectedUnitNumbers) && selectedUnitNumbers.length > 0)
      ? units.filter(u => selectedUnitNumbers.map(Number).includes(Number(u.unitNumber)))
      : units;

    const scannedUnits = [];
    let totalFilesFound = 0;

    for (let uIdx = 0; uIdx < targetUnits.length; uIdx++) {
      const unit = targetUnits[uIdx];
      if (onProgress) {
        onProgress({
          stage: 'scanning',
          message: `Scanning ${unit.folderName}... (${uIdx + 1}/${targetUnits.length})`,
          unit: unit.folderName
        });
      }

      const classes = await this.getUnitClasses(unit.unitContentId, subjectId, contentType);
      const unitFiles = [];
      const seenDocIds = new Set();

      if (Array.isArray(classes) && classes.length > 0) {
        for (const cls of classes) {
          const files = await this.getClassSlideFiles(cls, contentType);
          if (Array.isArray(files)) {
            for (const f of files) {
              if (!seenDocIds.has(f.docId)) {
                seenDocIds.add(f.docId);
                unitFiles.push({
                  ...f,
                  unitNumber: unit.unitNumber,
                  unitName: unit.rawName,
                  unitFolderName: unit.folderName
                });
              }
            }
          }
        }
      }

      if (unitFiles.length === 0 && onProgress) {
        onProgress({
          status: 'unit_empty',
          unitNumber: unit.unitNumber,
          unitName: unit.folderName,
          message: `⚠️ ${unit.folderName}: No slide materials uploaded on PESU Academy yet.`
        });
      }

      totalFilesFound += unitFiles.length;
      scannedUnits.push({
        ...unit,
        files: unitFiles
      });
    }

    return {
      subjectId,
      units: scannedUnits,
      totalFiles: totalFilesFound
    };
  }
}
