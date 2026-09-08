/**
 * Content Script for PESU Academy
 * Injected directly into https://www.pesuacademy.com/*
 * Acts as a bridge between the extension popup and the live page session.
 */

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CHECK_LOGIN') {
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

    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content ||
                      document.querySelector('meta[name="_csrf"]')?.content ||
                      (window.$ && $.ajaxSettings?.headers ? $.ajaxSettings.headers['X-CSRF-Token'] : null);

    sendResponse({
      loggedIn: isDashboard && !isLoginPage,
      isLoginPage,
      isDashboard,
      url: window.location.href,
      title: document.title,
      hasCsrf: !!csrfToken
    });
    return true;
  }

  if (request.action === 'AJAX_CALL') {
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content ||
                 document.querySelector('meta[name="_csrf"]')?.content ||
                 (window.$ && $.ajaxSettings?.headers ? $.ajaxSettings.headers['X-CSRF-Token'] : '');

    const endpoint = request.url.startsWith('http') 
      ? request.url 
      : `https://www.pesuacademy.com/Academy/s/${request.url.replace(/^\/?(Academy\/)?(s\/)?/, '')}`;

    if (window.$) {
      window.$.ajax({
        url: endpoint,
        type: request.method || 'GET',
        data: request.data || {},
        headers: {
          'X-CSRF-Token': csrf,
          'X-Requested-With': 'XMLHttpRequest'
        },
        success: (data) => {
          if (typeof data === 'string' && (data.includes('Invalid CSRF Token') || data.includes('Session Expired') || data.includes('Sign in'))) {
            sendResponse({ success: false, error: 'Session expired. Please re-login to PESU Academy.' });
          } else {
            sendResponse({ success: true, data });
          }
        },
        error: (xhr, status, err) => {
          sendResponse({
            success: false,
            status: xhr.status,
            error: xhr.status === 401 || xhr.status === 403 
              ? 'Session expired. Please re-login.' 
              : `HTTP ${xhr.status}: ${err || status}`
          });
        }
      });
    } else {
      // Fetch fallback
      fetch(endpoint, {
        method: request.method || 'GET',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': csrf,
          'X-Requested-With': 'XMLHttpRequest',
          ...(request.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
        },
        body: request.method === 'POST' ? new URLSearchParams(request.data).toString() : undefined
      })
      .then(res => res.text())
      .then(text => {
        if (text.includes('Invalid CSRF Token') || text.includes('Sign in')) {
          sendResponse({ success: false, error: 'Session expired. Please re-login to PESU Academy.' });
        } else {
          sendResponse({ success: true, data: text });
        }
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    }

    return true; // Keep message channel open for async response
  }
});
