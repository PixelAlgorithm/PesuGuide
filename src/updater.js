/**
 * Update checker
 * Polls the GitHub Releases API on a schedule (see background.js) and caches
 * the result in chrome.storage.local so the popup can show it instantly.
 * Unpacked extensions cannot self-install, so "update" means: detect, notify,
 * and fetch the release ZIP for the user to reload.
 */
export const UPDATE_CONFIG = {
  REPO: 'PixelAlgorithm/PesuGuide',
  STORAGE_KEY: 'pesu_update_info',
  DISMISSED_KEY: 'pesu_update_dismissed',
  ALARM_NAME: 'pesu_update_check',
  CHECK_EVERY_MINUTES: 360,        // 6h
  MIN_GAP_MS: 30 * 60 * 1000       // never hit the API more than every 30 min
};

export function isNewerVersion(remote, current) {
  if (!remote || !current) return false;
  const norm = (v) => String(v).replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const r = norm(remote);
  const c = norm(current);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    if ((r[i] || 0) > (c[i] || 0)) return true;
    if ((r[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

export function currentVersion() {
  return chrome.runtime.getManifest().version;
}

export async function getUpdateInfo() {
  const data = await chrome.storage.local.get([UPDATE_CONFIG.STORAGE_KEY, UPDATE_CONFIG.DISMISSED_KEY]);
  const info = data[UPDATE_CONFIG.STORAGE_KEY] || null;
  const dismissed = data[UPDATE_CONFIG.DISMISSED_KEY] || null;
  if (!info) return { info: null, available: false, dismissed: false };
  const available = isNewerVersion(info.version, currentVersion());
  return { info, available, dismissed: available && dismissed === info.version };
}

export async function dismissUpdate(version) {
  await chrome.storage.local.set({ [UPDATE_CONFIG.DISMISSED_KEY]: version });
}

/**
 * Query GitHub. Returns {ok, available, info, error?}. `force` skips the
 * min-gap throttle (used by the manual "Check now" button).
 */
export async function checkForUpdate({ force = false } = {}) {
  const cached = (await chrome.storage.local.get(UPDATE_CONFIG.STORAGE_KEY))[UPDATE_CONFIG.STORAGE_KEY];
  if (!force && cached && Date.now() - (cached.checkedAt || 0) < UPDATE_CONFIG.MIN_GAP_MS) {
    return { ok: true, cached: true, available: isNewerVersion(cached.version, currentVersion()), info: cached };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_CONFIG.REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    });
    if (res.status === 404) {
      // No release published yet is not an error
      const info = { version: currentVersion(), tag: `v${currentVersion()}`, checkedAt: Date.now() };
      await chrome.storage.local.set({ [UPDATE_CONFIG.STORAGE_KEY]: info });
      return { ok: true, available: false, info };
    }
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);

    const release = await res.json();
    const tag = release.tag_name || '';
    const zip = (release.assets || []).find(a => /\.zip$/i.test(a.name));
    const info = {
      version: tag.replace(/^v/i, '').trim(),
      tag,
      name: release.name || tag,
      notes: (release.body || '').slice(0, 600),
      htmlUrl: release.html_url,
      zipUrl: zip ? zip.browser_download_url : release.zipball_url,
      zipName: zip ? zip.name : `PesuGuide-${tag}.zip`,
      publishedAt: release.published_at,
      checkedAt: Date.now()
    };
    await chrome.storage.local.set({ [UPDATE_CONFIG.STORAGE_KEY]: info });
    return { ok: true, available: isNewerVersion(info.version, currentVersion()), info };
  } catch (err) {
    return { ok: false, available: false, error: err.message, info: cached || null };
  }
}

/** Reflect update state on the toolbar icon. */
export async function applyBadge() {
  const { available, dismissed } = await getUpdateInfo();
  try {
    if (available && !dismissed) {
      await chrome.action.setBadgeText({ text: 'NEW' });
      await chrome.action.setBadgeBackgroundColor({ color: '#E8590C' });
      await chrome.action.setTitle({ title: 'PesUGuide — update available' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: 'PesUGuide' });
    }
  } catch {}
}

/** Create the periodic alarm (idempotent). */
export async function scheduleUpdateChecks() {
  const existing = await chrome.alarms.get(UPDATE_CONFIG.ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(UPDATE_CONFIG.ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: UPDATE_CONFIG.CHECK_EVERY_MINUTES
    });
  }
}

/** Run a scheduled check; notify once per new version. */
export async function runScheduledCheck() {
  const result = await checkForUpdate();
  await applyBadge();
  if (!result.ok || !result.available) return result;

  const key = 'pesu_update_notified';
  const notified = (await chrome.storage.local.get(key))[key];
  if (notified !== result.info.version) {
    await chrome.storage.local.set({ [key]: result.info.version });
    try {
      chrome.notifications.create('pesu_update', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `PesUGuide ${result.info.tag} is available`,
        message: `You have v${currentVersion()}. Open PesUGuide to download the update.`,
        priority: 1
      });
    } catch {}
  }
  return result;
}
