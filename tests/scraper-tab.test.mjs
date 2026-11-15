import assert from 'node:assert/strict';

// Simulated browser: one PESU tab that the user navigates to YouTube after 2 calls.
let tabs = [{ id: 1, url: 'https://www.pesuacademy.com/Academy/s/studentProfilePESU', active: true, status: 'complete', discarded: false }];
let calls = 0, created = [], removed = [], updates = [];
globalThis.chrome = {
  tabs: {
    get: async (id) => { const t = tabs.find(t => t.id === id); if (!t) throw new Error('No tab'); return { ...t }; },
    query: async () => tabs.filter(t => /pesuacademy/.test(t.url)).map(t => ({ ...t })),
    create: async ({ url, active }) => { const t = { id: 100 + created.length, url, active, status: 'complete', discarded: false }; tabs.push(t); created.push(t.id); return { ...t }; },
    remove: async (id) => { removed.push(id); tabs = tabs.filter(t => t.id !== id); },
    update: async (id, props) => { updates.push([id, props]); },
    reload: async () => {}
  },
  scripting: {
    executeScript: async ({ target, func, args }) => {
      const t = tabs.find(x => x.id === target.tabId);
      if (!t || !/pesuacademy/.test(t.url)) throw new Error('Cannot access contents of url');
      const src = func.toString();
      if (src.includes('window.$ && window.$.ajax')) return [{ result: true }];
      calls++;
      if (calls === 3 && target.tabId === 1) {
        // user navigates away while this call is in flight
        t.url = 'https://www.youtube.com/';
        return [{ result: undefined }];
      }
      return [{ result: [{ ok: target.tabId, args }] }];
    }
  }
};

const { PesuScraper } = await import('../src/pesu-scraper.js');
const sc = new PesuScraper({ keepAlive: true });
const fn = (x) => x;
const r1 = await sc.executeInMainWorld(fn, ['a']);
const r2 = await sc.executeInMainWorld(fn, ['b']);
const r3 = await sc.executeInMainWorld(fn, ['c']); // tab navigates away during this one
const r4 = await sc.executeInMainWorld(fn, ['d']);
assert.equal(r1[0].ok, 1); assert.equal(r2[0].ok, 1);
assert.equal(created.length, 1, 'opened a background PESU tab');
assert.equal(r3[0].ok, created[0], 'retried on the new tab');
assert.equal(r4[0].ok, created[0]);
assert.ok(updates.some(([id, p]) => id === 1 && p.autoDiscardable === false), 'pinned original tab');
await sc.release();
assert.deepEqual(removed, [created[0]], 'helper tab closed after run');
assert.ok(updates.some(([id, p]) => id === 1 && p.autoDiscardable === true), 'unpinned');

// popup scraper (no keepAlive) must never open tabs
tabs = [];
const popupScraper = new PesuScraper();
await assert.rejects(() => popupScraper.executeInMainWorld(fn, []), /No PESU Academy tab/);
assert.equal(created.length, 1);
console.log('scraper tab recovery tests passed');

// Frozen tab: executeScript never settles. Must time out and move on.
{
  const realSetTimeout = globalThis.setTimeout;
  // speed up: shrink long timers
  globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms, 50), ...a);
  tabs = [{ id: 7, url: 'https://www.pesuacademy.com/Academy/s/studentProfilePESU', active: false, status: 'complete', discarded: false }];
  const origExec = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (opts) => {
    if (opts.target.tabId === 7 && !opts.func.toString().includes('window.$ && window.$.ajax')) return new Promise(() => {}); // hang
    return origExec(opts);
  };
  const sc2 = new PesuScraper({ keepAlive: true });
  const r = await sc2.executeInMainWorld((x) => x, ['z']);
  assert.notEqual(r[0].ok, 7, 'moved off the frozen tab');
  // transient AJAX error is retried
  let n = 0;
  chrome.scripting.executeScript = async (opts) => {
    if (opts.func.toString().includes('window.$ && window.$.ajax')) return [{ result: true }];
    n++; return [{ result: n < 2 ? { error: 'HTTP 0 timeout', retry: true } : ['ok'] }];
  };
  const r2 = await sc2.executeInMainWorld((x) => x, []);
  assert.deepEqual(r2, ['ok']);
  await sc2.release();
  globalThis.setTimeout = realSetTimeout;
  console.log('frozen-tab + retry tests passed');
}
