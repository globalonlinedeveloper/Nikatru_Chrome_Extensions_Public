/* FullShot store packaging. No browser, no dependencies, no build step.
   Builds both submission packages from the working tree and then GRADES what it
   built — a zip is only useful if every reference inside it resolves inside it.

     node publish/package.node.js            # build + verify
     node publish/package.node.js --verify   # verify the existing zips, build nothing

   Two packages, one source tree:
     fullshot-<ver>.zip           Chrome AND Edge (same Chromium MV3 package)
     fullshot-<ver>-firefox.zip   AMO candidate: manifest.firefox.json swapped in
                                  and background.js importScripts GUARDED, exactly
                                  as the 1.9.11 Firefox package was built by hand.

   The allowlist is positive, not a denylist: only the shipped extension surface
   goes in. Docs, tests, scratch files and publish/ itself can never be swept up
   by a stray glob, and the built file set is diffed against the previous release
   so a silently dropped file is caught.

   NOT one of the eight test tiers, and NOT the AMO submission gate — that is
   publish/verify-firefox-package.node.js, which is red by design until the owner
   sets a real gecko.id. This script exits non-zero only on a packaging or
   reference-integrity defect; the placeholder id is reported as a named owner
   action so the two scripts cannot disagree about what blocks a submission. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;

/* ---------------- the allowlist ---------------- */
/* Every file the browser loads, and nothing else. Extensions are pinned per
   directory so a new .md or .txt dropped into pages/ cannot ride along. */
/* `recurse` is opt-in per rule: a flat read is the right default for a directory
   of leaf assets, and the wrong one the moment a resource is NESTED. _locales is
   the first nested resource this tree has ever had — messages.json lives at
   _locales/<lang>/messages.json, one level below the rule's own directory — so a
   flat readdirSync of `_locales` returns only the language DIRECTORY NAMES, every
   one of which is then discarded by the extension test and the isFile() test.
   Adding the rule without the walk ships nothing and reports a cheerful
   "Allowlist: 30 files"; see the R12 note in verifyPackage. */
const ALLOW = [
  { dir: '.', exts: ['.json'], only: ['manifest.json'] },
  { dir: '.', exts: ['.js'], only: ['background.js'] },
  { dir: 'content', exts: ['.js'] },
  { dir: 'icons', exts: ['.png'] },
  { dir: 'pages', exts: ['.html', '.js', '.css'] },
  { dir: 'popup', exts: ['.html', '.js', '.css'] },
  { dir: '_locales', exts: ['.json'], only: ['messages.json'], recurse: true }
];

/* Belt and braces: even inside an allowed directory these never ship. */
const NEVER = /(^|\/)(node_modules|test|publish|\.[^/]*)(\/|$)|DELETE-ME|\.md$|\.zip$/i;

/* Depth is bounded rather than unlimited: an allowlist that follows a tree of
   unknown depth is a denylist wearing a hat, and a symlink loop would hang the
   build. Two levels is _locales/<lang>/messages.json with one to spare. */
const MAX_DEPTH = 3;

function walkRule(relDir, rule, depth, files) {
  const abs = relDir ? path.join(ROOT, relDir) : ROOT;
  for (const name of fs.readdirSync(abs).sort()) {
    const rel = relDir ? relDir + '/' + name : name;
    if (NEVER.test(rel)) continue;
    let st;
    try { st = fs.statSync(path.join(ROOT, rel)); } catch (_) { continue; }
    if (st.isDirectory()) {
      if (depth > 0) walkRule(rel, rule, depth - 1, files);
      continue;
    }
    if (!st.isFile()) continue;
    if (rule.only && !rule.only.includes(name)) continue;
    if (!rule.exts.includes(path.extname(name).toLowerCase())) continue;
    files.push(rel);
  }
}

/* ---------------- _locales is ALLOWLIST-ALWAYS (R12) ---------------- */
/* R12: "the packaging allowlist excludes underscore-prefixed paths, so the
   moment default_locale is set, _locales/ is silently dropped from the zip and
   the store rejects the package."

   The rule in ALLOW above is necessary but it is not SUFFICIENT, because it is
   still governed by a pattern language: it survives only while ALLOW keeps the
   entry, `recurse` stays true, MAX_DEPTH stays >= 2, and NEVER never grows a
   clause that happens to match a leading underscore. Four independent edits can
   each silently un-ship 55 locale directories, and every one of them looks
   innocent in review ("exclude dotfiles and underscore scratch dirs").

   So localisation does not go through the pattern language at all. This function
   enumerates the tree directly — no ALLOW entry, no NEVER test, no depth budget —
   and collect() unions it in unconditionally. There is no expressible value of
   ALLOW/NEVER/MAX_DEPTH that can drop a locale from the package.

   The generic rule is deliberately KEPT rather than deleted: the two paths are
   then independent implementations of the same claim, and verifyPackage reports
   any disagreement between them. R12 is now both impossible AND visible — if
   someone re-adds the underscore exclusion the zip stays correct and the build
   says so out loud, instead of the bug simply moving somewhere quieter. */
function localeMessageFiles() {
  const dir = path.join(ROOT, '_locales');
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
  return names.filter(e => e.isDirectory())
    .map(e => '_locales/' + e.name + '/messages.json')
    .filter(rel => { try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch (_) { return false; } })
    .sort();
}

/* What the pattern language ALONE would have collected — used only to report
   drift between the two paths, never to decide what ships. */
function localesViaAllowRules() {
  const files = [];
  for (const rule of ALLOW) {
    if (rule.dir !== '_locales') continue;
    if (!fs.existsSync(path.join(ROOT, rule.dir))) continue;
    walkRule(rule.dir, rule, rule.recurse ? MAX_DEPTH : 0, files);
  }
  return files.sort();
}

function collect() {
  const files = [];
  for (const rule of ALLOW) {
    if (!fs.existsSync(path.join(ROOT, rule.dir))) continue;
    walkRule(rule.dir === '.' ? '' : rule.dir, rule, rule.recurse ? MAX_DEPTH : 0, files);
  }
  for (const f of localeMessageFiles()) files.push(f);
  return [...new Set(files)].sort();
}

/* ---------------- the localisation gate (R12), at BUILD time ---------------- */
/* verifyPackage already refuses a zip whose default_locale has no messages.json.
   That is not enough on its own, because it runs AFTER writeZip: the artifact it
   condemns is the one now sitting on disk, and the last good one has already been
   overwritten. Reproduced in a sandbox by re-adding the underscore exclusion to
   NEVER — the build printed "Allowlist: 30 files", wrote BOTH zips with zero
   locales on top of the good ones, and only then reported 2 FAIL. The Firefox
   importScripts guard learned this same lesson ("refuse rather than degrade");
   localisation now gets the same treatment.

   Pure by design: it takes the collected file list and the parsed manifests and
   returns human-readable problems. The i18n tier calls it directly with synthetic
   inputs, so the gate itself is GRADED rather than trusted. */
function readManifests() {
  const read = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } };
  return [
    { label: 'manifest.json', mf: read(path.join(ROOT, 'manifest.json')) },
    { label: 'publish/manifest.firefox.json', mf: read(path.join(OUT, 'manifest.firefox.json')) }
  ];
}

function localeProblems(files, manifests, onDiskOverride) {
  const have = new Set(files);
  const onDisk = onDiskOverride || localeMessageFiles();
  const out = [];
  for (const { label, mf } of manifests) {
    if (!mf) { out.push(label + ' does not parse — cannot grade its localisation'); continue; }
    const dl = mf.default_locale;
    if (dl) {
      const need = '_locales/' + dl + '/messages.json';
      if (!onDisk.includes(need)) {
        out.push(label + ' sets default_locale "' + dl + '" but ' + need +
          ' is not in the working tree');
      } else if (!have.has(need)) {
        out.push(label + ' sets default_locale "' + dl + '" and the build did NOT collect ' + need +
          ' — the store rejects this upload outright (R12)');
      }
    } else if (onDisk.length) {
      out.push(label + ' sets no default_locale while the tree holds ' + onDisk.length +
        ' locale(s) — the store rejects "Localization used, but default_locale wasn\'t specified"');
    }
  }
  const dropped = onDisk.filter(f => !have.has(f));
  if (dropped.length) {
    out.push(dropped.length + ' of ' + onDisk.length + ' locale file(s) on disk were not collected: ' +
      dropped.slice(0, 6).join(', ') + (dropped.length > 6 ? ' +' + (dropped.length - 6) : '') +
      ' — those markets would silently receive the default locale');
  }
  return out;
}

/* ---------------- the Firefox background guard ---------------- */
/* Firefox runs background.js as an event-page script, where importScripts is
   undefined; pages/db.js and pages/batch.js arrive via background.scripts
   instead. Unguarded, the add-on throws on load. Anchored on the exact source
   text so a future edit to those two lines fails the build LOUDLY rather than
   quietly producing an add-on that cannot start. */
const GUARD_FROM = "importScripts('pages/db.js');\n" +
  "importScripts('pages/batch.js');   // v1.9.7: FSBatch pure core (queue/parse) in the worker\n";
const GUARD_TO = "// Cross-browser: Chrome runs this file as a SERVICE WORKER (importScripts is\n" +
  "// available). Firefox runs it as a background EVENT-PAGE script where\n" +
  "// importScripts is undefined and pages/db.js + pages/batch.js are instead\n" +
  "// loaded via the manifest background.scripts array. Guard so neither throws.\n" +
  "if (typeof importScripts === 'function') {\n" +
  "  importScripts('pages/db.js');\n" +
  "  importScripts('pages/batch.js');   // v1.9.7: FSBatch pure core (queue/parse) in the worker\n" +
  "}\n";

/* ---------------- minimal zip writer (deflate, deterministic) ---------------- */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* A fixed timestamp keeps the build reproducible: same inputs, same bytes. */
const DOS_TIME = 0x0000, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function writeZip(dest, entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    // Store instead of deflate when compression does not pay — same rule a
    // normal zipper uses, and it keeps tiny files byte-obvious.
    const useDeflate = deflated.length < e.data.length;
    const body = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(e.data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);

    offset += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(dest, Buffer.concat([Buffer.concat(locals), cdBuf, eocd]));
}

/* ---------------- minimal zip reader (verify what was written) ---------------- */
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const lNameLen = buf.readUInt16LE(lho + 26), lExtraLen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + size);
    out.set(name, method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/* ---------------- grading ---------------- */
let FAILS = 0;
const ACTIONS = [];
function check(label, ok, extra) {
  if (!ok) FAILS++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (extra ? '  — ' + extra : ''));
  return ok;
}
function action(who, text) { ACTIONS.push(who + ': ' + text); }

/* Every reference must resolve INSIDE the package, case-exact. A ref that only
   matches when case is ignored is a real defect: it loads on Windows and 404s on
   the reviewer's Linux box, which is the worst place to find out. */
function resolves(entries, ref, ctx, label) {
  const clean = String(ref).split('#')[0].split('?')[0].trim();
  if (!clean) return;
  if (/^(https?:|data:|blob:|chrome-extension:|moz-extension:|mailto:)/i.test(clean)) {
    // A self-contained extension has nothing to fetch. An absolute http(s) ref
    // would also break the zero-network promise the store listing makes.
    check(label + ' is package-local: ' + clean, false, ctx + ' points outside the package');
    return;
  }
  const base = ctx.includes('/') ? ctx.slice(0, ctx.lastIndexOf('/')) : '';
  const target = clean.startsWith('/')
    ? clean.slice(1)
    : path.posix.normalize((base ? base + '/' : '') + clean);
  if (entries.has(target)) { check(label + ' → ' + target, true); return; }
  const ci = [...entries.keys()].find(k => k.toLowerCase() === target.toLowerCase());
  check(label + ' → ' + target, false,
    ci ? 'CASE MISMATCH: package holds "' + ci + '"' : 'not in the package (' + ctx + ')');
}

function verifyPackage(zipPath, kind) {
  console.log('\n### ' + path.basename(zipPath) + '  (' + kind + ')');
  if (!fs.existsSync(zipPath)) { check('package exists', false, zipPath); return; }
  let entries;
  try { entries = readZip(zipPath); }
  catch (e) { check('package reads as a zip', false, e.message); return; }
  check('package reads as a zip', true, entries.size + ' entries');

  let mf;
  try { mf = JSON.parse(entries.get('manifest.json').toString('utf8')); }
  catch (e) { check('packaged manifest.json parses', false, e && e.message); return; }
  check('packaged manifest.json parses', true, 'v' + mf.version);

  /* --- manifest references --- */
  for (const [k, v] of Object.entries(mf.icons || {})) resolves(entries, v, 'manifest.json', 'icons.' + k);
  for (const [k, v] of Object.entries((mf.action && mf.action.default_icon) || {})) {
    resolves(entries, v, 'manifest.json', 'action.default_icon.' + k);
  }
  if (mf.action && mf.action.default_popup) resolves(entries, mf.action.default_popup, 'manifest.json', 'action.default_popup');
  if (mf.options_page) resolves(entries, mf.options_page, 'manifest.json', 'options_page');
  if (mf.options_ui && mf.options_ui.page) resolves(entries, mf.options_ui.page, 'manifest.json', 'options_ui.page');
  const bg = mf.background || {};
  if (bg.service_worker) resolves(entries, bg.service_worker, 'manifest.json', 'background.service_worker');
  (bg.scripts || []).forEach((s, i) => resolves(entries, s, 'manifest.json', 'background.scripts[' + i + ']'));
  (mf.content_scripts || []).forEach((cs, i) => {
    (cs.js || []).forEach(s => resolves(entries, s, 'manifest.json', 'content_scripts[' + i + '].js'));
    (cs.css || []).forEach(s => resolves(entries, s, 'manifest.json', 'content_scripts[' + i + '].css'));
  });

  /* --- localisation (R12) --- */
  /* The manifest-reference walker above knows about icons, popup, options_page,
     background and content_scripts — every reference that points at a FILE. It
     had no notion of default_locale, which points at a DIRECTORY TREE, so the one
     gate that exists to prove "every reference inside the zip resolves inside the
     zip" was blind to the single reference that actually blocks a submission:
     Chrome rejects the upload with "Localization used, but default_locale wasn't
     specified" — and, more confusingly, rejects a manifest that DECLARES
     default_locale while the _locales tree is absent. Both directions below.

     __MSG_key__ substitution is resolved by the browser at install time against
     the default locale, so an unresolved key ships a literal "__MSG_appName__"
     as the store listing's name. That is unrecoverable in public, so every key
     the manifest spends is resolved here against the packaged messages.json
     rather than trusted. */
  const localeDirs = [...entries.keys()]
    .map(k => /^_locales\/([^/]+)\/messages\.json$/.exec(k))
    .filter(Boolean).map(m => m[1]).sort();
  const msgRefs = [...new Set((JSON.stringify(mf).match(/__MSG_([A-Za-z0-9_@]+)__/g) || [])
    .map(s => s.slice(6, -2)))].sort();

  if (mf.default_locale) {
    const msgPath = '_locales/' + mf.default_locale + '/messages.json';
    const present = entries.has(msgPath);
    check('default_locale "' + mf.default_locale + '" → ' + msgPath, present,
      present ? localeDirs.length + ' locale(s) packaged'
        : 'NOT IN THE PACKAGE — the store rejects this upload');
    if (present) {
      let msgs = null;
      try { msgs = JSON.parse(entries.get(msgPath).toString('utf8')); }
      catch (e) { check('packaged ' + msgPath + ' parses', false, e && e.message); }
      if (msgs) {
        check('packaged ' + msgPath + ' parses', true, Object.keys(msgs).length + ' keys');
        const missing = msgRefs.filter(k => !Object.prototype.hasOwnProperty.call(msgs, k));
        check('every __MSG_*__ the manifest spends resolves in the default locale',
          missing.length === 0,
          missing.length ? 'UNRESOLVED: ' + missing.join(', ') + ' — would ship literally'
            : msgRefs.length + ' key(s): ' + msgRefs.join(', '));
      }
    }

    /* R12, the half nobody was watching. Every gate above asks "is the DEFAULT
       locale here?" and the answer was yes while 54 of 55 directories were
       missing from both shipped zips — because the tree grew from 1 locale to 55
       after the zips were built, and no check compares the package's locale SET
       against the tree's. A package that ships English to 54 markets is not
       rejected by the store; it is accepted, and it is silent. That is strictly
       worse than the rejection R12 is named for, and it was live and green.

       A hard FAIL rather than a stale-artifact ACTION: a missing default locale
       is a rejected upload and a missing non-default locale is a market served
       the wrong language, and neither is a matter of taste. The byte-level STALE
       reporter below stays an ACTION — stale BYTES are a release-process fact;
       an absent locale DIRECTORY is a packaging defect. */
    const treeLocales = localeMessageFiles()
      .map(f => f.split('/')[1]).sort();
    const absent = treeLocales.filter(l => !localeDirs.includes(l));
    const extra = localeDirs.filter(l => !treeLocales.includes(l));
    check('the package carries every locale the tree declares',
      absent.length === 0 && extra.length === 0,
      (absent.length || extra.length)
        ? localeDirs.length + '/' + treeLocales.length + ' packaged' +
          (absent.length ? '; SILENTLY DROPPED: ' + absent.slice(0, 8).join(', ') +
            (absent.length > 8 ? ' +' + (absent.length - 8) : '') : '') +
          (extra.length ? '; NOT IN THE TREE: ' + extra.join(', ') : '')
        : treeLocales.length + '/' + treeLocales.length + ' locales');

    /* Every packaged locale, not just the default. A locale whose messages.json
       does not parse is dead weight Chrome refuses to install; a locale missing a
       manifest key falls back per-key to the default, which is survivable but is
       exactly the drift the generator exists to prevent. */
    const badJson = [], keyGaps = [];
    for (const code of localeDirs) {
      let m = null;
      try { m = JSON.parse(entries.get('_locales/' + code + '/messages.json').toString('utf8')); }
      catch (e) { badJson.push(code); continue; }
      const gaps = msgRefs.filter(k => !Object.prototype.hasOwnProperty.call(m, k));
      if (gaps.length) keyGaps.push(code + ':' + gaps.join('/'));
    }
    check('every packaged messages.json parses', badJson.length === 0,
      badJson.join(', ') || localeDirs.length + ' files');
    check('every __MSG_*__ the manifest spends resolves in EVERY packaged locale',
      keyGaps.length === 0,
      keyGaps.slice(0, 5).join(' | ') || msgRefs.length + ' key(s) x ' + localeDirs.length + ' locales');

    /* 55 locales is not free and the owner is entitled to the number. */
    let locBytes = 0, allBytes = 0;
    for (const [k, v] of entries) { allBytes += v.length; if (k.startsWith('_locales/')) locBytes += v.length; }
    const kb = n => (n / 1024).toFixed(1) + ' KB';
    console.log('  SIZE   ' + path.basename(zipPath) + ': ' + kb(fs.statSync(zipPath).size) +
      ' on disk · ' + entries.size + ' entries · ' + kb(allBytes) + ' uncompressed, of which ' +
      kb(locBytes) + ' (' + Math.round(locBytes / allBytes * 100) + '%) is ' + localeDirs.length + ' locales');
  } else {
    // The inverse rejection: a _locales tree with no default_locale to anchor it.
    check('no _locales tree without a default_locale to anchor it', localeDirs.length === 0,
      localeDirs.length ? 'packaged ' + localeDirs.length + ' locale(s) but the manifest sets no default_locale'
        : 'no localisation in this package');
    check('manifest spends no __MSG_*__ without a default_locale', msgRefs.length === 0,
      msgRefs.length ? 'UNRESOLVABLE: ' + msgRefs.join(', ') : 'none');
  }

  /* --- every HTML page --- */
  let htmlCount = 0;
  for (const [name, data] of entries) {
    if (!name.endsWith('.html')) continue;
    htmlCount++;
    const html = data.toString('utf8');
    let m;
    const scriptRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    while ((m = scriptRe.exec(html))) resolves(entries, m[1], name, name + ' <script src>');
    const linkRe = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
    while ((m = linkRe.exec(html))) resolves(entries, m[1], name, name + ' <link href>');
    const imgRe = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    while ((m = imgRe.exec(html))) resolves(entries, m[1], name, name + ' <img src>');
  }
  check('every packaged HTML page was scanned', htmlCount > 0, htmlCount + ' pages');

  /* --- importScripts targets in every packaged script --- */
  let isCount = 0;
  for (const [name, data] of entries) {
    if (!name.endsWith('.js')) continue;
    const src = data.toString('utf8');
    const re = /importScripts\(\s*["']([^"']+)["']\s*\)/g;
    let m;
    while ((m = re.exec(src))) { isCount++; resolves(entries, m[1], name, name + ' importScripts'); }
  }
  // Was `check(..., true, ...)` — an assertion with no failure mode, which
  // printed PASS at "0 call(s)". The worker has two, on both builds.
  check('importScripts targets checked', isCount > 0, isCount + ' call(s)');

  /* --- the zero-network promise, in the JavaScript itself --- */
  /* Everything above only ever looks at manifest refs, HTML src/href and
     importScripts targets. Nothing read the packaged JavaScript, so a fetch()
     added to background.js or any pages/*.js would have shipped green through
     the whole gate. Zero network is the product's central, audited claim and
     the reason it needs no privacy disclosure at all, so the grep belongs in
     the same place that already enforces the rest of it. */
  const NET = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|SharedWorker)\s*\(|\bnavigator\s*\.\s*sendBeacon\b|importScripts\(\s*["']https?:/g;
  const netHits = [];
  let jsCount = 0;
  for (const [name, data] of entries) {
    if (!name.endsWith('.js')) continue;
    jsCount++;
    const found = data.toString('utf8').match(NET);
    if (found) netHits.push(name + ': ' + [...new Set(found)].join(', '));
  }
  check('no packaged script can reach the network', netHits.length === 0,
    netHits.join(' | ') || jsCount + ' scripts clean');

  /* --- nothing that must never ship --- */
  /* _locales is exempt because it is allowlist-ALWAYS: it deliberately does not
     go through NEVER, so grading it BY NEVER asks a question the collector never
     asked. Without the exemption, re-adding the R12 underscore clause produced a
     second, actively misleading failure — "no test/doc/scratch file leaked into
     the package — _locales/ar/messages.json" — naming 55 shipped locales as
     scratch files. A diagnostic that tells the owner a locale is junk is how the
     wrong thing gets deleted. The locale set has its own, better checks above. */
  const ALWAYS_SHAPE = /^_locales\/[^/]+\/messages\.json$/;
  const leaked = [...entries.keys()].filter(k => !ALWAYS_SHAPE.test(k) && NEVER.test(k));
  check('no test/doc/scratch file leaked into the package', leaked.length === 0, leaked.join(', ') || 'clean');

  /* --- CONTENT parity with the tree, not just version parity ---
     Everything above compares the zip against the MANIFEST. Nothing compared it
     against the CODE, so a zip built before sixteen shipped files were edited
     reported ALL PASS while carrying the old ones — and a zip built before 54
     locale directories appeared reported ALL PASS while shipping English to 54
     markets. Same shape as R12 twice over: the gate could not see that the
     resource had CHANGED, only that a named one existed.

     Reported as an owner action rather than a FAIL: a stale artifact is a
     release-process fact, not a source defect, and the version this tree stamps
     is already public — rebuilding is the owner's call, not the verifier's. But
     it must never again be SILENT. */
  {
    const expectDiff = new Set(kind === 'firefox' ? ['manifest.json', 'background.js'] : []);
    const src = collect();
    const missing = src.filter(f => !entries.has(f));
    const changed = src.filter(f => entries.has(f) && !expectDiff.has(f) &&
      !fs.readFileSync(path.join(ROOT, f)).equals(entries.get(f)));
    const orphan = [...entries.keys()].filter(k => src.indexOf(k) < 0);
    if (missing.length || changed.length || orphan.length) {
      console.log('  STALE  the zip no longer matches the tree  — ' +
        missing.length + ' missing, ' + changed.length + ' changed, ' + orphan.length + ' orphaned');
      const show = a => a.slice(0, 6).join(', ') + (a.length > 6 ? ' +' + (a.length - 6) : '');
      action('OWNER', 'rebuild ' + path.basename(zipPath) + ' — it is out of date with the working tree' +
        (missing.length ? '; NOT PACKAGED: ' + show(missing) : '') +
        (changed.length ? '; STALE BYTES: ' + show(changed) : '') +
        (orphan.length ? '; NO LONGER IN THE TREE: ' + show(orphan) : '') +
        '. Bump the version first: ' + JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version +
        ' has already been published, and two different packages under one version is unrecoverable.');
    } else {
      check('every packaged file is byte-identical to the tree', true, src.length + ' files');
    }
  }

  /* --- version parity with the tree --- */
  const rootVer = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
  check('packaged version matches the working tree', mf.version === rootVer, mf.version + ' vs ' + rootVer);
  check('filename carries the packaged version', path.basename(zipPath).includes(mf.version),
    path.basename(zipPath));

  /* --- Firefox-only --- */
  if (kind === 'firefox') {
    const gecko = (mf.browser_specific_settings || {}).gecko || {};
    const id = gecko.id || '';
    const placeholder = /REPLACE-WITH-YOUR-DOMAIN|\.example$/i.test(id);
    if (placeholder) {
      console.log('  BLOCK  gecko.id is still the placeholder  — ' + id);
      action('OWNER', 'set a real browser_specific_settings.gecko.id in publish/manifest.firefox.json '
        + '(AMO fixes the add-on identity at first signing — a placeholder cannot be walked back), '
        + 'then rebuild and run publish/verify-firefox-package.node.js');
    } else {
      check('gecko.id is a real id, not the placeholder', true, id);
    }
    const bgSrc = (entries.get('background.js') || Buffer.alloc(0)).toString('utf8');
    const guarded = /if\s*\(\s*typeof\s+importScripts\s*===\s*['"]function['"]\s*\)/.test(bgSrc);
    check('packaged background.js guards importScripts', guarded,
      guarded ? 'Firefox loads it as an event page' : 'UNGUARDED — the add-on throws on load in Firefox');
    check('packaged manifest equals publish/manifest.firefox.json',
      JSON.stringify(mf) === JSON.stringify(JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.firefox.json'), 'utf8'))));
  } else {
    const bgSrc = (entries.get('background.js') || Buffer.alloc(0)).toString('utf8');
    check('Chrome package keeps the plain importScripts calls',
      /^importScripts\('pages\/db\.js'\);$/m.test(bgSrc));
  }
}

/* ---------------- main ---------------- */
/* Required rather than run, the file is a library of the real packaging
   functions. test/i18n-sim.node.js used to re-implement the walk from an eval of
   this file's ALLOW/NEVER/MAX_DEPTH source text — a second implementation that
   could pass while the real one failed, which is the exact shape of bug this
   whole section is about. It now grades THESE functions. */
if (require.main !== module) {
  module.exports = {
    ROOT, ALLOW, NEVER, MAX_DEPTH,
    collect, localeMessageFiles, localesViaAllowRules, localeProblems, readManifests, readZip
  };
  return;
}

const verifyOnly = process.argv.includes('--verify');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
const chromeZip = path.join(OUT, 'fullshot-' + version + '.zip');
const firefoxZip = path.join(OUT, 'fullshot-' + version + '-firefox.zip');

console.log('FullShot packaging — v' + version + (verifyOnly ? '  (verify only)' : ''));

/* The two paths to _locales must agree. The always-collector is what SHIPS, so a
   disagreement never breaks the package — but a NEVER clause or a lost `recurse`
   that would once have silently emptied the zip must not now pass unremarked. */
{
  const viaRules = localesViaAllowRules();
  const always = localeMessageFiles();
  const ruleBlind = always.filter(f => !viaRules.includes(f));
  check('the generic allowlist rule still reaches _locales on its own', ruleBlind.length === 0,
    ruleBlind.length
      ? 'the always-rule is carrying ' + ruleBlind.length + '/' + always.length + ' locale(s) alone — ' +
        'ALLOW/NEVER/MAX_DEPTH no longer see them. The package is still correct; the pattern language is not.'
      : always.length + ' locale(s) reachable by both paths');
}

/* A function rather than an inline block so the localisation gate can bail out
   of the BUILD without skipping the verify pass or duplicating the summary. */
function build() {
  const files = collect();
  console.log('\nAllowlist: ' + files.length + ' files  (' +
    files.filter(f => f.startsWith('_locales/')).length + ' locales + ' +
    files.filter(f => !f.startsWith('_locales/')).length + ' code/assets)');

  /* R12's gate, BEFORE a single byte is written. Refuse rather than degrade:
     an unshippable zip written over the last good one is not something a
     non-zero exit code can undo. */
  const locProblems = localeProblems(files, readManifests());
  if (locProblems.length) {
    FAILS += locProblems.length;
    locProblems.forEach(p => console.log('  FAIL  localisation: ' + p));
    console.log('  SKIPPED both packages — a build that cannot carry its own _locales tree must never '
      + 'overwrite a good artifact. Nothing was written; the previous zips are untouched.');
    action('BUILD', 'the localisation gate refused this build — fix _locales collection in '
      + 'publish/package.node.js (see the R12 note), then rebuild.');
    return;
  }
  console.log('  localisation gate: ' + files.filter(f => f.startsWith('_locales/')).length +
    '/' + localeMessageFiles().length + ' locales collected, default_locale present in both manifests');

  /* A dropped file is always a bug; a new one is worth a second look. Diff the
     set against the most recent previous release rather than trusting the glob. */
  /* Compared as NUMBERS. A lexical sort puts 1.9.7 after 1.9.11 because "7" >
     "1", so the diff below was quietly taken against two releases back —
     harmless while both held the same 30 names, and silently wrong from 1.9.20
     or 1.10.x onward, which is exactly when a dropped-file check matters. */
  const verOf = f => (f.match(/(\d+)\.(\d+)\.(\d+)/) || ['', '0', '0', '0']).slice(1).map(Number);
  const prev = fs.readdirSync(OUT)
    .filter(f => /^fullshot-\d+\.\d+\.\d+\.zip$/.test(f) && f !== path.basename(chromeZip))
    .sort((a, b) => { const x = verOf(a), y = verOf(b); return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]); })
    .pop();
  if (prev) {
    const before = new Set(readZip(path.join(OUT, prev)).keys());
    const dropped = [...before].filter(f => !files.includes(f));
    const added = files.filter(f => !before.has(f));
    /* Condensed. A release that adds 54 locales printed 54 absolute paths on one
       line, which buries the DROPPED half — the half that is always a bug. */
    const show = a => a.slice(0, 4).join(', ') + (a.length > 4 ? ' +' + (a.length - 4) + ' more' : '');
    console.log('  vs ' + prev + ': ' + (dropped.length ? 'DROPPED ' + show(dropped) : 'nothing dropped')
      + ' · ' + (added.length ? 'added ' + added.length + ': ' + show(added) : 'nothing added'));
    if (dropped.length) { FAILS++; console.log('  FAIL  a file present in ' + prev + ' is missing from this build'); }
  }

  const chromeEntries = files.map(rel => ({ name: rel, data: fs.readFileSync(path.join(ROOT, rel)) }));
  writeZip(chromeZip, chromeEntries);
  console.log('  wrote ' + path.basename(chromeZip));

  const ffManifest = fs.readFileSync(path.join(OUT, 'manifest.firefox.json'));
  const bgRaw = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  /* Source is Chrome-shaped today, so the guard is applied here at package time —
     the 1.9.11 precedent, except done by script and then verified, instead of by
     hand. If the guard is ever folded into source (a no-op for Chrome, where
     importScripts is always a function) this passes the file through untouched;
     what must never happen is an UNGUARDED background.js reaching the FF zip. */
  const alreadyGuarded = /if\s*\(\s*typeof\s+importScripts\s*===\s*['"]function['"]\s*\)/.test(bgRaw);
  /* Refuse rather than degrade. The old shape reported the anchor failure and
     then wrote the zip ANYWAY — an unguarded, version-stamped AMO candidate,
     on top of the last good one, under a line claiming the guard had been
     applied. A non-zero exit is no protection when the artifact it condemns is
     the one left on disk and the good one is gone. */
  if (!alreadyGuarded && !bgRaw.includes(GUARD_FROM)) {
    FAILS++;
    console.log('  FAIL  cannot guard background.js for Firefox — the importScripts block no longer '
      + 'matches the anchor this script edits. Update GUARD_FROM in publish/package.node.js.');
    console.log('  SKIPPED ' + path.basename(firefoxZip) + ' — an unguarded background.js must never reach '
      + 'the Firefox zip, so the previous package is left untouched rather than overwritten with a broken one.');
    action('BUILD', 'background.js importScripts block changed; re-anchor the Firefox guard in publish/package.node.js');
  } else {
    console.log('  firefox background.js: ' + (alreadyGuarded ? 'guard already in source' : 'guard applied at package time'));
    const ffEntries = chromeEntries.map(e => {
      if (e.name === 'manifest.json') return { name: e.name, data: ffManifest };
      if (e.name === 'background.js') {
        return { name: e.name, data: Buffer.from(alreadyGuarded ? bgRaw : bgRaw.replace(GUARD_FROM, GUARD_TO), 'utf8') };
      }
      return e;
    });
    writeZip(firefoxZip, ffEntries);
    console.log('  wrote ' + path.basename(firefoxZip));
  }
}

if (!verifyOnly) build();

verifyPackage(chromeZip, 'chrome');
verifyPackage(firefoxZip, 'firefox');

console.log('\n' + (FAILS ? FAILS + ' FAIL' : 'ALL PASS') + ' — packaging + reference integrity');
if (ACTIONS.length) {
  console.log('\nBlocking a submission (not a packaging defect):');
  ACTIONS.forEach((a, i) => console.log('  ' + (i + 1) + '. ' + a));
}
process.exit(FAILS ? 1 : 0);
