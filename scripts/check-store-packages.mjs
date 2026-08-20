/* check-store-packages.mjs — grade the BUILT store package, not the source it
   was built from.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/check-store-packages.mjs fullshot
     node scripts/check-store-packages.mjs fullshot --dir dist
     node scripts/check-store-packages.mjs --all

   🔴 WHY THIS EXISTS — the source is right and the artifacts are wrong.

   Measured 2026-08-20 by inflating manifest.json out of each of the twelve zips
   in Extension/Full_Screen_Shot/publish/:

     the six -firefox.zip   gecko.id = fullshot@REPLACE-WITH-YOUR-DOMAIN.example
     the six chromium zips  no browser_specific_settings at all  (correct)
     publish/manifest.firefox.json   gecko.id = fullshot@nikatru.com  (correct)

   Every SOURCE-side gate is green and every one of them is right.
   policy-check.mjs compares the overlay's gecko.id to publish/identity.json and
   passes. pack.mjs refuses to write a package with a placeholder id (:478).
   The overlay was corrected on 2026-08-18 and the id derived from identity.json.
   None of that reaches back into a zip built on 2026-08-12 or 2026-08-15, and
   nothing in this repository had ever opened one to look.

   WHY IT MATTERS MORE THAN AN ORDINARY STALE ARTIFACT

   Mozilla's addons-server documentation: an add-on's guid "cannot be restored
   and will forever be unusable for submission". And the placeholder PASSES AMO
   validation rather than being rejected — it is a syntactically valid id on a
   domain nobody owns. So the failure mode is not a rejected upload that somebody
   retries. It is an accepted upload that permanently binds the add-on to an
   identity we do not control, discovered afterwards, with no way back.

   The hazard is precisely one thing: a human uploading one of these files by
   hand. That is why the subject here is the ARTIFACT and not the source.

   ── ⚠️ WHAT THIS GATE CAN AND CANNOT REACH, STATED UP FRONT ────────────────
   🔴 **THE PACKAGE LIMB CANNOT BITE IN CI, AND SAYING SO IS THE POINT.**
   Extension/Full_Screen_Shot/.gitignore ignores `*.zip`, so no store package is
   tracked and a runner's checkout contains none. On a clean clone this gate
   grades zero packages — and it PRINTS that count on every run rather than
   reporting a silent pass, because "0 packages, all clean" and "12 packages, all
   clean" must never print the same way.

   ⚠️ AND THE TWO .gitignore FILES DISAGREE ABOUT THAT, WHICH IS WHY IT WENT
   UNNOTICED. The ROOT .gitignore says, in as many words, that a recursive glob
   over `publish/` zips is "deliberately NOT ignored" — its own words, "each
   release zip is a golden master". (The glob is not written out here: a `*` and
   a `/` adjacent inside a block comment ends the comment, which is exactly how
   the first draft of this file failed to parse.)
   The nested Extension/Full_Screen_Shot/.gitignore ignores `*.zip` outright as a
   build output. The nested file wins for files beneath it, so the root file's
   stated intent has never taken effect and twelve artifacts sit in a directory
   no gate can see. That contradiction is NOT resolved here — tracking 5.5 MB of
   binaries is a decision, not a fix — but it is now written down somewhere that
   is read.

   So the enforcement surface for the package limb is a developer's machine and
   this command. That is the same shape as the platform repo's local-only
   guards, and it is honest about it in its output.

   ── THE FLOOR IS THE TARGET LIST, WHICH IS NEVER EMPTY ─────────────────────
   A gate whose subject is "the zips that happen to be lying around" reports the
   same thing when there are none and when they are all clean. So the subject is
   the TARGETS a tool declares in tool.json — always at least one — and each is
   reported as graded-from-a-package or as having no package present. Zero
   targets is CANNOT RUN, not a pass.

   ── TARGET IS DECIDED BY CONTENT, NEVER BY FILENAME ────────────────────────
   Two packers write into this tree with two naming schemes — pack.mjs writes
   `<id>-<target>.zip` into --out, publish/package.node.js writes
   `<id>-<version>[-firefox].zip` into publish/. A filename is a claim about
   what a file is; the manifest inside it is the fact. A zip whose manifest
   carries `browser_specific_settings.gecko` IS an AMO package whatever it is
   called, and one that does not is a Chrome/Edge package.

   Exit codes: 0 everything agrees · 1 something disagrees · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot, resolveTool, loadAllTools, readJson } from './lib/toolinfo.mjs';
import { readZipEntry, ZipUnreadable } from './lib/zip.mjs';

/* The placeholder the first Firefox manifest shipped with. Same test
   verify-firefox-package.node.js and pack.mjs apply, deliberately: an id this
   repository would refuse to BUILD must also be one it refuses to have BUILT. */
const PLACEHOLDER_ID = /REPLACE-WITH-YOUR-DOMAIN|\.example$/i;
/* MDN: email-style id, 80 characters or less. */
const GECKO_ID_RE = /^[a-zA-Z0-9\-._]*@[a-zA-Z0-9\-._]+$/;

/* Where a built package can be found. `publish/` is where
   publish/package.node.js writes; `dist/` is where pack.mjs writes and what
   ci.yml and release.yml pass as --out. Both are searched so the gate does not
   depend on which packer last ran. */
const DEFAULT_DIRS = ['publish', 'dist'];

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['dir', 'all', 'repo-root']);
const root = repoRoot(args);

const tools = args.bool('all')
  ? loadAllTools(root)
  : [resolveTool(root, args.positional[0])];
if (!tools.length) die('no tool resolved — nothing to grade.');

const searchDirs = args.has('dir') && args.get('dir') !== true ? [String(args.get('dir'))] : DEFAULT_DIRS;

const r = new Report('check-store-packages · ' + tools.map(t => t.id).join(', '));

let targetsGraded = 0;
let packagesGraded = 0;
let packagesUnreadable = 0;

for (const tool of tools) {
  /* ---------------- the identity every AMO package must carry ---------------- */
  const idRel = 'publish/identity.json';
  const idAbs = path.join(tool.dirAbs, idRel);
  let derivedGeckoId = null;
  if (fs.existsSync(idAbs)) {
    const p = readJson(idAbs);
    if (p.error) {
      r.fail(tool.rel + '/' + idRel + ' parses', p.error);
    } else if (p.value && typeof p.value.slug === 'string' && typeof p.value.ownerDomain === 'string' &&
               p.value.slug && p.value.ownerDomain) {
      derivedGeckoId = p.value.slug + '@' + p.value.ownerDomain;
    }
  }

  /* ---------------- the floor: the targets this tool declares ---------------- */
  const targets = (tool.targets && typeof tool.targets === 'object' && !Array.isArray(tool.targets))
    ? Object.keys(tool.targets)
    : [];
  if (!targets.length) {
    die(tool.rel + '/tool.json declares no `targets`, so this gate has no subject for it.\n' +
      'A tool with no target ships to no store, and grading its packages would range over nothing.');
  }

  /* ---------------- find every package, decide what it is by content --------
     🔴 A DIRECTORY NAME IS RESOLVED AGAINST BOTH ROOTS, BECAUSE THE TWO PACKERS
     DISAGREE ABOUT WHICH ROOT IT MEANS. `publish/package.node.js` writes into
     the TOOL's publish/; `pack.mjs --out dist` is invoked from the repository
     root by ci.yml and release.yml and writes `dist/` THERE, which is what
     `verify-refs.mjs --zip dist/<id>-<target>.zip` then reads. Resolving against
     only one of them is how this gate first ran: it reported "no built package
     found" over a directory holding two, and exited 0. A search that misses its
     subject and prints a clean line is the exact failure this file exists for,
     so both roots are searched and an absolute --dir is honoured as given. */
  const found = [];
  const seen = new Set();
  for (const dir of searchDirs) {
    const roots = path.isAbsolute(dir) ? [dir] : [path.join(tool.dirAbs, dir), path.join(root, dir)];
    for (const abs of roots) {
      if (seen.has(abs)) continue;
      seen.add(abs);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
      for (const name of fs.readdirSync(abs).filter(n => n.toLowerCase().endsWith('.zip')).sort()) {
        found.push({ rel: path.relative(root, path.join(abs, name)).split(path.sep).join('/'), abs: path.join(abs, name), name });
      }
    }
  }

  const perTarget = new Map(targets.map(t => [t, 0]));

  for (const pkg of found) {
    let raw;
    try {
      raw = readZipEntry(pkg.abs, 'manifest.json');
    } catch (e) {
      if (!(e instanceof ZipUnreadable)) throw e;
      packagesUnreadable++;
      r.fail(pkg.rel + ' is a readable zip', e.message + '\n' +
        'A package this gate cannot open must not be reported as one it graded.');
      continue;
    }
    if (raw === null) {
      packagesUnreadable++;
      r.fail(pkg.rel + ' contains a manifest.json',
        'The archive opened but has no manifest.json entry, so it is not a store package at all —\n' +
        'and nothing about its identity could be read.');
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      packagesUnreadable++;
      r.fail(pkg.rel + ' manifest.json parses', 'inside the zip: ' + e.message);
      continue;
    }
    packagesGraded++;

    const gecko = ((manifest.browser_specific_settings || {}).gecko) || null;
    const isFirefox = gecko !== null;
    const target = isFirefox ? 'firefox' : 'chromium';
    if (perTarget.has(target)) perTarget.set(target, perTarget.get(target) + 1);

    if (isFirefox) {
      const gid = String(gecko.id || '');
      if (!gid) {
        r.fail(pkg.rel + ' carries a gecko.id',
          'browser_specific_settings.gecko is present with no `id`. AMO requires one to sign an MV3\n' +
          'add-on, and a package without it cannot be submitted.');
      } else if (PLACEHOLDER_ID.test(gid)) {
        r.fail(pkg.rel + ' gecko.id is not the placeholder',
          'the built package carries gecko.id "' + gid + '".\n' +
          'THIS PACKAGE MUST NOT BE UPLOADED TO AMO. The id is a placeholder on a domain nobody owns,\n' +
          'and it PASSES AMO validation rather than being rejected — so the upload would succeed and\n' +
          'bind the add-on to that identity permanently. Mozilla: a guid "cannot be restored and will\n' +
          'forever be unusable for submission".\n' +
          (derivedGeckoId ? 'The source is already correct — ' + tool.rel + '/publish/manifest.firefox.json\n' +
            'and ' + idRel + ' both imply "' + derivedGeckoId + '". This file simply predates that fix.\n' : '') +
          'FIX: delete this stale artifact and rebuild. Nothing reads it, and a package that cannot be\n' +
          'uploaded has no use that its presence beside uploadable ones does not endanger.');
      } else if (!GECKO_ID_RE.test(gid)) {
        r.fail(pkg.rel + " gecko.id matches Mozilla's email-style format",
          'found "' + gid + '", which is not <local>@<domain>.');
      } else if (gid.length > 80) {
        r.fail(pkg.rel + ' gecko.id is 80 characters or less', 'found ' + gid.length + ' characters.');
      } else if (derivedGeckoId && gid !== derivedGeckoId) {
        r.fail(pkg.rel + ' gecko.id agrees with ' + idRel,
          'the package carries "' + gid + '" and ' + idRel + ' implies "' + derivedGeckoId + '".\n' +
          'Both look real, so no placeholder test catches this, and AMO fixes whichever reaches it\n' +
          'FIRST — permanently. The package was built before the identity changed, or from a tree that\n' +
          'is not this one.');
      } else {
        r.pass(pkg.rel + ' gecko.id', gid + (derivedGeckoId ? ' — agrees with ' + idRel : ''));
      }
      if ('update_url' in gecko) {
        r.fail(pkg.rel + ' has no gecko.update_url',
          'a listed AMO add-on must not self-host updates, and this package declares update_url.');
      }
    } else {
      /* The Chrome/Edge package. The same bytes go to both stores, so a
         Firefox-only key here is shipped twice. */
      if ('browser_specific_settings' in manifest) {
        r.fail(pkg.rel + ' carries no browser_specific_settings',
          'this is the Chromium package — the identical file is uploaded to Chrome Web Store AND\n' +
          'Edge Add-ons — and it declares a Firefox-only key.');
      } else {
        r.pass(pkg.rel + ' is a clean Chromium package', 'no Firefox-only keys; v' + (manifest.version || '?'));
      }
    }

    /* A package whose version is not the tool's current one is by definition a
       thing that can be uploaded by mistake. Not fatal — old artifacts are
       allowed to exist — but never silent. */
    if (tool.manifest && manifest.version && manifest.version !== tool.manifest.version) {
      r.warn(pkg.rel + ' is v' + manifest.version + ', the tree is v' + tool.manifest.version,
        'a stale artifact sitting beside a current one is the thing that gets uploaded by hand.');
    }
  }

  /* ---------------- every target is accounted for, present or not ----------- */
  for (const [target, n] of perTarget) {
    targetsGraded++;
    if (n === 0) {
      r.note('target "' + target + '" (' + tool.rel + '): no built package found in ' + searchDirs.join('/') +
        ' — nothing to grade for it in this checkout.');
    } else {
      r.pass('target "' + target + '" — ' + n + ' package(s) graded', tool.rel);
    }
  }
}

if (targetsGraded === 0) {
  die('zero targets were graded across ' + tools.length + ' tool(s).\n' +
    'The subject set is empty, so a pass here would mean nothing.');
}

r.blank();
r.note(packagesGraded + ' store package(s) opened and graded, ' + packagesUnreadable + ' unreadable, across ' +
  targetsGraded + ' declared target(s).');
if (packagesGraded === 0) {
  r.note('⚠️ ZERO PACKAGES WERE PRESENT. Store packages are gitignored (`*.zip`), so a CI checkout has none and');
  r.note('   this run proved nothing about any artifact. The package limb bites only where the artifacts are:');
  r.note('   a developer machine, after a build, run by hand. Read this line rather than the exit code.');
}

process.exit(r.finish());
