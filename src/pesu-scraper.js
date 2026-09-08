/**
 * PESU Academy API & DOM Scraper
 * Executes in world: 'MAIN' directly inside the PESU Academy webpage
 * so that jQuery (window.$), CSRF tokens, and session cookies are 100% native and identical.
 */
import { CONFIG } from './config.js';

export class PesuScraper {
  constructor() {
    this.csrfToken = null;
  }

  /**
   * Find an active or open PESU Academy tab
   */
  async getPesuTab() {
    try {
      const tabs = await chrome.tabs.query({ url: '*://www.pesuacademy.com/*' });
      if (tabs && tabs.length > 0) {
        // Return active tab if it matches, or studentProfile tab, or first tab
        const activeTab = tabs.find(t => t.active && t.url.includes('pesuacademy.com'));
        const profileTab = tabs.find(t => t.url.includes('/s/studentProfile'));
        return activeTab || profileTab || tabs[0];
      }
    } catch (e) {
      console.warn('Could not query tabs:', e);
    }
    return null;
  }

  /**
   * Execute function in the MAIN world of the active PESU Academy tab
   */
  async executeInMainWorld(func, args = []) {
    const tab = await this.getPesuTab();
    if (!tab) {
      throw new Error('No PESU Academy tab found. Please open PESU Academy in Chrome.');
    }

    if (typeof chrome.scripting !== 'undefined' && chrome.scripting.executeScript) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func,
        args
      });

      if (!results || results.length === 0) {
        throw new Error('Script execution in PESU Academy tab failed.');
      }

      const result = results[0].result;
      if (result && result.error) {
        throw new Error(result.error);
      }
      return result;
    }

    // Context fallback (e.g. from offscreen worker)
    const response = await chrome.runtime.sendMessage({
      action: 'EXECUTE_PESU_SCRIPT',
      tabId: tab.id,
      funcStr: func.toString(),
      args
    });

    if (response && response.error) {
      throw new Error(response.error);
    }
    return response ? response.result : null;
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
            resolve({ error: `Failed to load units: ${err || status}` });
          }
        });
      });
    }, [subjectId]);
  }

  /**
   * Get all classes for a specific unit
   */
  async getUnitClasses(unitContentId, subjectId) {
    return await this.executeInMainWorld((uContentId, subId) => {
      return new Promise((resolve) => {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content ||
                     (window.$ && $.ajaxSettings?.headers ? $.ajaxSettings.headers['X-CSRF-Token'] : '');

        window.$.ajax({
          url: 'https://www.pesuacademy.com/Academy/s/studentProfilePESUAdmin',
          type: 'GET',
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
            if (typeof html === 'string' && (html.includes('No information available') || html.includes('No subjects found'))) {
              return resolve([]);
            }
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const rows = Array.from(doc.querySelectorAll('tbody tr'));

            const classes = [];
            for (const row of rows) {
              const className = row.cells[0]?.innerText.trim() || 'Untitled Class';
              
              // Find any link that invokes handleclasscoursecontentunit for type = 2 (Slides)
              const links = Array.from(row.querySelectorAll('a[onclick*="handleclasscoursecontentunit"]'));
              for (const a of links) {
                const onclick = a.getAttribute('onclick') || '';
                const m = onclick.match(/handleclasscoursecontentunit\s*\(\s*['"]?([^'",]+)['"]?\s*,\s*['"]?([^'",]+)['"]?\s*,\s*['"]?([^'",]+)['"]?\s*,\s*['"]?([^'",]+)['"]?\s*,\s*2\b/);
                if (m) {
                  const count = parseInt(a.innerText.replace(/\D/g, ''), 10) || 0;
                  if (count > 0) {
                    classes.push({
                      className,
                      courseunitid: m[1],
                      subjectid: m[2],
                      coursecontentid: m[3],
                      classNo: m[4],
                      slideCount: count
                    });
                  }
                }
              }
            }
            resolve(classes);
          },
          error: (xhr, status, err) => {
            resolve([]);
          }
        });
      });
    }, [unitContentId, subjectId]);
  }

  /**
   * Get all slide files for a specific class
   */
  async getClassSlideFiles(classInfo) {
    return await this.executeInMainWorld((cls) => {
      return new Promise((resolve) => {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content ||
                     (window.$ && $.ajaxSettings?.headers ? $.ajaxSettings.headers['X-CSRF-Token'] : '');

        window.$.ajax({
          url: 'https://www.pesuacademy.com/Academy/s/studentProfilePESUAdmin',
          type: 'GET',
          data: {
            controllerMode: 6403,
            actionType: 60,
            selectedData: cls.subjectid,
            id: 2,
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
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Search within slide container or fallback to body
            const container = doc.querySelector('.content-type-area') || doc.body;
            const candidateLinks = Array.from(
              container.querySelectorAll('a, [onclick*="loadIframe"], [onclick*="downloadcoursedoc"], [onclick*="window.open"], [data-url]')
            );

            const files = [];
            const seenUrls = new Set();
            let linkIndex = 0;

            for (const a of candidateLinks) {
              // Clean Title
              let title = (a.innerText || a.getAttribute('title') || '').trim();
              title = title
                .replace(/[\uE000-\uF8FF]/g, '')
                .replace(/[›»><]/g, '')
                .replace(/\s+/g, ' ')
                .trim();

              // Skip obvious navigation links (e.g. "Back to Units", "Previous", "Next")
              if (
                !title ||
                /^(back\s+to\s+units|back|previous|next)$/i.test(title) ||
                (a.className && /back_link|lefttogglemenulink/i.test(a.className))
              ) {
                continue;
              }

              const onclick = a.getAttribute('onclick') || '';
              const href = (a.getAttribute('href') || '').trim();
              const dataUrl = (a.getAttribute('data-url') || a.getAttribute('data-href') || '').trim();

              if (onclick.includes('handleclassUnit') || onclick.includes('toggleLeftSideMenu')) {
                continue;
              }

              let path = '';
              let docId = '';

              // Case A: loadIframe('path', 'docId')
              const iframeMatch = onclick.match(/loadIframe\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
              if (iframeMatch) {
                path = iframeMatch[1].split('#')[0];
                docId = iframeMatch[2];
              }

              // Case B: downloadcoursedoc(id) / downloadcoursedocforstudent(id)
              if (!path) {
                const docMatch = onclick.match(/downloadcoursedoc(?:forstudent)?\s*\(\s*['"]?(\d+)['"]?\s*\)/);
                if (docMatch) {
                  docId = docMatch[1];
                  path = `/Academy/s/studentProfilePESUAdmin/downloadcoursedoc/${docId}`;
                }
              }

              // Case C: window.open('url', ...) or location.href = 'url'
              if (!path) {
                const winOpenMatch = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/);
                if (winOpenMatch) {
                  path = winOpenMatch[1];
                } else {
                  const locMatch = onclick.match(/(?:location\.href|location\.assign)\s*=\s*['"]([^'"]+)['"]/);
                  if (locMatch) {
                    path = locMatch[1];
                  }
                }
              }

              // Case D: Direct href link
              if (!path && href && !href.startsWith('javascript:') && href !== '#' && !href.startsWith('#')) {
                path = href;
              }

              // Case E: data-url attribute
              if (!path && dataUrl && !dataUrl.startsWith('javascript:')) {
                path = dataUrl;
              }

              if (!path) {
                continue;
              }

              // Normalize target URL
              let fullUrl = path;
              if (path.startsWith('//')) {
                fullUrl = `https:${path}`;
              } else if (path.startsWith('/')) {
                fullUrl = `https://www.pesuacademy.com${path}`;
              } else if (!/^https?:\/\//i.test(path)) {
                fullUrl = `https://www.pesuacademy.com/Academy/s/${path}`;
              }

              // Convert Google Drive links to direct download
              const gDriveFileMatch = fullUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
              if (gDriveFileMatch) {
                fullUrl = `https://drive.google.com/uc?export=download&id=${gDriveFileMatch[1]}&confirm=t`;
                if (!docId) docId = `gdrive_${gDriveFileMatch[1]}`;
              } else {
                const gDriveIdMatch = fullUrl.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
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
                title: title || `Slide Document ${linkIndex}`,
                className: cls.className,
                relativeUrl: path,
                fullUrl: fullUrl
              });
            }

            resolve(files);
          },
          error: (xhr, status, err) => {
            resolve({ error: `Failed to load slide links: ${err || status}` });
          }
        });
      });
    }, [classInfo]);
  }

  /**
   * Discovers the entire hierarchy of slides for a subject
   */
  async scanSubjectSlides(subjectId, selectedUnitNumbers = null, onProgress = null) {
    const units = await this.getUnits(subjectId);
    if (!Array.isArray(units)) {
      if (units && units.error) {
        throw new Error(units.error);
      }
      return { subjectId, units: [], totalFiles: 0 };
    }

    const targetUnits = selectedUnitNumbers 
      ? units.filter(u => selectedUnitNumbers.includes(u.unitNumber))
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

      const classes = await this.getUnitClasses(unit.unitContentId, subjectId);
      const unitFiles = [];
      const seenDocIds = new Set();

      if (Array.isArray(classes) && classes.length > 0) {
        for (const cls of classes) {
          const files = await this.getClassSlideFiles(cls);
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
