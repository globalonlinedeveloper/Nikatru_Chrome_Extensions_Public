/* selftest.node.js — do the gates in scripts/ actually bite?
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/test/selftest.node.js
     node scripts/test/selftest.node.js --keep     (leave the fixtures on disk)

   No dependencies, no framework, bare Node. It builds a small but REAL tool
   tree in the OS temp directory — real PNG icons copied out of templates/tool, a
   real manifest, a real locale catalogue — runs each gate against it, then
   breaks exactly one thing and runs the gate again.

   WHY THIS FILE EXISTS AT ALL

   The recurring failure in this family is not a broken check, it is a check
   that silently stopped checking. It still prints "clean", CI still goes green,
   and nothing surfaces until the thing it guarded is already broken. The
   defence is not more checks; it is a recorded failing case for every check.

   So every assertion below comes in pairs: the gate PASSES on a correct tree,
   and FAILS on one specific mutation, with a message that names the problem.
   An assertion that cannot fail is worse than none — it inflates apparent
   coverage — so if you add a gate to scripts/ and cannot write the mutation
   that makes it red, the gate is not real and belongs deleted rather than kept
   "for safety".

   THE TWO THINGS IT DELIBERATELY PROVES ABOUT ITSELF

     - the network scanner does NOT fire on the word "fetch" in a comment
       (a gate that is red on its own documentation is a gate people disable),
       and DOES fire on a real call four lines later;
     - an external <a href> does not fail the remote-subresource gate, while an
       external <script src> does.

   Exit codes: 0 every pair behaved · 1 a gate did not bite, or bit wrongly. */

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const REPO = path.resolve(SCRIPTS, '..');
const KEEP = process.argv.includes('--keep');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-selftest-'));

let PASS = 0;
const FAILURES = [];

function ok(label, extra) { PASS++; console.log('  PASS  ' + label + (extra ? '  — ' + extra : '')); }
function bad(label, why) { FAILURES.push({ label, why }); console.log('  FAIL  ' + label + '\n        ' + String(why).split('\n').join('\n        ')); }

function run(script, argv, root) {
  const res = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...argv, '--repo-root', root], {
    encoding: 'utf8', cwd: REPO
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

/* `expect` is the whole point: a case states the code it wants AND a fragment
   of the message. A gate that fails for an unrelated reason is not the gate
   working — that is how three "caught" mutations turned out to be compile
   errors in an earlier project in this family. */
function expect(label, { script, argv, root, code, contains }) {
  const r = run(script, argv, root);
  const codeOk = r.code === code;
  const textOk = !contains || r.out.includes(contains);
  if (codeOk && textOk) return ok(label, 'exit ' + r.code + (contains ? ' · says "' + contains + '"' : ''));
  bad(label,
    (codeOk ? '' : 'expected exit ' + code + ', got ' + r.code + '\n') +
    (textOk ? '' : 'expected the output to contain: ' + contains + '\n') +
    '--- output ---\n' + r.out.trim());
}

/* ---------------- fixture ---------------- */
function w(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

const TOOL = 'Extension/Good_Tool';

function buildBase(root) {
  w(root, 'README.md',
    '# fixture\n\n## Extensions\n\n<!-- CATALOG:START -->\n' +
    '| Extension | What it does | Status |\n|---|---|---|\n| [Placeholder](x) | stale row | Built |\n' +
    '<!-- CATALOG:END -->\n\ntail\n');

  w(root, 'core/core.json', JSON.stringify({ version: '0.1.0', channel: 'v1' }, null, 2) + '\n');
  w(root, 'core/v1/a.js', "'use strict';\nglobalThis.A = 1;\n");
  w(root, 'core/v1/sub/b.js', "'use strict';\nglobalThis.B = 2;\n");

  w(root, TOOL + '/manifest.json', JSON.stringify({
    manifest_version: 3,
    default_locale: 'en',
    name: '__MSG_appName__',
    short_name: '__MSG_appShortName__',
    version: '1.0.0',
    description: '__MSG_appDescription__',
    permissions: ['storage', 'activeTab'],
    content_security_policy: { extension_pages: "default-src 'self'; script-src 'self'; connect-src 'none'" },
    action: {
      default_popup: 'popup/popup.html',
      default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' }
    },
    background: { service_worker: 'background.js' },
    icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' }
  }, null, 2) + '\n');

  w(root, TOOL + '/background.js',
    "'use strict';\n" +
    'chrome.runtime.onInstalled.addListener(function () {});\n');

  w(root, TOOL + '/popup/popup.html',
    '<!doctype html><html><head><link rel="stylesheet" href="popup.css"></head>\n' +
    '<body><p><a href="https://nikatru.com/privacy">Privacy</a></p>\n' +
    '<script src="popup.js"></script></body></html>\n');
  w(root, TOOL + '/popup/popup.js', "'use strict';\ndocument.title = 'x';\n");
  w(root, TOOL + '/popup/popup.css', 'body { margin: 0 }\n');

  w(root, TOOL + '/_locales/en/messages.json', JSON.stringify({
    appName: { message: 'Good Tool' },
    appShortName: { message: 'GoodTool' },
    appDescription: { message: 'A fixture extension used by the scripts self-test.' }
  }, null, 2) + '\n');

  for (const size of [16, 32, 48, 128]) {
    const src = path.join(REPO, 'templates', 'tool', 'icons', 'icon' + size + '.png');
    const dst = path.join(root, TOOL, 'icons', 'icon' + size + '.png');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  w(root, TOOL + '/CHANGELOG.md', '# Changelog\n\n## [1.0.0] - 2026-08-14\n\n### Added\n\n- first release\n');
  w(root, TOOL + '/test/smoke.node.js', "'use strict';\nconsole.log('ok');\n");

  w(root, TOOL + '/tool.json', JSON.stringify({
    $schema: '../../scripts/schema/tool.schema.json',
    id: 'goodtool',
    name: 'Good Tool',
    surface: 'extension',
    status: 'wip',
    summary: 'A fixture extension used by the scripts self-test.',
    manifest: 'manifest.json',
    package: {
      include: ['manifest.json', 'background.js', 'popup/', 'icons/', '_locales/'],
      exclude: ['**/*.node.js', '**/test/**', '**/*.md']
    },
    targets: { chromium: { stores: ['chrome', 'edge'] } },
    tests: ['test/smoke.node.js'],
    policy: {
      permissions: { storage: 'remembers the user\'s settings', activeTab: 'acts on the tab the user invoked it on' },
      optionalHostPermissions: {},
      networkAllowlist: []
    },
    listings: { chrome: null, edge: null, firefox: null }
  }, null, 2) + '\n');
}

const BASE = path.join(TMP, '_base');
buildBase(BASE);

let caseNo = 0;
/* Each case gets a pristine copy, so one mutation can never leak into the next.
   A shared fixture that accumulates damage produces cascading failures whose
   first cause is the only real one. */
function fixture(mutate) {
  const root = path.join(TMP, 'case-' + (++caseNo));
  copyDir(BASE, root);
  if (mutate) mutate(root);
  return root;
}
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
/* mkdir first: a mutation that ADDS a locale writes into a directory the base
   fixture does not have. */
const writeJson = (root, rel, v) => w(root, rel, JSON.stringify(v, null, 2) + '\n');
const edit = (root, rel, fn) => {
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, fn(fs.readFileSync(abs, 'utf8')), 'utf8');
};

/* =====================================================================
   toolinfo + discover
   ===================================================================== */
console.log('\ndiscover.mjs');
expect('a well-formed tree yields a matrix', {
  script: 'discover.mjs', argv: ['--json'], root: fixture(), code: 0, contains: '["goodtool"]'
});
expect('a duplicate tool id is fatal', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'duplicate tool id',
  root: fixture(root => {
    copyDir(path.join(root, TOOL), path.join(root, 'Extension/Second_Tool'));
  })
});
expect('surface must match the category directory', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'A category IS the delivery surface',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.surface = 'web'; writeJson(root, TOOL + '/tool.json', t); })
});
expect('a listed test that does not exist is fatal', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'silently stops running',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.tests = ['test/gone.node.js']; writeJson(root, TOOL + '/tool.json', t); })
});
expect('an id that is not lowercase-kebab is fatal', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'must be lowercase-kebab',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.id = 'Good_Tool'; writeJson(root, TOOL + '/tool.json', t); })
});
expect('a version in tool.json is fatal (the manifest is the only source)', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'single source of',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.version = '1.0.0'; writeJson(root, TOOL + '/tool.json', t); })
});
expect('unparseable tool.json names the line and column', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'does not parse as JSON',
  root: fixture(root => { edit(root, TOOL + '/tool.json', s => s.replace('{', '{ oops')); })
});

/* =====================================================================
   lint
   ===================================================================== */
console.log('\nlint.mjs');
expect('clean sources parse', {
  script: 'lint.mjs', argv: ['goodtool'], root: fixture(), code: 0, contains: 'file(s) parse'
});
expect('a syntax error in a shipped file fails', {
  script: 'lint.mjs', argv: ['goodtool'], code: 1, contains: 'SyntaxError',
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'const a = ;\n'); })
});
expect('a syntax error in a listed TEST also fails', {
  script: 'lint.mjs', argv: ['goodtool'], code: 1, contains: 'SyntaxError',
  root: fixture(root => { edit(root, TOOL + '/test/smoke.node.js', s => s + 'function ( {\n'); })
});
expect('selecting zero files is a FAILURE, not a pass', {
  script: 'lint.mjs', argv: ['goodtool'], code: 1, contains: 'REQUIRED COVERAGE',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include = ['nothing-matches-this.json'];
    writeJson(root, TOOL + '/tool.json', t);
  })
});
expect('the tool can be named by path as well as by id', {
  script: 'lint.mjs', argv: [TOOL], root: fixture(), code: 0, contains: 'file(s) parse'
});
expect('an unknown tool name refuses rather than checking nothing', {
  script: 'lint.mjs', argv: ['nosuchtool'], root: fixture(), code: 2, contains: 'no tool named'
});

/* =====================================================================
   check-version
   ===================================================================== */
console.log('\ncheck-version.mjs');
expect('manifest and CHANGELOG agree', {
  script: 'check-version.mjs', argv: ['goodtool'], root: fixture(), code: 0
});
expect('a CHANGELOG behind the manifest fails', {
  script: 'check-version.mjs', argv: ['goodtool'], code: 1, contains: "CHANGELOG.md's newest entry is [0.9.0]",
  root: fixture(root => { edit(root, TOOL + '/CHANGELOG.md', s => s.replace('1.0.0', '0.9.0')); })
});
expect('a missing CHANGELOG fails', {
  script: 'check-version.mjs', argv: ['goodtool'], code: 1, contains: 'CHANGELOG.md is missing',
  root: fixture(root => { fs.rmSync(path.join(root, TOOL, 'CHANGELOG.md')); })
});
expect('a reused version number fails', {
  script: 'check-version.mjs', argv: ['goodtool'], code: 1, contains: 'A version is never reused',
  root: fixture(root => { edit(root, TOOL + '/CHANGELOG.md', s => s + '\n## [1.0.0] - 2026-01-01\n\n- again\n'); })
});
expect('--expect disagreeing with the manifest fails', {
  script: 'check-version.mjs', argv: ['goodtool', '--expect', '1.0.1'], root: fixture(), code: 1, contains: 'the caller expected v1.0.1'
});
expect('a tag naming another tool fails', {
  script: 'check-version.mjs', argv: ['goodtool', '--tag', 'othertool-v1.0.0'], root: fixture(), code: 1, contains: 'tag names this tool'
});
/* A malformed version must be reported BY the version gate, as its own
   failure (exit 1) — not by the loader as "cannot run" (exit 2). The first
   version of toolinfo.mjs made it a tool.json contract error, which meant the
   one script whose whole job is version agreement was the one script that could
   not say so. Both scripts that grade it are asserted here. */
expect('an illegal version format fails IN check-version, not in the loader', {
  script: 'check-version.mjs', argv: ['goodtool'], code: 1, contains: 'no leading zeros',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.version = '1.0.0-beta'; writeJson(root, TOOL + '/manifest.json', m); })
});
expect('and policy-check grades it too', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'manifest version format',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.version = '01.2.3'; writeJson(root, TOOL + '/manifest.json', m); })
});

/* =====================================================================
   policy-check
   ===================================================================== */
console.log('\npolicy-check.mjs');
expect('a clean tool passes every gate', {
  script: 'policy-check.mjs', argv: ['goodtool'], root: fixture(), code: 0
});
expect('a real fetch() in a shipped file fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'zero network calls',
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'fetch("https://example.com/ping");\n'); })
});
expect('the word fetch in a COMMENT does not fail, and is still reported', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'only inside comments or strings',
  root: fixture(root => {
    edit(root, TOOL + '/background.js', s =>
      '// This extension never calls fetch(), XMLHttpRequest or navigator.sendBeacon.\n' +
      '/* Not a WebSocket in sight, and no EventSource either. */\n' + s);
  })
});
expect('a fetch hidden under a comment banner is still caught', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'zero network calls',
  root: fixture(root => {
    edit(root, TOOL + '/background.js', s =>
      '// We never call fetch(). Honest.\n' + s + 'const u = "/*"; fetch("https://example.com/x");\n');
  })
});
expect('a URL inside a string does not fail the gate', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0,
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'const doc = "see https://example.com for how fetch() works";\n'); })
});
expect('eval() fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'no runtime code generation',
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'eval("1+1");\n'); })
});
expect('string-form setTimeout fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'string-form setTimeout',
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'setTimeout("go()", 10);\n'); })
});
expect('a remote <script src> fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'no remote subresources',
  root: fixture(root => { edit(root, TOOL + '/popup/popup.html', s => s.replace('</body>', '<script src="https://cdn.example.com/x.js"></script></body>')); })
});
expect('an external <a href> does NOT fail (it navigates, it does not load)', {
  script: 'policy-check.mjs', argv: ['goodtool'], root: fixture(), code: 0, contains: 'external <a href>'
});
expect('an unjustified permission fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'no justification at all: downloads',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.permissions.push('downloads'); writeJson(root, TOOL + '/manifest.json', m); })
});
expect('a placeholder justification fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'placeholder justification',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.policy.permissions.storage = 'TODO explain'; writeJson(root, TOOL + '/tool.json', t); })
});
expect('static host_permissions without a justification fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'static host_permissions require',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.host_permissions = ['<all_urls>']; writeJson(root, TOOL + '/manifest.json', m); })
});
expect('a description over 132 characters fails, measured on the TRANSLATION', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'the limit is 132',
  root: fixture(root => {
    const m = readJson(root, TOOL + '/_locales/en/messages.json');
    m.appDescription.message = 'x'.repeat(137);
    writeJson(root, TOOL + '/_locales/en/messages.json', m);
  })
});
expect('an over-long description in a NON-default locale is caught too', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'de: description is',
  root: fixture(root => {
    const m = readJson(root, TOOL + '/_locales/en/messages.json');
    m.appDescription.message = 'x'.repeat(137);
    writeJson(root, TOOL + '/_locales/de/messages.json', m);
  })
});
expect('an unresolved __MSG_ key fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'every __MSG_ key resolves',
  root: fixture(root => {
    const m = readJson(root, TOOL + '/_locales/en/messages.json');
    delete m.appShortName;
    writeJson(root, TOOL + '/_locales/en/messages.json', m);
  })
});
/* The next three came from running policy-check against the real FullShot tree
   after the fixture was already green. The fixture had no bidi support and no
   file that documents the i18n mechanism in prose, so it could not have shown
   either bug — which is the whole argument for mutating something real. */
expect("Chrome's predefined __MSG_@@ messages are not demanded of messages.json", {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0,
  root: fixture(root => {
    edit(root, TOOL + '/popup/popup.html', s => s.replace('<body>', '<body dir="__MSG_@@bidi_dir__">'));
  })
});
expect('a __MSG_ key quoted in a COMMENT is not demanded either', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0,
  root: fixture(root => {
    edit(root, TOOL + '/background.js', s =>
      '// Chrome substitutes __MSG_someKeyThatDoesNotExist__ at load time; see the docs.\n' + s);
    edit(root, TOOL + '/popup/popup.html', s =>
      s.replace('<body>', '<!-- __MSG_anotherMissingKey__ is explained in the README -->\n<body>'));
  })
});
expect('a real unresolved key in real markup still fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: '__MSG_reallyMissing__',
  root: fixture(root => {
    edit(root, TOOL + '/popup/popup.html', s => s.replace('<body>', '<body title="__MSG_reallyMissing__">'));
  })
});
expect('a build-time .mjs swept into the package is reported', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'build-time file(s) are inside the packaged set',
  root: fixture(root => { w(root, TOOL + '/popup/make-thing.mjs', "export const x = 1;\n"); })
});
expect('a missing default locale catalogue fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'REFUSES TO LOAD',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.default_locale = 'fr'; writeJson(root, TOOL + '/manifest.json', m); })
});
expect('locales are packaged even when package.include forgets them', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'no longer reaches _locales on its own',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include = t.package.include.filter(x => x !== '_locales/');
    writeJson(root, TOOL + '/tool.json', t);
  })
});
expect('an underscore-prefixed root directory fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'reserved for use by the system',
  root: fixture(root => {
    w(root, TOOL + '/_core/ns.js', "'use strict';\n");
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include.push('_core/');
    writeJson(root, TOOL + '/tool.json', t);
  })
});
expect('an icon of the wrong size fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'is actually 128x128',
  root: fixture(root => {
    fs.copyFileSync(path.join(root, TOOL, 'icons/icon128.png'), path.join(root, TOOL, 'icons/icon16.png'));
  })
});
expect('a renamed non-PNG icon fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'is not a PNG',
  root: fixture(root => { fs.writeFileSync(path.join(root, TOOL, 'icons/icon48.png'), 'not a png', 'utf8'); })
});
expect('a package with no manifest fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'Manifest file is missing or unreadable',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include = t.package.include.filter(x => x !== 'manifest.json');
    writeJson(root, TOOL + '/tool.json', t);
  })
});
/* An absent allowlist must be reported BY policy-check, not by the loader.
   These two cases exist because the first version of toolinfo.mjs made both
   fields tool.json contract errors — which made every gate exit 2 and turned
   the branches inside policy-check that handle them into assertions that could
   never fire. A gate must be able to fail for the reason it is about. */
expect('an absent networkAllowlist is not treated as an empty one', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'policy.networkAllowlist is declared',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); delete t.policy.networkAllowlist; writeJson(root, TOOL + '/tool.json', t); })
});
expect('an absent policy.permissions fails in policy-check', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'policy.permissions is declared',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); delete t.policy.permissions; writeJson(root, TOOL + '/tool.json', t); })
});
expect('but the matrix can still be built — a policy gap is not a contract break', {
  script: 'discover.mjs', argv: ['--json'], code: 0, contains: '["goodtool"]',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); delete t.policy.networkAllowlist; writeJson(root, TOOL + '/tool.json', t); })
});

/* =====================================================================
   sync-core + check-core-sync
   ===================================================================== */
console.log('\nsync-core.mjs / check-core-sync.mjs');
const withCore = root => { const t = readJson(root, TOOL + '/tool.json'); t.core = { channel: 'v1', pin: null }; writeJson(root, TOOL + '/tool.json', t); };

expect('a tool that vendors no core passes', {
  script: 'check-core-sync.mjs', argv: ['goodtool'], root: fixture(), code: 0, contains: 'vendors no core'
});
expect('an orphan vendor/core with no declaration fails', {
  script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'declares no core channel',
  root: fixture(root => { w(root, TOOL + '/vendor/core/ghost.js', "'use strict';\n"); })
});
expect('a declared channel that was never synced fails', {
  script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'never been created',
  root: fixture(withCore)
});
expect('a declared channel with no core/ directory fails', {
  script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'FAIL  core/v1/ exists',
  root: fixture(root => { withCore(root); fs.rmSync(path.join(root, 'core'), { recursive: true }); })
});

{
  const root = fixture(withCore);
  expect('sync-core vendors the channel', {
    script: 'sync-core.mjs', argv: ['goodtool'], root, code: 0, contains: 'vendored 2 file(s)'
  });
  const meta = path.join(root, TOOL, 'vendor/core/.coremeta.json');
  if (fs.existsSync(meta)) ok('.coremeta.json was written', JSON.parse(fs.readFileSync(meta, 'utf8')).coreVersion);
  else bad('.coremeta.json was written', 'not found at ' + meta);
  expect('and the sync then verifies', { script: 'check-core-sync.mjs', argv: ['goodtool'], root, code: 0, contains: 'byte-identical' });

  const synced = root; // reuse as the base for drift mutations
  const drift = mutate => { const r2 = path.join(TMP, 'case-' + (++caseNo)); copyDir(synced, r2); mutate(r2); return r2; };

  expect('a hand-edited vendored file fails', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'MODIFIED',
    root: drift(r2 => { edit(r2, TOOL + '/vendor/core/a.js', s => s + '// patched locally\n'); })
  });
  expect('editing the vendored file AND its recorded hash still fails', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'MODIFIED',
    root: drift(r2 => {
      const abs = path.join(r2, TOOL, 'vendor/core/a.js');
      fs.writeFileSync(abs, "'use strict';\nglobalThis.A = 99;\n", 'utf8');
      const crypto = require('crypto');
      const m = readJson(r2, TOOL + '/vendor/core/.coremeta.json');
      m.files['a.js'] = 'sha256-' + crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      writeJson(r2, TOOL + '/vendor/core/.coremeta.json', m);
    })
  });
  expect('a CRLF-only difference is named as line endings, not as a mystery hash', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'LINE ENDINGS',
    root: drift(r2 => {
      const abs = path.join(r2, TOOL, 'vendor/core/a.js');
      fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace(/\n/g, '\r\n'), 'utf8');
    })
  });
  expect('a core bump leaves the tool behind, and says so', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'the vendored core is current',
    root: drift(r2 => { const c = readJson(r2, 'core/core.json'); c.version = '0.2.0'; writeJson(r2, 'core/core.json', c); })
  });
  expect('a pin that names a version core/ does not hold is refused by sync-core', {
    script: 'sync-core.mjs', argv: ['goodtool'], code: 2, contains: 'confirm the lie',
    root: drift(r2 => { const t = readJson(r2, TOOL + '/tool.json'); t.core.pin = '9.9.9'; writeJson(r2, TOOL + '/tool.json', t); })
  });
  expect('a file deleted from vendor/core fails', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'MISSING',
    root: drift(r2 => { fs.rmSync(path.join(r2, TOOL, 'vendor/core/sub/b.js')); })
  });
  expect('a stray file in vendor/core is not silently deleted', {
    script: 'sync-core.mjs', argv: ['goodtool'], code: 1, contains: 'this script did not put there',
    root: drift(r2 => { w(r2, TOOL + '/vendor/core/mine.js', "'use strict';\n"); })
  });
}

/* =====================================================================
   gen-catalog
   ===================================================================== */
console.log('\ngen-catalog.mjs');
{
  const root = fixture();
  expect('--check sees a stale table', { script: 'gen-catalog.mjs', argv: ['--check'], root, code: 1, contains: 'out of date' });
  expect('writing fixes it', { script: 'gen-catalog.mjs', argv: [], root, code: 0, contains: 'rewrote the catalog' });
  expect('and --check then agrees', { script: 'gen-catalog.mjs', argv: ['--check'], root, code: 0, contains: 'up to date' });
  const md = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  if (md.includes('| [Good Tool](Extension/Good_Tool) |') && md.includes('tail'))
    ok('the row is generated and the surrounding prose survives');
  else bad('the row is generated and the surrounding prose survives', md);
}
expect('no markers means no write', {
  script: 'gen-catalog.mjs', argv: [], code: 2, contains: 'has no catalog markers',
  root: fixture(root => { edit(root, 'README.md', s => s.replace('<!-- CATALOG:START -->', '').replace('<!-- CATALOG:END -->', '')); })
});
expect('an empty result will not overwrite a real table', {
  script: 'gen-catalog.mjs', argv: [], code: 2, contains: 'silently delete the catalog',
  root: fixture(root => { fs.rmSync(path.join(root, TOOL, 'tool.json')); })
});
expect('a null listing never becomes an invented URL', {
  script: 'gen-catalog.mjs', argv: ['--print'], root: fixture(), code: 0, contains: 'In progress'
});

/* =====================================================================
   new-tool
   ===================================================================== */
console.log('\nnew-tool.mjs');
{
  const root = fixture(r2 => {
    /* A minimal templates/tool so the copy is fast and the precedence rule
       (templates/tool wins over _skeleton) is the thing under test. */
    w(r2, 'templates/tool/manifest.json', JSON.stringify({
      manifest_version: 3, default_locale: 'en', name: '__MSG_appName__', version: '0.0.1',
      permissions: ['storage'], background: { service_worker: 'background.js' }
    }, null, 2) + '\n');
    w(r2, 'templates/tool/background.js', "'use strict';\n");
    w(r2, 'templates/tool/_locales/en/messages.json', JSON.stringify({ appName: { message: 'x' } }) + '\n');
    w(r2, 'templates/tool/test/smoke.node.js', "console.log('ok');\n");
    w(r2, 'templates/tool/publish/identity.json', JSON.stringify({ slug: 'skeleton', ownerDomain: 'REPLACE-WITH-YOUR-DOMAIN.example' }, null, 2) + '\n');
    w(r2, 'templates/tool/publish/old-release-1.0.0.zip', 'PK-not-really\n');
    w(r2, 'templates/tool/skeleton.json', JSON.stringify({ skeletonVersion: '1.1.0', tool: '', copiedAt: '' }, null, 2) + '\n');
  });

  expect('--dry-run writes nothing', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Tab Digest', '--id', 'tabdigest', '--dry-run'],
    root, code: 0, contains: 'dry run'
  });
  if (!fs.existsSync(path.join(root, 'Extension/Tab_Digest'))) ok('--dry-run really created nothing');
  else bad('--dry-run really created nothing', 'Extension/Tab_Digest exists');

  expect('it scaffolds', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Tab Digest', '--id', 'tabdigest'],
    root, code: 0, contains: 'wrote Extension/Tab_Digest/tool.json'
  });
  const made = path.join(root, 'Extension/Tab_Digest');
  const checks = [
    ['directory name is Title_Snake_Case', fs.existsSync(made)],
    ['skeleton.json stamped with the tool name', fs.existsSync(path.join(made, 'skeleton.json')) && JSON.parse(fs.readFileSync(path.join(made, 'skeleton.json'), 'utf8')).tool === 'Tab_Digest'],
    ['skeletonVersion left alone', JSON.parse(fs.readFileSync(path.join(made, 'skeleton.json'), 'utf8')).skeletonVersion === '1.1.0'],
    ['identity slug set to the tool id', JSON.parse(fs.readFileSync(path.join(made, 'publish/identity.json'), 'utf8')).slug === 'tabdigest'],
    ["the previous tool's release zip did NOT come along", !fs.existsSync(path.join(made, 'publish/old-release-1.0.0.zip'))],
    ['a CHANGELOG was seeded at the manifest version', fs.readFileSync(path.join(made, 'CHANGELOG.md'), 'utf8').includes('## [0.0.1]')],
    ['permission justifications are EMPTY, so policy-check is red by design', JSON.parse(fs.readFileSync(path.join(made, 'tool.json'), 'utf8')).policy.permissions.storage === '']
  ];
  for (const [label, cond] of checks) cond ? ok(label) : bad(label, 'condition false');

  expect('and the new tool is discovered', { script: 'discover.mjs', argv: ['--json'], root, code: 0, contains: 'tabdigest' });
  expect('its empty justification really does fail policy-check', {
    script: 'policy-check.mjs', argv: ['tabdigest'], root, code: 1, contains: 'no justification at all: storage'
  });
  expect('running it again refuses rather than overwriting', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Tab Digest', '--id', 'tabdigest2'],
    root, code: 2, contains: 'already exists'
  });
  expect('a duplicate id is refused', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Other Thing', '--id', 'tabdigest'],
    root, code: 2, contains: 'already used by'
  });
  expect('an uppercase id is refused', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Nope', '--id', 'Nope'],
    root, code: 2, contains: 'not lowercase-kebab'
  });
  expect('a lowercase category is refused', {
    script: 'new-tool.mjs', argv: ['--category', 'extension', '--name', 'Nope', '--id', 'nope'],
    root, code: 2, contains: 'not Capitalized_Singular'
  });
}

/* A half-built templates/tool with no manifest must not win precedence over a
   complete _skeleton. This is not hypothetical: templates/tool/ appeared in the
   real repo holding only README.md and tool.json while another agent was
   building it, and the first version of this script stamped a two-file scaffold
   from it and called that a success. */
expect('a template with no manifest.json is refused, and names the fallback', {
  script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Half Built', '--id', 'halfbuilt'],
  code: 2, contains: 'has no manifest.json',
  root: fixture(r2 => {
    w(r2, 'templates/tool/tool.json', '{ "id": "template" }\n');
    w(r2, 'templates/tool/README.md', '# still being written\n');
    w(r2, '_skeleton/manifest.json', JSON.stringify({ manifest_version: 3, version: '0.0.1', name: 'x' }, null, 2) + '\n');
    w(r2, '_skeleton/background.js', "'use strict';\n");
  })
});
expect('and --template can then point at the complete one', {
  script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Half Built', '--id', 'halfbuilt', '--template', '_skeleton', '--dry-run'],
  code: 0, contains: 'dry run',
  root: fixture(r2 => {
    w(r2, 'templates/tool/tool.json', '{ "id": "template" }\n');
    w(r2, '_skeleton/manifest.json', JSON.stringify({ manifest_version: 3, version: '0.0.1', name: 'x' }, null, 2) + '\n');
    w(r2, '_skeleton/background.js', "'use strict';\n");
  })
});

/* =====================================================================
   check-store-packages.mjs

   The gate whose subject is the BUILT ARTIFACT rather than the source. Every
   mutation below is a real zip written byte by byte, because the defect it was
   written for is exactly a case where the source was right and the zip was not:
   on 2026-08-20 six -firefox.zip in Extension/Full_Screen_Shot/publish/ carried
   `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` while the overlay beside them
   carried `fullshot@nikatru.com`. A fixture that mocked the reader would have
   proved nothing about that.
   ===================================================================== */
console.log('\ncheck-store-packages.mjs');

/* A minimal STORED (method 0) zip. No compression, so the test depends on no
   codec and the reader's deflate path is exercised by the real packages the
   `package` job builds rather than by a synthetic one here. */
function zipOf(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nb = Buffer.from(name, 'utf8'), body = Buffer.from(text, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(body.length, 22);
    lh.writeUInt16LE(nb.length, 26);
    locals.push(lh, nb, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(body.length, 24);
    ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nb);
    offset += 30 + nb.length + body.length;
  }
  const lp = Buffer.concat(locals), cp = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cp.length, 12); eocd.writeUInt32LE(lp.length, 16);
  return Buffer.concat([lp, cp, eocd]);
}

/* The fixture tool declares only `chromium`, so a Firefox package needs the
   target adding too — a package for a target the tool does not declare is a
   different question, and conflating them would make these cases ambiguous. */
function withPackage(zipName, manifest, { firefoxTarget = true, identity = true } = {}) {
  return fixture(root => {
    if (identity) {
      writeJson(root, TOOL + '/publish/identity.json', { slug: 'goodtool', ownerDomain: 'example.test' });
    }
    if (firefoxTarget) {
      const t = readJson(root, TOOL + '/tool.json');
      t.targets.firefox = { overlay: 'publish/manifest.firefox.json' };
      writeJson(root, TOOL + '/tool.json', t);
      /* The overlay must EXIST: toolinfo.mjs treats a `targets.firefox.overlay`
         pointing at a missing file as a tool.json contract error, which makes
         every gate exit 2 before it reads anything. Writing the declaration
         without the file is how the first draft of these cases turned nine
         mutations into nine identical CANNOT RUNs. */
      writeJson(root, TOOL + '/publish/manifest.firefox.json', {
        browser_specific_settings: { gecko: { id: 'goodtool@example.test', strict_min_version: '128.0' } }
      });
    }
    const abs = path.join(root, TOOL, 'publish', zipName);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    /* Three shapes, and the Buffer case is here because leaving it out is a
       real bug this file caught: `zipOf({...})` returns a Buffer, fell through
       to the object branch, and was JSON.stringify'd INTO a manifest.json —
       so the "archive with no manifest" case shipped an archive that had one,
       and the gate correctly graded it and the assertion failed. A fixture that
       does not build what its name says builds is a test of nothing.
         string -> written as-is (a file that is not a zip at all)
         Buffer -> written as-is (a zip this case assembled itself)
         object -> wrapped as the archive's manifest.json */
    const bytes = Buffer.isBuffer(manifest) ? manifest
      : typeof manifest === 'string' ? Buffer.from(manifest, 'utf8')
        : zipOf({ 'manifest.json': JSON.stringify(manifest) });
    fs.writeFileSync(abs, bytes);
  });
}

const goodFfManifest = {
  manifest_version: 3, version: '1.0.0', name: 'x',
  browser_specific_settings: { gecko: { id: 'goodtool@example.test', strict_min_version: '128.0' } }
};

expect('a package whose gecko.id agrees with identity.json passes', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0, contains: 'goodtool@example.test',
  root: withPackage('goodtool-1.0.0-firefox.zip', goodFfManifest)
});

/* 🔴 THE RECORDED DEFECT. */
expect('a BUILT package carrying the placeholder gecko.id is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'MUST NOT BE UPLOADED TO AMO',
  root: withPackage('goodtool-1.0.0-firefox.zip', {
    ...goodFfManifest,
    browser_specific_settings: { gecko: { id: 'goodtool@REPLACE-WITH-YOUR-DOMAIN.example' } }
  })
});

/* Two real-looking domains. No placeholder test catches this one, and AMO fixes
   whichever reaches it first — permanently. */
expect('a package whose gecko.id disagrees with identity.json is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'agrees with publish/identity.json',
  root: withPackage('goodtool-1.0.0-firefox.zip', {
    ...goodFfManifest,
    browser_specific_settings: { gecko: { id: 'goodtool@someone-elses-domain.test' } }
  })
});

expect('a Firefox package with no gecko.id at all is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'carries a gecko.id',
  root: withPackage('goodtool-1.0.0-firefox.zip', {
    ...goodFfManifest, browser_specific_settings: { gecko: { strict_min_version: '128.0' } }
  })
});

expect('a listed add-on that self-hosts updates is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'must not self-host updates',
  root: withPackage('goodtool-1.0.0-firefox.zip', {
    ...goodFfManifest,
    browser_specific_settings: { gecko: { id: 'goodtool@example.test', update_url: 'https://example.test/u.json' } }
  })
});

/* The chromium package goes to Chrome AND Edge unchanged, so a Firefox-only key
   in it ships twice. The target is decided by CONTENT, so this zip is graded as
   a Firefox one — which is itself the finding: it is named as a chromium
   artifact and is not one. */
expect('a chromium-named package carrying browser_specific_settings is not silently accepted', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'MUST NOT BE UPLOADED TO AMO',
  root: withPackage('goodtool-1.0.0.zip', {
    manifest_version: 3, version: '1.0.0', name: 'x',
    browser_specific_settings: { gecko: { id: 'goodtool@REPLACE-WITH-YOUR-DOMAIN.example' } }
  })
});

expect('a stale version beside the current one WARNS rather than passing silently', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0, contains: 'is v0.9.0, the tree is v1.0.0',
  root: withPackage('goodtool-0.9.0-firefox.zip', { ...goodFfManifest, version: '0.9.0' })
});

/* An unreadable archive must not read as a clean one. */
expect('a .zip that is not a zip is a finding, not a skip', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'is a readable zip',
  root: withPackage('goodtool-1.0.0-firefox.zip', 'this is not a zip at all, it is prose')
});

expect('an archive with no manifest.json is a finding, not a skip', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'contains a manifest.json',
  root: withPackage('goodtool-1.0.0-firefox.zip', zipOf({ 'README.md': '# not a store package' }))
});

/* 🔴 THE ANTI-VACUITY PAIR. Zero packages is the CI state and it is legitimate,
   so it exits 0 — and the run must SAY so, because "0 packages, clean" and
   "12 packages, clean" printing the same thing is the failure this whole file
   exists to prevent. */
expect('zero packages exits 0 but says out loud that it proved nothing', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0, contains: 'ZERO PACKAGES WERE PRESENT',
  root: fixture(root => { writeJson(root, TOOL + '/publish/identity.json', { slug: 'goodtool', ownerDomain: 'example.test' }); })
});

expect('a tool declaring no targets CANNOT RUN rather than passing', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 2, contains: 'declares no `targets`',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    delete t.targets;
    writeJson(root, TOOL + '/tool.json', t);
  })
});

/* =====================================================================
   check-store-metadata.mjs

   The STORE axis. Two builds, three stores — so the mutations that matter are
   the ones where those two axes are allowed to drift apart, and the one where a
   store limit arrives without anybody having read it from the store.
   ===================================================================== */
console.log('\ncheck-store-metadata.mjs');

const STORE_FILES = {
  'title.txt': 'Good Tool',
  'short-description.txt': 'A fixture extension used by the scripts self-test.',
  'long-description.txt': 'x'.repeat(400),
  'category.txt': 'Productivity',
};
const SHARED_FILES = {
  'privacy-policy-url.txt': 'https://example.test/privacy',
  'support-url.txt': 'https://example.test/support',
  'screenshots/README.md': '# 1280x800, the one size all three stores take\n',
};

/* A complete, correct store layer on the fixture tool: three rows, two targets,
   every directory populated. Mutations below start from this and break one
   thing, so a failure can only be the thing that was broken. */
function withStores(mutate = () => {}) {
  return fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.targets = { chromium: { stores: ['chrome', 'edge'] }, firefox: { overlay: 'publish/manifest.firefox.json' } };
    writeJson(root, TOOL + '/publish/manifest.firefox.json', {
      browser_specific_settings: { gecko: { id: 'goodtool@example.test', strict_min_version: '128.0' } }
    });
    t.storeMetadata = {
      sharedDir: 'store/_shared',
      stores: {
        chrome: { target: 'chromium', dir: 'store/chrome', served: false },
        edge: { target: 'chromium', dir: 'store/edge', served: false },
        firefox: { target: 'firefox', dir: 'store/firefox', served: false },
      },
    };
    const dirs = { chrome: 'store/chrome', edge: 'store/edge', firefox: 'store/firefox' };
    for (const d of Object.values(dirs)) {
      for (const [f, body] of Object.entries(STORE_FILES)) w(root, TOOL + '/' + d + '/' + f, body + '\n');
    }
    for (const [f, body] of Object.entries(SHARED_FILES)) w(root, TOOL + '/store/_shared/' + f, body + '\n');
    mutate(t, root);
    writeJson(root, TOOL + '/tool.json', t);
  });
}

expect('a complete three-store layer passes', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 0, contains: '3 store row(s) graded',
  root: withStores()
});

/* 🔴 THE AXIS MUTATIONS — the two that let builds and stores drift apart. */
expect('a store naming a target that does not exist is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'which is not in targets',
  root: withStores(t => { t.storeMetadata.stores.edge.target = 'webkit'; })
});
expect('a target no store claims is caught — an artifact going nowhere', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'is claimed by at least one store',
  root: withStores(t => { t.targets.safari = { overlay: null }; })
});

/* The three declarations of the store set must agree. */
expect('a store set that disagrees with the schema vocabulary is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'two declarations of one fact',
  root: withStores(t => { delete t.storeMetadata.stores.firefox; })
});

/* served is a GATE — the same absence, two verdicts. */
expect('a MISSING directory on an unserved store PRINTS and exits 0', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 0, contains: 'NO TREE (not served)',
  root: withStores((t, root) => { fs.rmSync(path.join(root, TOOL, 'store', 'chrome'), { recursive: true, force: true }); })
});
expect('the SAME missing directory on a SERVED store FAILS', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'the listing is live',
  root: withStores((t, root) => {
    t.storeMetadata.stores.chrome.served = true;
    fs.rmSync(path.join(root, TOOL, 'store', 'chrome'), { recursive: true, force: true });
  })
});

/* What is owner-gated is CREATING a listing, not KEEPING one. */
expect('an EMPTIED listing field fails even on an unserved store', {
  /* A single-line fragment on purpose: Report.fail() re-indents every wrapped
     line by eight spaces, so a `contains` that spans the wrap never matches
     even when the gate is behaving perfectly. */
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'An empty listing field is worse than a missing one',
  root: withStores((t, root) => { w(root, TOOL + '/store/chrome/title.txt', '   \n'); })
});
expect('a missing required listing field is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'category.txt exists',
  root: withStores((t, root) => { fs.rmSync(path.join(root, TOOL, 'store', 'edge', 'category.txt')); })
});

expect('an orphan directory under store/ is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'orphaned, unreachable',
  root: withStores((t, root) => { w(root, TOOL + '/store/opera/title.txt', 'left behind\n'); })
});

/* 🔴 THE LIMIT MUTATIONS. An invented limit fires on correct input. */
expect('a limit with no source is REFUSED rather than enforced', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'An invented limit fires on CORRECT input',
  root: withStores(t => { t.storeMetadata.stores.chrome.limits = { 'title.txt': { max: 75 } }; })
});
expect('a value over a SOURCED limit is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'against a maximum of 5',
  root: withStores(t => {
    t.storeMetadata.stores.chrome.limits = { 'title.txt': { max: 5, source: 'https://developer.chrome.com/x (fetched 2026-08-20)' } };
  })
});
expect('a value under a SOURCED minimum is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'against a minimum of 250',
  root: withStores(t => {
    t.storeMetadata.stores.edge.limits = { 'title.txt': { min: 250, source: 'https://learn.microsoft.com/x (fetched 2026-08-20)' } };
  })
});

/* Anti-vacuity. */
expect('an emptied store set CANNOT RUN rather than passing', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'row set IS the subject',
  root: withStores(t => { t.storeMetadata.stores = {}; })
});
expect('a tool with targets but NO storeMetadata is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'checked by nothing',
  root: withStores(t => { delete t.storeMetadata; })
});

/* =====================================================================
   argument handling
   ===================================================================== */
console.log('\nargument handling');
expect('a mistyped flag is refused, not ignored', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warings-as-errors'], root: fixture(), code: 2, contains: 'unknown option'
});
expect('naming no tool at all refuses', {
  script: 'policy-check.mjs', argv: [], root: fixture(), code: 2, contains: 'no tool given'
});

/* ---------------- summary ---------------- */
console.log('');
if (!KEEP) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
else console.log('fixtures kept at ' + TMP);

if (FAILURES.length) {
  console.log(FAILURES.length + ' of ' + (PASS + FAILURES.length) + ' checks FAILED');
  for (const f of FAILURES) console.log('  - ' + f.label);
  process.exit(1);
}
console.log('ALL PASS — ' + PASS + ' checks, every gate proven to bite on a real mutation');
process.exit(0);
