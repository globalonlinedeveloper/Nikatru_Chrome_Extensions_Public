/* Shared REAL-BROWSER harness for the redaction-claim suite.

   Everything in here exists because REDACTION-CLAIM-SPEC.md §6.3 says the
   claim assertions cannot live in the fake DOM: a sim fixture's text and its
   rect are two fields of the same literal, so a text-vs-geometry check there
   compares the author's assumption against itself. Real layout is the only
   independent second opinion. So: real Chromium, real extension, real record.

   This file deliberately does NOT read any extension source. The record shape
   it looks for is the one the SPEC promises (§3.9.1) — `shot.redaction =
   { v, state, pixels, scan, bake, kinds }`. If the implementation lands it
   somewhere else, `readRecord()` prints every top-level key it did find, and
   `SHOT_LEDGER_PATH` below is the single line that needs changing.
*/
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = path.resolve(__dirname, '..', '..');
export const FIXTURE_DIR = path.join(__dirname, 'fixtures');
export const OUT_DIR = path.join(__dirname, 'out');

/* The one place the record shape is named. §3.9.1. */
export const SHOT_LEDGER_PATH = 'redaction';

/* ---------------- verdicts ---------------- */
/* Three kinds on purpose.
   PASS/FAIL  — the spec says what must happen; graded.
   OPEN       — the spec is silent or ambiguous for this shape. Recorded and
                printed, never graded. A check that quietly downgrades itself
                to "skipped" is the same disease as a claim that quietly
                downgrades itself to "baked": it reports success it did not
                earn. OPEN is loud and it is not success. */
export const results = { pass: 0, fail: 0, open: 0, fails: [], opens: [], census: [] };

let group = '';
export function begin(name, spec) {
  group = name;
  console.log('\n=== ' + name + (spec ? '   [' + spec + ']' : '') + ' ===');
}
export function check(label, ok, extra) {
  if (ok) results.pass++;
  else { results.fail++; results.fails.push(group + ' :: ' + label + (extra != null ? '  — ' + extra : '')); }
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
}
export function open(label, extra) {
  results.open++;
  results.opens.push(group + ' :: ' + label + (extra != null ? '  — ' + extra : ''));
  console.log('  OPEN  ' + label + (extra != null ? '  — ' + extra : ''));
}
export function note(text) { console.log('        ' + text); }

/* ---------------- static server ----------------
   Own server rather than run.mjs's, for one reason: E3 needs a document Chrome
   will wrap in a synthetic <pre>, which means a real `text/plain` content-type
   off the wire. A MIME table keyed only on .html/.js/.css/.png cannot express
   that fixture at all. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8'
};
export function serve(dir, port) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const file = path.join(dir, decodeURIComponent(url.pathname));
      if (!path.resolve(file).startsWith(path.resolve(dir))) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, {
          'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-store'
        });
        res.end(data);
      });
    });
    srv.listen(port, () => resolve(srv));
  });
}

/* ---------------- test build of the extension ----------------
   Same reasoning as run.mjs: the shipped manifest uses activeTab, which a test
   driver has no gesture to trigger. Engine code is byte-identical; only the
   manifest differs. */
export function prepareTestExtension() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-claim-ext-'));
  fs.cpSync(EXT_DIR, tmp, {
    recursive: true,
    filter: src => !src.includes('node_modules') &&
                   !src.includes(path.join('e2e', 'out')) &&
                   !src.includes(path.join('pixel-sim', 'out'))
  });
  const mfPath = path.join(tmp, 'manifest.json');
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  mf.permissions = Array.from(new Set([...(mf.permissions || []), 'tabs']));
  mf.host_permissions = ['<all_urls>'];
  delete mf.optional_host_permissions;
  fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
  return tmp;
}

export async function setSettings(sw, patch) {
  await sw.evaluate(async (p) => { await chrome.storage.sync.set(p); }, patch);
}

/* ---------------- ledger accessors ----------------
   Tolerant about *absence* (the whole suite is expected red before the
   implementation lands) and intolerant about *shape*: a missing counter reads
   as `undefined`, never as 0, so `x === 0` is false and the check fails. A
   default of 0 would turn "the implementation never wrote this" into "the
   implementation wrote a clean zero", which is proxy-shaped. */
export const num = v => (typeof v === 'number' && isFinite(v)) ? v : undefined;
export function sumOf(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  let t = 0;
  for (const k of Object.keys(obj)) {
    if (k === 'total') continue;
    const v = obj[k];
    if (typeof v === 'number') t += v;
    else if (typeof v === 'boolean') t += v ? 1 : 0;
    else return undefined;
  }
  return t;
}
/* `declined.total` / `unplaced.total` per §2.6 — accept an explicit total, else
   sum the named clauses. */
export function totalOf(obj) {
  if (obj && typeof obj.total === 'number') return obj.total;
  return sumOf(obj);
}

/* ---------------- one capture ---------------- */
/*  colours: { name: [r,g,b] }  — counted across EVERY segment, in-page, so a
    30,000-px capture never crosses the CDP boundary as base64. Segment 0 is
    still written to out/ so a human can look at it. */
export async function capture(ctx, sw, name, url, colours = {}, opts = {}) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForTimeout(opts.settleMs || 1000);

  const resultPromise = ctx.waitForEvent('page', {
    predicate: p => p.url().includes('pages/result.html'),
    timeout: opts.timeout || 240000
  });
  resultPromise.catch(() => {});

  await sw.evaluate(async (pageUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url === pageUrl) ||
                tabs.find(t => (t.url || '').startsWith('http'));
    if (!tab) throw new Error('test tab not found; open tabs: ' +
      JSON.stringify(tabs.map(t => t.url)));
    await chrome.tabs.update(tab.id, { active: true });
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
    await new Promise(r => setTimeout(r, 300));
    const r = await startCapture(tab, 'full', 0);
    if (!r || !r.ok) throw new Error('startCapture failed: ' + (r && r.error));
  }, url);

  const resultPage = await resultPromise;
  await resultPage.waitForSelector('#view:not([hidden])', { timeout: opts.timeout || 240000 });
  /* Let the result page finish rendering its own furniture before the
     permanent-line read. §3.9.2 distinguishes the permanent line from the
     12-second toast, so the line must survive this settle. */
  await resultPage.waitForTimeout(opts.lineSettleMs || 2500);

  const rec = await readRecord(resultPage);
  const surfaces = await readSurfaces(resultPage);
  const pix = await countColours(resultPage, colours, opts.tol || 20);
  await saveFirstSegment(resultPage, name);

  /* what the page itself says is visible — the second term §3.3/§7.4 want, and
     the magnitude measurement E16 asks for. */
  let truth = null;
  try {
    await page.bringToFront();
    truth = await page.evaluate(() => ({
      innerTextLen: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
      textContentLen: (document.body.textContent || '').replace(/\s+/g, ' ').trim().length,
      /* fixtures that need to report what they did and when (late-inject) */
      fixture: (() => { try { return JSON.parse(JSON.stringify(window.__fsFixture || null)); } catch (_) { return null; } })()
    }));
  } catch (_) { /* text/plain and friends: not every fixture has a body we can read */ }

  await resultPage.close();
  await page.close();
  return { rec, surfaces, pix, truth };
}

async function readRecord(resultPage) {
  return resultPage.evaluate(async (LEDGER_KEY) => {
    const id = new URLSearchParams(location.search).get('id');
    const shot = await FSDB.get('shots', id);
    const plain = v => { try { return JSON.parse(JSON.stringify(v ?? null)); } catch (_) { return '<unserialisable>'; } };
    const topKeys = Object.keys(shot);
    return {
      id,
      topKeys,
      /* the spec's location */
      ledger: plain(shot[LEDGER_KEY]),
      /* diagnostics for the day the implementation names it something else */
      candidates: topKeys.filter(k => /redact|pii|ledger|scan|bake|claim|evidence/i.test(k)),
      meta: plain(shot.meta),
      segments: shot.segments ? shot.segments.length : 0,
      mode: shot.mode || (shot.meta && shot.meta.mode) || null
    };
  }, SHOT_LEDGER_PATH);
}

/* The user-facing surfaces. Two hooks are asserted by name — see the report:
   the spec fixes the SENTENCES (§3.2–3.6a) and makes them amendable only in
   the spec (§3.7), but never fixes a DOM contract for "the permanent line" vs
   "the toast". Without one, e2e and a11y-sim grade different things. */
async function readSurfaces(resultPage) {
  return resultPage.evaluate(() => {
    const txt = el => el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : null;
    /* The spec fixes the SENTENCES (§3.2-3.6a) and puts them under an
       amendment rule (§3.7), but never fixes a DOM contract for "the permanent
       line" vs "the 12-second toast" — and §3.9.2 makes the difference between
       them load-bearing. These selectors are what the implementation chose;
       `usedHook` reports which one matched so a rename shows up as a rename
       rather than as a silent downgrade to the bodyText fallback. */
    const LINE_SEL = '[data-fs-redaction-line], #redactLine, .redactline';
    const TOAST_SEL = '[data-fs-redaction-toast], #fs-toast, [class*="toast"]';
    const line = document.querySelector(LINE_SEL);
    const toast = document.querySelector(TOAST_SEL);
    const shown = el => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      if (el.hasAttribute('hidden')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !!txt(el);
    };
    /* heuristic sweep, printed as OPEN so a missing hook is diagnosable */
    const smells = Array.from(document.querySelectorAll('[role="status"],[role="alert"],[class*="toast"],[class*="redact"],[id*="redact"]'))
      .map(el => ({ sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''), text: txt(el) }))
      .filter(x => x.text);
    /* Deepest text hosts. The §3.7 toast column needs "how many distinct
       elements are currently showing this sentence" — one is the permanent
       line, two is the line plus the toast — and that can be counted without
       knowing the extension's toast implementation. */
    const blocks = Array.from(document.querySelectorAll('body *'))
      .map(el => ({ el, t: txt(el) }))
      .filter(x => x.t && x.t.length <= 600)
      .filter(x => !Array.from(x.el.children).some(c => txt(c) === x.t))
      .slice(0, 300)
      .map(x => ({
        tag: x.el.tagName.toLowerCase(),
        id: x.el.id || '',
        cls: (typeof x.el.className === 'string' ? x.el.className.trim() : ''),
        role: x.el.getAttribute('role') || '',
        live: x.el.getAttribute('aria-live') || '',
        text: x.t
      }));
    const sig = el => el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '') : null;
    return {
      hasLineHook: !!line,
      hasToastHook: !!toast,
      lineSig: sig(line),
      toastSig: sig(toast),
      lineShown: shown(line),
      toastShown: shown(toast),
      lineText: txt(line),
      toastText: txt(toast),
      bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
      blocks,
      smells,
      mutationLog: (window.__fsMutLog || null)
    };
  });
}

async function countColours(resultPage, colours, tol) {
  const names = Object.keys(colours);
  if (!names.length) return { rows: {}, width: 0, height: 0 };
  return resultPage.evaluate(async ({ names, list, tol }) => {
    const id = new URLSearchParams(location.search).get('id');
    const shot = await FSDB.get('shots', id);
    const rows = {}; names.forEach(n => rows[n] = 0);
    let W = 0, H = 0;
    for (const seg of shot.segments) {
      const bmp = await createImageBitmap(seg.blob);
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0);
      const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
      W = Math.max(W, bmp.width); H += bmp.height;
      for (let y = 0; y < bmp.height; y++) {
        const hit = new Array(list.length).fill(false);
        let left = list.length;
        for (let x = 0; x < bmp.width && left > 0; x += 4) {
          const o = (y * bmp.width + x) * 4;
          for (let i = 0; i < list.length; i++) {
            if (hit[i]) continue;
            const c = list[i];
            if (Math.abs(d[o] - c[0]) <= tol && Math.abs(d[o + 1] - c[1]) <= tol && Math.abs(d[o + 2] - c[2]) <= tol) {
              hit[i] = true; left--;
            }
          }
        }
        for (let i = 0; i < list.length; i++) if (hit[i]) rows[names[i]]++;
      }
      bmp.close();
    }
    return { rows, width: W, height: H };
  }, { names, list: names.map(n => colours[n]), tol });
}

async function saveFirstSegment(resultPage, name) {
  try {
    const b64 = await resultPage.evaluate(async () => {
      const id = new URLSearchParams(location.search).get('id');
      const shot = await FSDB.get('shots', id);
      const bytes = new Uint8Array(await shot.segments[0].blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      return btoa(s);
    });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'claim-' + name + '.png'), Buffer.from(b64, 'base64'));
  } catch (_) { /* the image is a diagnostic, not an assertion */ }
}

/* Records every node the result page adds after load, so a transient toast is
   observable without knowing the extension's toast implementation. */
export const MUTATION_PROBE = `
(() => {
  if (window.__fsMutLog) return;
  const log = window.__fsMutLog = [];
  const start = Date.now();
  try {
    new MutationObserver(recs => {
      for (const r of recs) for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        const t = (n.innerText || n.textContent || '').replace(/\\s+/g,' ').trim();
        if (t) log.push({ at: Date.now() - start, text: t.slice(0, 400), tag: n.tagName });
      }
    }).observe(document.documentElement || document, { childList: true, subtree: true });
  } catch (e) {}
})();`;
