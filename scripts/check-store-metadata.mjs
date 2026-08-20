/* check-store-metadata.mjs — one directory per STORE, and the store axis is not
   the build axis.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/check-store-metadata.mjs fullshot
     node scripts/check-store-metadata.mjs --all

   🔴 TWO BUILDS, THREE STORES. Measured 2026-08-20 by running the packer:
   `pack.mjs` emits exactly `chromium` and `firefox`, and `tool.json` declares
   `targets.chromium.stores = ["chrome","edge"]`. The chromium zip ships to
   Chrome Web Store AND Edge Add-ons byte-identical — `release.yml` says so in as
   many words, "the identical file goes to both".

   So there are two artifacts and three listings, and they are different axes.
   A directory tree that put a build under each store name would store two
   artifacts three times. A directory tree that puts a LISTING under each store
   name stores three genuinely different things: the name limits are 75 / 45 /
   50, the store icons are 128x128 / 300x300 / 32+64, Chrome takes one category
   and AMO takes two, and each store issues its own permanent id.

   ── WHY THE `target` FIELD IS THE LOAD-BEARING ONE ──────────────────────────
   `chrome` and `edge` both name `chromium`. That is what makes the shared build
   a DECLARATION rather than a coincidence: this guard asserts every store's
   `target` is a real entry of `targets`, and that every target is claimed by at
   least one store. A third build cannot appear behind a third store name without
   `targets` gaining a third entry, in the open, in a diff.

   ── THE STORE VOCABULARY IS NOT DECLARED IN tool.json ───────────────────────
   It comes from `scripts/schema/tool.schema.json` -> `properties.listings
   .properties`, which `check-catalog.mjs` already treats as authoritative for
   its host table. This guard derives the SAME set and holds three declarations
   to each other — the schema, `storeMetadata.stores`, and the tool's own
   `listings`. A fourth list of store names would be the second declaration and
   the first to drift, which is the defect this repository names in its own
   README: "a hand-typed row is a second place for the same fact to be written,
   and the second place is the one that goes stale."

   ── THE PRINT / FAIL SPLIT IS A RELATIONSHIP, NOT A MOOD ────────────────────
     directory missing, store `served: false`   -> PRINT   (this is today)
     directory missing, store `served: true`    -> FAIL
     directory present but a required file empty-> FAIL, at any served state
     a directory no store declares              -> FAIL    (an orphan listing)
     a limit with no `source`                   -> FAIL    (see below)
     zero stores graded                         -> CANNOT RUN, exit 2

   What is owner-gated is CREATING a listing, not KEEPING one. A guard that only
   printed would let anyone empty `store/chrome/title.txt` and stay green.

   ── A LIMIT WITH NO SOURCE IS REFUSED, NOT ENFORCED ─────────────────────────
   Every `max`/`min` in `storeMetadata` must carry a URL. An invented limit fires
   on CORRECT input, and this factory has already rejected its own fixture at 129
   characters against a made-up "120 or fewer". Three real limits are recorded as
   `_unverified` and deliberately NOT enforced — Edge's 45-character name, AMO's
   50, and Chrome's long-description maximum — because none could be read from
   the store's own documentation. MDN states two of them; MDN is a secondary
   source for another vendor's rule.

   ⚠️ WHAT IT CANNOT SEE: whether the listing copy is any good, and whether the
   store would accept it. It checks that the fields exist, are non-empty, and sit
   inside the limits somebody actually sourced.

   Exit codes: 0 everything agrees · 1 something disagrees · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot, resolveTool, loadAllTools, readText } from './lib/toolinfo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_REL = 'scripts/schema/tool.schema.json';

/* Files every store listing needs, whatever the store. The NAMES are shared on
   purpose even where the stores' own vocabulary differs (AMO calls the short one
   a "summary"): what differs between stores is the LIMITS, not which fields
   exist, and one vocabulary is what lets a reader diff two listings. */
const REQUIRED_PER_STORE = ['title.txt', 'short-description.txt', 'long-description.txt', 'category.txt'];
/* Material all three stores accept, kept once. 1280x800 is the only screenshot
   size Chrome, Edge and AMO all take — measured from their own docs. */
const REQUIRED_SHARED = ['privacy-policy-url.txt', 'support-url.txt', 'screenshots/README.md'];

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['all', 'repo-root']);
const root = repoRoot(args);

const tools = args.bool('all') ? loadAllTools(root) : [resolveTool(root, args.positional[0])];
if (!tools.length) die('no tool resolved — nothing to grade.');

/* ── the store vocabulary, from the schema ──────────────────────────────────
   Read relative to THIS FILE rather than to --repo-root, for the reason
   check-catalog.mjs already states about the same file: the vocabulary belongs
   to the TOOLCHAIN while the tree is the SUBJECT being graded. Resolving it
   against the subject would mean a fixture tree could supply its own idea of
   which stores exist, which is the second declaration this guard exists to
   prevent. */
const schemaAbs = path.join(HERE, 'schema', 'tool.schema.json');
if (!fs.existsSync(schemaAbs)) {
  die(SCHEMA_REL + ' does not exist, so the store vocabulary is derived from nothing.\n' +
    'That file is where the store ids live; without it this guard would accept any set of names.');
}
let VOCAB;
try {
  const schema = JSON.parse(fs.readFileSync(schemaAbs, 'utf8'));
  VOCAB = Object.keys(schema?.properties?.listings?.properties ?? {});
} catch (e) {
  die('could not parse ' + SCHEMA_REL + ': ' + e.message);
}
if (!VOCAB.length) {
  die(SCHEMA_REL + ' declares no store ids under properties.listings.properties.\n' +
    'An empty vocabulary would make every storeMetadata block trivially correct.');
}

const r = new Report('check-store-metadata · ' + tools.map((t) => t.id).join(', '));
r.note('store vocabulary, from ' + SCHEMA_REL + ': ' + VOCAB.join(', '));

let storesGraded = 0;
let filesChecked = 0;

const charCount = (text) => [...text.trim()].length; // code points, not UTF-16 units

for (const tool of tools) {
  const sm = tool.raw?.storeMetadata ?? tool.storeMetadata;
  if (!sm || typeof sm !== 'object') {
    /* A tool that ships to no store is legitimate. A tool that declares
       `listings` or `targets` and no storeMetadata is a tool whose listings
       nothing checks. */
    if (tool.targets || tool.listings) {
      r.fail(tool.rel + ' declares storeMetadata',
        'tool.json has `targets` and/or `listings` but no `storeMetadata` block, so its store listings are\n' +
        'checked by nothing. Add one row per store id (' + VOCAB.join(', ') + ').');
    } else {
      r.note(tool.rel + ': no targets and no listings — ships to no store, nothing to grade.');
    }
    continue;
  }

  const rows = sm.stores;
  if (!rows || typeof rows !== 'object' || Array.isArray(rows) || !Object.keys(rows).length) {
    r.fail(tool.rel + ' storeMetadata.stores is a non-empty object',
      'found ' + (Array.isArray(rows) ? 'an array' : rows === undefined ? 'nothing' : typeof rows) + '.\n' +
      'The row set IS the subject of this guard; empty means every check below ranges over nothing.');
    continue;
  }

  /* ── 1. three declarations of the store set, held to each other ────────── */
  const declared = Object.keys(rows).sort();
  const vocab = [...VOCAB].sort();
  const listings = Object.keys(tool.listings ?? {}).sort();

  r.check(tool.rel + ' storeMetadata.stores matches the schema vocabulary',
    declared.join() === vocab.join(),
    declared.join(', '),
    'storeMetadata.stores is [' + declared.join(', ') + '] and the schema vocabulary is [' + vocab.join(', ') + '].\n' +
    'These are two declarations of one fact. Add the store to both, or to neither.');

  if (listings.length) {
    r.check(tool.rel + ' listings matches the schema vocabulary',
      listings.join() === vocab.join(),
      listings.join(', '),
      'tool.json listings is [' + listings.join(', ') + '] and the schema vocabulary is [' + vocab.join(', ') + '].');
  }

  /* ── 2. the build axis: every target claimed, no invented target ───────── */
  const targets = Object.keys(tool.targets ?? {});
  const claimed = new Set();
  for (const [id, row] of Object.entries(rows)) {
    if (!row || typeof row.target !== 'string') {
      r.fail(tool.rel + ' store "' + id + '" names a target',
        'every store row must say which entry of `targets` builds the artifact it receives.');
      continue;
    }
    claimed.add(row.target);
    r.check('store "' + id + '" builds from a real target',
      targets.includes(row.target), row.target,
      'store "' + id + '" names target "' + row.target + '", which is not in targets [' + targets.join(', ') + '].');
  }
  for (const t of targets) {
    r.check('target "' + t + '" is claimed by at least one store',
      claimed.has(t), [...Object.entries(rows)].filter(([, x]) => x?.target === t).map(([k]) => k).join(' + '),
      'targets."' + t + '" is built by pack.mjs and no store row names it, so nothing checks where that\n' +
      'artifact goes. Either a store row is missing or the target is dead.');
  }

  /* ── 3. per-store directories ──────────────────────────────────────────── */
  const seenDirs = new Set();
  for (const [id, row] of Object.entries(rows)) {
    if (!row || typeof row.dir !== 'string' || !row.dir) {
      r.fail(tool.rel + ' store "' + id + '" declares a dir', 'no `dir` on the row, so there is no directory to grade.');
      continue;
    }
    storesGraded++;
    seenDirs.add(row.dir.replace(/\/+$/, ''));
    const abs = path.join(tool.dirAbs, row.dir);
    const rel = tool.rel + '/' + row.dir;
    const served = row.served === true;

    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      const why = rel + ' does not exist.';
      if (served) {
        r.fail('store "' + id + '" listing directory exists',
          why + '\nThis store is `served: true` — the listing is live and nothing in this repo can diff it.');
      } else {
        r.note('NO TREE (not served): ' + why + ' Store "' + id + '" is `served: false`; creating a listing is ' +
          'owner work, so this prints rather than blocking the build.');
      }
      continue;
    }

    for (const f of REQUIRED_PER_STORE) {
      const fAbs = path.join(abs, f);
      if (!fs.existsSync(fAbs)) {
        r.fail(rel + '/' + f + ' exists', 'required for every store listing and it is absent.');
        continue;
      }
      const text = readText(fAbs);
      filesChecked++;
      if (!text.trim()) {
        r.fail(rel + '/' + f + ' is non-empty',
          'the file exists and is blank. An empty listing field is worse than a missing one — it passes a\n' +
          'presence check and ships as an empty store field.');
        continue;
      }
      /* limits — only where somebody sourced one */
      const lim = row.limits?.[f];
      if (lim) {
        if (typeof lim.source !== 'string' || !lim.source.startsWith('https://')) {
          r.fail(rel + '/' + f + ' limit carries a source',
            'storeMetadata.stores.' + id + '.limits["' + f + '"] declares a limit with no https `source`.\n' +
            'An invented limit fires on CORRECT input. Add the URL and the fetch date, or remove the limit.');
        } else {
          const n = charCount(text);
          if (Number.isInteger(lim.max) && n > lim.max) {
            r.fail(rel + '/' + f + ' within the store limit',
              n + ' characters against a maximum of ' + lim.max + '.\nSource: ' + lim.source);
          } else if (Number.isInteger(lim.min) && n < lim.min) {
            r.fail(rel + '/' + f + ' meets the store minimum',
              n + ' characters against a minimum of ' + lim.min + '.\nSource: ' + lim.source);
          } else {
            r.pass(rel + '/' + f, n + ' chars' +
              (Number.isInteger(lim.min) ? ', min ' + lim.min : '') +
              (Number.isInteger(lim.max) ? ', max ' + lim.max : ''));
          }
        }
      } else {
        r.pass(rel + '/' + f, charCount(text) + ' chars, no sourced limit');
      }
    }
  }

  /* ── 4. shared material ────────────────────────────────────────────────── */
  if (typeof sm.sharedDir === 'string' && sm.sharedDir) {
    seenDirs.add(sm.sharedDir.replace(/\/+$/, ''));
    const abs = path.join(tool.dirAbs, sm.sharedDir);
    const rel = tool.rel + '/' + sm.sharedDir;
    const anyServed = Object.values(rows).some((x) => x?.served === true);
    if (!fs.existsSync(abs)) {
      if (anyServed) r.fail(rel + ' exists', 'a store is served and the shared listing material is absent.');
      else r.note('NO TREE (no store served): ' + rel + ' — the material every store accepts.');
    } else {
      for (const f of REQUIRED_SHARED) {
        const fAbs = path.join(abs, f);
        if (!fs.existsSync(fAbs)) { r.fail(rel + '/' + f + ' exists', 'required shared listing file, absent.'); continue; }
        filesChecked++;
        if (!readText(fAbs).trim()) r.fail(rel + '/' + f + ' is non-empty', 'exists and is blank.');
        else r.pass(rel + '/' + f);
      }
    }
  }

  /* ── 5. orphans — a listing directory no row declares ──────────────────── */
  const storeRootRel = 'store';
  const storeRootAbs = path.join(tool.dirAbs, storeRootRel);
  if (fs.existsSync(storeRootAbs) && fs.statSync(storeRootAbs).isDirectory()) {
    for (const name of fs.readdirSync(storeRootAbs)) {
      const child = path.join(storeRootAbs, name);
      if (!fs.statSync(child).isDirectory()) continue;
      const asDeclared = storeRootRel + '/' + name;
      if (!seenDirs.has(asDeclared)) {
        r.fail(tool.rel + '/' + asDeclared + ' is declared by a store row',
          'a listing directory that no row in storeMetadata names. Either a store was renamed and its\n' +
          'listing left behind — orphaned, unreachable, and still looking maintained — or a directory was\n' +
          'created for a store nobody declared. Declare the store or delete the directory.');
      }
    }
  }

  /* ── 5b. a listing must not send users to ANOTHER store's browser ───────
     🔴 FOUND BY AUDIT ON THE DAY THE STORE LAYER LANDED, WHICH IS THE WHOLE
     REASON THIS LIMB EXISTS. The Edge listing was extracted from the Chrome
     copy — correct for every word except one: it told Edge users to open
     `chrome://extensions/shortcuts`, a URL Edge does not have. The instruction
     was accurate, well-formed, and pointed at a browser the reader is not
     using.
     Nothing caught it. The character-limit checks passed, the drift check
     compares the Chrome tree against the Chrome document, and no limb looked
     at the copy as COPY. A per-store directory whose contents came from
     another store is the defect this whole layer was built to make visible,
     so it gets a check rather than a note. */
  const SCHEME = { chrome: 'chrome://', edge: 'edge://', firefox: 'about:' };
  for (const [id, row] of Object.entries(rows)) {
    if (!row || typeof row.dir !== 'string') continue;
    const abs = path.join(tool.dirAbs, row.dir);
    if (!fs.existsSync(abs)) continue;
    const mine = SCHEME[id];
    const foreign = Object.entries(SCHEME).filter(([k]) => k !== id);
    for (const f of REQUIRED_PER_STORE) {
      const fAbs = path.join(abs, f);
      if (!fs.existsSync(fAbs)) continue;
      const text = readText(fAbs);
      for (const [otherId, scheme] of foreign) {
        if (!text.includes(scheme)) continue;
        /* `about:` is a legitimate prefix in ordinary prose ("about the app"),
           so firefox's scheme only counts with a page after it. */
        if (scheme === 'about:' && !/about:[a-z]/.test(text)) continue;
        r.fail(tool.rel + '/' + row.dir + '/' + f + ' sends users to the ' + otherId + ' browser',
          'it contains "' + scheme + '", which is ' + otherId + "'s URL scheme, in the " + id + ' listing.\n' +
          (mine ? 'Use "' + mine + '" here.' : 'Remove it.') + ' A listing that names another browser\'s URL is an\n' +
          'instruction the reader cannot follow — and it is exactly what copying a sibling store\'s copy produces.');
      }
    }
  }

  /* ── 6. the copy has ONE home, and this is what keeps it that way ───────
     `publish/STORE-LISTING.md` holds the REASONING behind the listing — why the
     redaction bullet is worded as it is, which policy each claim answers to —
     and it quotes the copy in fenced blocks. The files under `store/` are the
     copy itself. That is two places for one string, which is the defect this
     repository names in its own README: "a hand-typed row is a second place for
     the same fact to be written, and the second place is the one that goes
     stale." The duplication is kept because the argument is worth reading beside
     the words it argues about — so it is CHECKED rather than removed. */
  const listingDoc = path.join(tool.dirAbs, 'publish', 'STORE-LISTING.md');
  if (fs.existsSync(listingDoc)) {
    const md = readText(listingDoc);
    const blockAfter = (heading) => {
      const i = md.indexOf(heading);
      if (i === -1) return null;
      const open = md.indexOf('```', i);
      if (open === -1) return null;
      const start = md.indexOf('\n', open) + 1;
      const close = md.indexOf('```', start);
      return close === -1 ? null : md.slice(start, close).trim();
    };
    const pairs = [
      ['## Product name', 'title.txt'],
      ['## Summary (short description', 'short-description.txt'],
      ['## Detailed description', 'long-description.txt'],
    ];
    /* Graded against the CHROME tree: that document is Chrome Web Store listing
       copy by its own title, so Chrome is the store it is a second copy of. */
    const chromeDir = rows.chrome?.dir;
    if (chromeDir && fs.existsSync(path.join(tool.dirAbs, chromeDir))) {
      for (const [heading, file] of pairs) {
        const quoted = blockAfter(heading);
        const fAbs = path.join(tool.dirAbs, chromeDir, file);
        if (quoted === null || !fs.existsSync(fAbs)) continue;
        r.check('publish/STORE-LISTING.md "' + heading.replace('## ', '') + '" matches ' + chromeDir + '/' + file,
          quoted === readText(fAbs).trim(), quoted.length + ' chars',
          'the block quoted in publish/STORE-LISTING.md and the file under ' + chromeDir + ' have drifted.\n' +
          'They are two copies of one string. The FILE is what a store receives; the document is the\n' +
          'argument for it. Re-sync whichever is stale — and if the document is now only commentary,\n' +
          'replace its fenced block with a pointer rather than leaving a second copy to rot.');
      }
    }
  }

  /* ── 7. the unverified list is carried, not quietly dropped ────────────── */
  if (Array.isArray(sm._unverified) && sm._unverified.length) {
    r.note(tool.rel + ': ' + sm._unverified.length + ' store limit(s) recorded as UNVERIFIED and deliberately not enforced.');
  }
}

/* 🔴 A FINDING OUTRANKS COVERAGE LOSS, AND THE ORDER IS LOAD-BEARING.
   Both paths are non-zero, so it is tempting to check reach first. This guard's
   own tests caught why not: "declares targets but no storeMetadata" and "the
   store set was emptied" BOTH raise a precise, actionable failure AND leave
   storesGraded at 0 — and a reach check running first replaced those sentences
   with the generic "zero rows were graded", which says nothing about what to do.
   Zero rows is only coverage loss when nothing else went wrong; otherwise the
   failures above explain it. (Same defect, same day, as
   assert-elf-page-alignment.mjs in the platform repo.) */
if (storesGraded === 0 && r.fails.length === 0) {
  die('zero store rows were graded across ' + tools.length + ' tool(s).\n' +
    'The subject set is empty, so a pass here would mean nothing.');
}

r.blank();
r.note(storesGraded + ' store row(s) graded, ' + filesChecked + ' listing file(s) read, across ' + tools.length + ' tool(s).');

process.exit(r.finish());
