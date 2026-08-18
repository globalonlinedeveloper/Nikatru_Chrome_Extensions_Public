/* publish-catalog.mjs — derive catalog/extensions.json from the tool.json files.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/publish-catalog.mjs            rewrite catalog/extensions.json
     node scripts/publish-catalog.mjs --check    fail if it is out of date (CI)
     node scripts/publish-catalog.mjs --print    print the bytes, touch nothing

   WHAT THIS FILE IS, AND WHY IT IS NOT gen-catalog.mjs

   gen-catalog.mjs writes a table into README.md — a catalogue for a HUMAN
   reading this repository. This writes catalog/extensions.json — a catalogue for
   a MACHINE in another repository. The storefront (Project_Web_Presence) fetches
   this path over https and byte-compares its vendored copy against it, so the
   bytes here are a published interface, not an internal convenience.

   Two consumers, two shapes, ONE source: every field below is read out of a
   tool.json. Neither generator holds a fact the other does not.

   🔴 catalog/extensions.json IS GENERATED. DO NOT HAND-EDIT IT.
   `--check` compares byte for byte, so an edit here is not a merge conflict
   later — it is a red build on the next run, which is the cheap version of the
   same conversation. An orphan hand-written copy of this file existed before
   this script did; it carried fields nothing in the tree could confirm, and that
   is exactly the state this script exists to make impossible.

   ── WHERE EVERY PUBLISHED FIELD COMES FROM ───────────────────────────────────

     slug       tool.json  id          the stable public handle (spec §1.1)
     name       tool.json  name        the product name users see
     tagline    tool.json  summary     the one-sentence catalogue line
     platforms  tool.json  targets     chromium.stores, then firefox if present
     listings   tool.json  listings    verbatim; null stays null
     status     DERIVED    see below

   Nothing here composes a plausible store URL, invents a description, or reads
   the manifest's marketing strings. A field that cannot be derived is a field
   this file refuses to publish.

   ── STATUS IS DERIVED FROM INSTALLABILITY, NOT FROM tool.json's OWN STATUS ────

       status = "live"     if at least one listings.<store> is a URL
       status = "preview"  otherwise

   The published vocabulary is {live, preview} because that is what the sibling
   catalogue publishes (Project_Cross_Platform_Apps catalog/apps.json, graded by
   its assert-catalog-contract.mjs) and the storefront reads both with one
   reader. A third spelling would be silently skipped by every consumer while
   looking deliberate here.

   tool.json's own vocabulary is {idea, wip, shipping, archived} and it is
   INTERNAL — it describes how far the work has got. `live` is not that: it is a
   promise to a stranger that a store page answers. So the only thing that can
   make this file say `live` is a listing URL, and FullShot has none — it
   publishes `preview` today, which is true.

   ONE SOURCE STATUS IS REFUSED RATHER THAN MAPPED. `archived` means withdrawn,
   and neither published value carries that: `preview` reads as "coming soon",
   which is the opposite claim, and `live` would be worse. When the first tool is
   archived this script stops and asks for a deliberate decision instead of
   quietly picking the friendlier lie.

   ── WHAT IT REFUSES TO DO ────────────────────────────────────────────────────

     · publish a tool whose surface is not "extension" — this file is named
       extensions.json and has nowhere to put a `web` or `cli` tool. Dropping it
       silently would be a catalogue that is quietly incomplete, which is the one
       failure this repository has paid for most often.
     · publish a tool that targets no store at all.
     · publish when tool.json's `listings` keys and its `targets` do not agree —
       two fields describing the same set, free to drift, is the defect.
     · replace a non-empty catalogue with an empty one (--allow-empty to mean it).

   DETERMINISM: no timestamps, no environment, no commit sha, no digest. Same
   tree, same bytes, forever — which is what makes the storefront's byte-compare
   able to mean "current" rather than "regenerated".

   ── 🔴 A UTF-8 BOM IS REFUSED HERE, ON THE RAW BYTES ─────────────────────────

   Three bytes — EF BB BF — in front of the `[` are the cheapest way this file
   has of being wrong while every gate in this repository says it is right.
   Measured, on the real catalogue:

     node scripts/publish-catalog.mjs --check    EXIT 0   (before this refusal)
     node scripts/check-catalog.mjs              EXIT 0   (before its refusal)
     node scripts/lint.mjs                       EXIT 0

   ...while the consumer this file exists for cannot read it at all. `JSON.parse`
   throws on a leading U+FEFF in every path Node offers — string OR Buffer,
   measured on v24 — so the storefront's `readVendored()` reports "not valid
   JSON", its `sync-vendor.mjs` refuses to vendor the body, and its
   `generate-apps-data.mjs` produces nothing. The whole storefront section for
   this factory goes dark on three bytes no gate here objected to.

   The reason it passed is not an oversight in the comparison — it is a helper
   working exactly as designed one layer down. `readText()` in lib/toolinfo.mjs
   STRIPS a BOM on read, deliberately, so that a BOM'd tool.json reports as a BOM
   rather than as "corrupt JSON". Every read in this repository inherits that,
   including the `existing === bytes` comparison below, which therefore compared
   the file's CONTENT and never its BYTES. For an internal file that is right.
   For the one file whose bytes are a published interface it is exactly wrong:
   the storefront byte-compares what it fetches, so a byte this contract does not
   allow must never be written, not merely tolerated on read.

   So the BOM is tested on the raw Buffer, before any decode, and it is named in
   the failure — a consumer's "Unexpected token" names neither the BOM nor the
   file. `lib/toolinfo.mjs` already makes this exact refusal for tool.json
   (`hadBom`, used by `loadTool`); this extends it to the file where it matters
   most. PowerShell 5.1 writes a BOM by default from `Out-File -Encoding utf8`,
   so this is a keystroke away on the machine this repository is built on.

   Exit codes: 0 written / already correct · 1 --check found it stale or BOM'd, or
   a tool.json cannot be published · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { Report, parseArgs, die, EXIT_FAIL } from './lib/report.mjs';
/* readText() is deliberately NOT imported here. It strips a UTF-8 BOM, and this
   is the one file in the repository whose raw bytes are the contract — see the
   header and the read below. */
import { repoRoot, loadAllTools } from './lib/toolinfo.mjs';

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['check', 'print', 'allow-empty', 'out', 'repo-root']);
const root = repoRoot(args);

const outRel = typeof args.get('out') === 'string' ? args.get('out') : 'catalog/extensions.json';
const outAbs = path.join(root, outRel);

/* The published status vocabulary. Kept here as the one place it is written,
   and deliberately the same two values the sibling apps catalogue publishes. */
const LIVE = 'live';
const PREVIEW = 'preview';

/* ---------------- load ---------------- */
const { tools, errors, warnings } = loadAllTools(root);
if (errors.length) {
  console.error('CANNOT PUBLISH THE CATALOGUE — ' + errors.length + ' tool.json problem(s):');
  for (const e of errors) console.error('  - ' + e);
  process.exit(EXIT_FAIL);
}
for (const w of warnings) console.log('WARN  ' + w);

/* ---------------- derive one row ---------------- */
const problems = [];
const refuse = (t, why) => problems.push(t.rel + '/tool.json: ' + why);

/* Store targets, in declaration order: the chromium stores as tool.json lists
   them, then firefox if the tool builds one. Derived from `targets` rather than
   from `listings` so that the two remain independent statements this script can
   compare — a platform list read out of the listings object would agree with it
   by construction and check nothing. */
function platformsOf(t) {
  const targets = t.targets || {};
  const out = [];
  const seen = new Set();
  const add = (p, where) => {
    if (typeof p !== 'string' || !p.trim()) {
      refuse(t, 'targets' + where + ' contains ' + JSON.stringify(p) + '; a store name must be a non-empty string.');
      return;
    }
    if (seen.has(p)) {
      refuse(t, 'targets names the store "' + p + '" twice. The published `platforms` array is rendered as one chip per entry.');
      return;
    }
    seen.add(p);
    out.push(p);
  };

  if (targets.chromium !== undefined && targets.chromium !== null) {
    if (typeof targets.chromium !== 'object' || Array.isArray(targets.chromium)) {
      refuse(t, 'targets.chromium is ' + (Array.isArray(targets.chromium) ? 'an array' : typeof targets.chromium) + ', expected an object like { "stores": ["chrome", "edge"] }.');
    } else {
      const stores = targets.chromium.stores;
      if (!Array.isArray(stores) || stores.length === 0) {
        refuse(t, 'targets.chromium is declared but targets.chromium.stores is empty or missing. A chromium build that reaches no store is not a published channel.');
      } else for (const s of stores) add(s, '.chromium.stores');
    }
  }
  if (targets.firefox !== undefined && targets.firefox !== null) add('firefox', '.firefox');

  if (out.length === 0) {
    refuse(t, 'declares no store target at all (targets is ' + JSON.stringify(t.targets || {}) + '). ' +
      'An extension nobody can install anywhere has no honest row in a storefront catalogue.');
  }
  return out;
}

/* `listings` verbatim, but only after proving it describes the same set of
   stores `targets` does. Two fields that name the same thing and are never
   compared is how a catalogue ends up advertising a Firefox button for a tool
   that has no Firefox build. */
function listingsOf(t, platforms) {
  const raw = t.listings || {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    refuse(t, '"listings" is ' + (Array.isArray(raw) ? 'an array' : typeof raw) + ', expected an object keyed by store name.');
    return null;
  }
  const declared = Object.keys(raw).sort();
  const expected = platforms.slice().sort();
  if (declared.join(',') !== expected.join(',')) {
    refuse(t, '"listings" is keyed by [' + declared.join(', ') + '] but `targets` builds for [' + expected.join(', ') + ']. ' +
      'These two describe the same set of stores; when they disagree, one of them is wrong and nothing else in this repo compares them.');
    return null;
  }
  const out = {};
  for (const p of platforms) {
    const v = raw[p];
    if (v === null) { out[p] = null; continue; }
    if (typeof v === 'string' && v.trim()) { out[p] = v; continue; }
    refuse(t, 'listings.' + p + ' is ' + JSON.stringify(v) + '. A listing is either a store URL or null — ' +
      'null is the honest answer until the listing exists, and an empty string is a URL nobody can follow.');
    out[p] = null;
  }
  return out;
}

function rowFor(t) {
  if (t.surface !== 'extension') {
    refuse(t, 'has surface "' + t.surface + '". ' + outRel + ' publishes extensions; there is nowhere in it to put this tool, ' +
      'and dropping it silently would publish a catalogue that is quietly incomplete. Give this surface its own catalogue file.');
    return null;
  }
  if (t.status === 'archived') {
    refuse(t, 'has status "archived", and the published vocabulary is {' + LIVE + ', ' + PREVIEW + '}. Neither means "withdrawn": ' +
      '"' + PREVIEW + '" reads as coming-soon, which is the opposite claim. Decide what the storefront should say about an archived ' +
      'extension and extend this script deliberately — do not let it pick the friendlier of two wrong answers.');
    return null;
  }

  const platforms = platformsOf(t);
  if (platforms.length === 0) return null;
  const listings = listingsOf(t, platforms);
  if (listings === null) return null;

  const listed = platforms.filter((p) => typeof listings[p] === 'string');
  const status = listed.length > 0 ? LIVE : PREVIEW;

  /* Field order is fixed here rather than left to object-literal accident: it is
     the byte order the storefront diffs against. */
  return {
    slug: t.id,
    name: t.name,
    tagline: t.summary,
    listings,
    platforms,
    status,
  };
}

const rows = [];
for (const t of tools) {
  const row = rowFor(t);
  if (row) rows.push(row);
}
rows.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

if (problems.length) {
  console.error('CANNOT PUBLISH THE CATALOGUE — ' + problems.length + ' tool(s) cannot be turned into a row:');
  for (const p of problems) console.error('  - ' + p);
  console.error('\nNothing was written. A catalogue missing the tool it could not describe is worse than no catalogue:');
  console.error('the gap is invisible to every consumer, because a consumer only ever sees the rows that are there.');
  process.exit(EXIT_FAIL);
}

const bytes = JSON.stringify(rows, null, 2) + '\n';

if (args.bool('print')) {
  process.stdout.write(bytes);
  process.exit(0);
}

/* ---------------- write / check ---------------- */

/* Read the BYTES first and derive the text from them, rather than calling
   readText() and never seeing them. readText() strips a UTF-8 BOM by design (see
   the header), so `existing` below is the file's CONTENT — the right subject for
   the drift comparison and the line diff, and the wrong subject for the one
   question a published interface also has to answer: are these the bytes we
   said we would serve? That question is answered here, on the Buffer. */
const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const existingBytes = fs.existsSync(outAbs) ? fs.readFileSync(outAbs) : null;
const existingHasBom = existingBytes !== null && existingBytes.subarray(0, 3).equals(BOM);
const existing = existingBytes === null
  ? null
  : (existingHasBom ? existingBytes.subarray(3) : existingBytes).toString('utf8');

/* Named once so the --check failure and the rewrite notice cannot drift apart. */
const BOM_WHY =
  'The first three bytes of ' + outRel + ' are EF BB BF — a UTF-8 byte order mark — before the opening `[`.\n' +
  'This file is a published interface: Project_Web_Presence fetches these exact bytes over https and\n' +
  'byte-compares its vendored copy against them. `JSON.parse` throws on a leading U+FEFF in every path\n' +
  'Node offers (string and Buffer alike), so with the BOM present the storefront cannot read this\n' +
  'catalogue at all — it reports "not valid JSON", vendors nothing, and renders no extensions.\n' +
  'Nothing else in this repository notices, because readText() in lib/toolinfo.mjs strips a BOM on read\n' +
  'and every gate here reads through it. That is correct for an internal file and wrong for this one.\n' +
  'PowerShell 5.1 writes a BOM by default from `Out-File -Encoding utf8`; use `Set-Content -Encoding utf8NoBOM`,\n' +
  'or just regenerate — this script writes the file without one.';

/* Zero rows over a populated catalogue is indistinguishable from a broken
   discovery — the same refusal gen-catalog.mjs makes about the README table, for
   the same reason, and this repository has had a search silently miss an entire
   tree before. */
if (rows.length === 0 && existing !== null && existing.trim() !== '' && existing.trim() !== '[]' && !args.bool('allow-empty')) {
  die('no tool.json produced a catalogue row, so the generated catalogue is empty — and ' + outRel + ' currently\n' +
    'holds one with content. Overwriting it would publish "this factory ships nothing" to the storefront.\n\n' +
    'An empty result is indistinguishable from a broken search. If the catalogue really should be empty, pass --allow-empty.');
}

function firstDifference(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      return 'first difference at line ' + (i + 1) + ':\n' +
        '  generated: ' + (la[i] === undefined ? '(end of file)' : JSON.stringify(la[i])) + '\n' +
        '  on disk:   ' + (lb[i] === undefined ? '(end of file)' : JSON.stringify(lb[i]));
    }
  }
  return 'the lines are identical, so the difference is in line endings or a trailing byte.';
}

const r = new Report('publish-catalog · ' + outRel);

if (args.bool('check')) {
  if (existing === null) {
    r.fail(outRel + ' does not exist',
      'It is the published catalogue the storefront fetches, and this run derived ' + rows.length + ' row(s) that belong in it.\n' +
      'Run:  node scripts/publish-catalog.mjs');
    process.exit(r.finish());
  }
  /* 🔴 BEFORE the content comparison, not after. A BOM'd file whose content is
     otherwise perfect passes `existing === bytes` — that is the whole defect —
     so this must sit in front of the branch that would call it up to date. */
  if (existingHasBom) {
    r.fail(outRel + ' starts with a UTF-8 byte order mark (EF BB BF)', BOM_WHY);
    process.exit(r.finish());
  }
  if (existing === bytes) {
    r.pass(outRel + ' is up to date', rows.length + ' row(s): ' + rows.map((x) => x.slug + '[' + x.status + ']').join(', '));
    process.exit(r.finish());
  }
  r.fail(outRel + ' is out of date',
    'The committed catalogue does not match what the tool.json files on disk derive.\n' +
    'Either a tool.json changed and nobody regenerated, or this file was hand-edited — it is generated, so it must not be.\n' +
    'generated ' + Buffer.byteLength(bytes) + ' bytes · on disk ' + Buffer.byteLength(existing) + ' bytes\n' +
    firstDifference(bytes, existing) + '\n\n' +
    'Run:  node scripts/publish-catalog.mjs');
  process.exit(r.finish());
}

/* `&& !existingHasBom`: without it a BOM'd file is reported "already correct"
   and the three offending bytes survive the one command whose job is to remove
   them. The write below is a plain utf8 write, so regenerating IS the fix — and
   the run says which byte it removed rather than reporting a silent no-op. */
if (existing === bytes && !existingHasBom) {
  r.pass(outRel + ' was already correct', rows.length + ' row(s)');
  process.exit(r.finish());
}

fs.mkdirSync(path.dirname(outAbs), { recursive: true });
fs.writeFileSync(outAbs, bytes, 'utf8');
if (existingHasBom) {
  r.pass('rewrote ' + outRel + ' WITHOUT its UTF-8 byte order mark',
    'The file on disk began EF BB BF; the content was otherwise correct. Removed — ' +
    Buffer.byteLength(bytes) + ' bytes written.');
} else {
  r.pass('wrote ' + outRel, rows.length + ' row(s): ' + (rows.map((x) => x.slug + ' [' + x.status + ']').join(', ') || 'none'));
}
process.exit(r.finish());
