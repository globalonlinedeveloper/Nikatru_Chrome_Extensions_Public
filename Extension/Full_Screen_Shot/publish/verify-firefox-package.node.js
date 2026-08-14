/* FullShot Firefox (AMO) package verification. No browser, no dependencies.
   Grades publish/manifest.firefox.json against Mozilla's current MV3 rules,
   against the Chrome manifest it must stay in step with, and — when the
   matching package exists — against the zip itself. Any blocker exits non-zero:
   the Firefox submission must not be able to happen by accident.

     node publish/verify-firefox-package.node.js
     node publish/verify-firefox-package.node.js --zip publish/fullshot-1.9.11-firefox.zip

   NOT one of the eight test tiers. This script is RED by design until the owner
   replaces the placeholder add-on id and the Firefox build applies the
   importScripts guard; do not add it to the all-green set.

   Sources (Mozilla, read 2026-08-12):
     browser_specific_settings.gecko — id format/length, strict_min_version,
     data_collection_permissions shape and the data-type vocabulary
       https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
     what "collect or transmit" means, and the "none" declaration
       https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
     required for new add-ons submitted from 2025-11-03
       https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/
     background: Firefox ignores service_worker and runs scripts; ship both
       https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
     BACKGROUND_SERVICE_WORKER_NOFALLBACK (error) / _IGNORED (warning)
       https://mozilla.github.io/addons-linter/
     minimum_chrome_version is a Chrome-only key (absent from Mozilla's
     manifest.json key index)
       https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version
       https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const FF_PATH = path.join(__dirname, 'manifest.firefox.json');
const CH_PATH = path.join(ROOT, 'manifest.json');

/* The placeholder shipped in the first Firefox manifest. It is not a domain the
   owner controls, so an add-on signed under it would be signed under a name
   belonging to nobody — this is the reason the script exists. */
const PLACEHOLDER_ID = /REPLACE-WITH-YOUR-DOMAIN|\.example$/i;
/* MDN: email-style id, 80 characters or less. */
const GECKO_ID_RE = /^[a-zA-Z0-9\-._]*@[a-zA-Z0-9\-._]+$/;

/* MDN browser_specific_settings: `required` takes "none" OR one or more of
   these; `optional` takes these plus technicalAndInteraction. */
const DATA_TYPES = ['authenticationInfo', 'bookmarksInfo', 'browsingActivity',
  'financialAndPaymentInfo', 'healthInfo', 'locationInfo', 'personalCommunications',
  'personallyIdentifyingInfo', 'searchTerms', 'websiteActivity', 'websiteContent'];
const OPTIONAL_ONLY = ['technicalAndInteraction'];

/* Top-level keys allowed to differ between the Chrome and Firefox manifests.
   Anything else that differs is drift, not a port. */
const ALLOWED_DELTA = ['background', 'browser_specific_settings',
  'minimum_chrome_version', 'options_page', 'options_ui'];

let FAILS = 0;
const ACTIONS = [];
function check(label, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
  return !!ok;
}
/* A check that, when it fails, also parks a named action in the loud summary. */
function gate(label, ok, extra, action) {
  if (!check(label, ok, extra) && action) ACTIONS.push(action);
  return !!ok;
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}
const exists = rel => fs.existsSync(path.join(ROOT, rel));

/* Minimal zip reader: central directory walk + inflateRaw. Enough to read the
   packaged manifest and background.js and to list entries for a leak check. */
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
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central-directory entry ' + n);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.slice(start, start + csize);
    out.set(name, method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/* Chrome runs background.js as a service worker (importScripts exists); Firefox
   runs it as an event-page script where importScripts is undefined and the two
   helpers arrive via background.scripts instead. Unguarded, the file throws on
   load in Firefox and the add-on is dead. */
function importScriptsGuarded(src) {
  const guard = src.indexOf('typeof importScripts');
  const first = src.indexOf('importScripts(');
  return guard !== -1 && first !== -1 && guard < first;
}

console.log('\n=== manifest: parse + identity ===');
const ff = JSON.parse(fs.readFileSync(FF_PATH, 'utf8'));
const ch = JSON.parse(fs.readFileSync(CH_PATH, 'utf8'));
check('publish/manifest.firefox.json parses', !!ff);
check('manifest_version is 3', ff.manifest_version === 3, ff.manifest_version);
check('name is present', typeof ff.name === 'string' && ff.name.length > 0, ff.name);

console.log('\n=== version: in step with the root manifest ===');
gate('publish/manifest.firefox.json version === manifest.json version',
  ff.version === ch.version, 'firefox ' + ff.version + ' vs root ' + ch.version,
  'INTEGRATION: publish/manifest.firefox.json is a SECOND manifest — bump its "version" in the same commit as manifest.json (root is ' + ch.version + ', this file says ' + ff.version + ').');

console.log('\n=== browser_specific_settings.gecko ===');
const gecko = (ff.browser_specific_settings && ff.browser_specific_settings.gecko) || {};
check('gecko block present', !!ff.browser_specific_settings && !!ff.browser_specific_settings.gecko);
check('gecko.id present (AMO requires one for MV3 signing)', typeof gecko.id === 'string' && !!gecko.id, gecko.id);
gate('gecko.id is NOT the placeholder', !PLACEHOLDER_ID.test(String(gecko.id || '')), gecko.id,
  'OWNER: replace browser_specific_settings.gecko.id in publish/manifest.firefox.json with an email-style id on a domain you actually control (e.g. fullshot@yourdomain.tld). The current value is a placeholder — DO NOT submit to AMO until it is replaced. Nobody but the owner can pick this.');
check('gecko.id matches Mozilla\'s email-style format', GECKO_ID_RE.test(String(gecko.id || '')), gecko.id);
check('gecko.id is 80 characters or less', String(gecko.id || '').length <= 80, String(gecko.id || '').length);
check('gecko.strict_min_version present', typeof gecko.strict_min_version === 'string', gecko.strict_min_version);
check('gecko.update_url absent (listed AMO add-ons must not self-host updates)', !('update_url' in gecko));

console.log('\n=== data_collection_permissions (required for new add-ons since 2025-11-03) ===');
const dcp = gecko.data_collection_permissions;
const okDcp = gate('data_collection_permissions declared', !!dcp && typeof dcp === 'object' && !Array.isArray(dcp),
  dcp === undefined ? 'absent' : typeof dcp,
  'BLOCKER: add browser_specific_settings.gecko.data_collection_permissions — AMO refuses the submission without it.');
if (okDcp) {
  const req = dcp.required;
  check('required is a non-empty array', Array.isArray(req) && req.length > 0, JSON.stringify(req));
  const reqOk = Array.isArray(req) && req.every(v => v === 'none' || DATA_TYPES.indexOf(v) !== -1);
  check('every required value is in Mozilla\'s vocabulary', reqOk, JSON.stringify(req));
  check('"none" is not combined with other data types',
    !Array.isArray(req) || req.indexOf('none') === -1 || req.length === 1, JSON.stringify(req));
  /* FullShot makes zero network calls and nothing it reads leaves the machine,
     so "none" is the honest declaration. If the product ever starts collecting
     or transmitting, this check is the place that should force the conversation. */
  check('FullShot declares no data collection (required === ["none"])',
    deepEqual(req, ['none']), JSON.stringify(req));
  if ('optional' in dcp) {
    const opt = dcp.optional;
    check('optional is an array of known data types',
      Array.isArray(opt) && opt.every(v => DATA_TYPES.indexOf(v) !== -1 || OPTIONAL_ONLY.indexOf(v) !== -1),
      JSON.stringify(opt));
    check('"none" does not appear in optional', !Array.isArray(opt) || opt.indexOf('none') === -1, JSON.stringify(opt));
  }
}

console.log('\n=== background: the Firefox fallback ===');
const bg = ff.background || {};
check('background.service_worker declared (Chrome/Edge path)', typeof bg.service_worker === 'string', bg.service_worker);
gate('background.scripts declared alongside it (Firefox path)',
  Array.isArray(bg.scripts) && bg.scripts.length > 0, JSON.stringify(bg.scripts),
  'BLOCKER: background.service_worker without background.scripts is an addons-linter ERROR (BACKGROUND_SERVICE_WORKER_NOFALLBACK) and leaves Firefox with no background at all.');
check('the service worker file is last in background.scripts',
  Array.isArray(bg.scripts) && bg.scripts[bg.scripts.length - 1] === bg.service_worker,
  Array.isArray(bg.scripts) ? bg.scripts.join(', ') : '');
(Array.isArray(bg.scripts) ? bg.scripts : []).forEach(s =>
  check('background script resolves on disk: ' + s, exists(s)));

console.log('\n=== keys Firefox must not carry ===');
gate('no minimum_chrome_version (Chrome-only key, not in Mozilla\'s manifest index)',
  !('minimum_chrome_version' in ff), ff.minimum_chrome_version,
  'FIX: drop "minimum_chrome_version" from publish/manifest.firefox.json — it is a Chrome Web Store key and means nothing to Firefox.');
check('no developer "key" field', !('key' in ff));
check('no top-level update_url', !('update_url' in ff));
check('no content_security_policy override (strict MV3 default applies)', !('content_security_policy' in ff));

console.log('\n=== permissions surface (must match the audited Chrome package) ===');
check('permissions identical to the Chrome manifest', deepEqual(ff.permissions, ch.permissions), JSON.stringify(ff.permissions));
check('no static host_permissions (broad access stays optional)', !('host_permissions' in ff));
check('optional_host_permissions is ["<all_urls>"]', deepEqual(ff.optional_host_permissions, ['<all_urls>']), JSON.stringify(ff.optional_host_permissions));

console.log('\n=== options surface ===');
check('options_ui declared (the Firefox form)', !!ff.options_ui && typeof ff.options_ui.page === 'string', JSON.stringify(ff.options_ui));
check('options page resolves on disk', !!ff.options_ui && exists(ff.options_ui.page), ff.options_ui && ff.options_ui.page);
check('options_page (the Chrome form) is not also present', !('options_page' in ff));

console.log('\n=== reference integrity (every path in the manifest exists) ===');
const refs = [];
if (ff.action && ff.action.default_popup) refs.push(ff.action.default_popup);
Object.keys((ff.action && ff.action.default_icon) || {}).forEach(k => refs.push(ff.action.default_icon[k]));
Object.keys(ff.icons || {}).forEach(k => refs.push(ff.icons[k]));
refs.forEach(r => check('resolves: ' + r, exists(r)));

console.log('\n=== drift: only the documented Firefox deltas may differ ===');
const keys = Array.from(new Set(Object.keys(ff).concat(Object.keys(ch)))).sort();
keys.filter(k => ALLOWED_DELTA.indexOf(k) === -1).forEach(k =>
  check('identical to the Chrome manifest: ' + k, deepEqual(ff[k], ch[k]),
    deepEqual(ff[k], ch[k]) ? null : 'firefox ' + JSON.stringify(ff[k]) + ' vs root ' + JSON.stringify(ch[k])));

console.log('\n=== build prerequisite: the importScripts guard ===');
const srcBg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const srcGuarded = importScriptsGuarded(srcBg);
check('source background.js guards importScripts', srcGuarded,
  srcGuarded ? null : 'unguarded — Chrome-only as it stands');

console.log('\n=== package ===');
const argZip = (() => { const i = process.argv.indexOf('--zip'); return i !== -1 ? process.argv[i + 1] : null; })();
const zipPath = argZip ? path.resolve(argZip)
  : path.join(__dirname, 'fullshot-' + ff.version + '-firefox.zip');
if (!fs.existsSync(zipPath)) {
  console.log('NOTE  no Firefox package at ' + path.basename(zipPath) + ' — nothing to grade yet.');
  gate('a Firefox package built from unguarded source would be dead on load', srcGuarded, null,
    'BUILD: source background.js still calls importScripts() unguarded, so the Firefox zip must be built from a guarded copy (see CROSS-BROWSER-PUBLISHING.md). Zipping the source as-is produces an add-on that throws on load in Firefox.');
} else {
  console.log('      ' + path.basename(zipPath));
  let entries = null;
  try { entries = readZip(zipPath); } catch (e) { check('package reads as a zip', false, e.message); }
  if (entries) {
    check('package reads as a zip', true, entries.size + ' entries');
    const zipped = entries.get('manifest.json');
    check('package contains manifest.json', !!zipped);
    if (zipped) {
      let pm = null;
      try { pm = JSON.parse(zipped.toString('utf8')); } catch (e) { check('packaged manifest parses', false, e.message); }
      if (pm) {
        check('packaged manifest parses', true);
        gate('packaged manifest === publish/manifest.firefox.json', deepEqual(pm, ff),
          'packaged version ' + pm.version,
          'BUILD: the zip was built from a different manifest than publish/manifest.firefox.json — rebuild it.');
      }
    }
    const zbg = entries.get('background.js');
    check('package contains background.js', !!zbg);
    if (zbg) gate('packaged background.js guards importScripts',
      importScriptsGuarded(zbg.toString('utf8')), null,
      'BUILD: the packaged background.js calls importScripts() unguarded — it will throw on load in Firefox.');
    const leak = Array.from(entries.keys()).filter(n =>
      /^(test|Reference)\//.test(n) || /\.md$/i.test(n) || /\.node\.js$/i.test(n) ||
      /node_modules\//.test(n) || /DELETE/i.test(n));
    check('no test/dev/scratch files in the package', leak.length === 0, leak.join(', '));
  }
}

console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS'));
if (ACTIONS.length) {
  console.log('\n!!! THE FIREFOX PACKAGE IS NOT SUBMITTABLE — ' + ACTIONS.length + ' blocker(s):');
  ACTIONS.forEach((a, i) => console.log('  ' + (i + 1) + '. ' + a));
  console.log('');
}
process.exit(FAILS ? 1 : 0);
