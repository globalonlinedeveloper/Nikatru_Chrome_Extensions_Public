# `scripts/` — the repo's gates

Node only. **Zero npm dependencies, forever.** Nothing here is ever shipped inside an extension.

Every gate is a plain `node scripts/<name>.mjs` call, so **the command CI runs is the command you run**
on Windows in PowerShell. CI is a scheduler; these are the gates. There is no wrapper, no task runner
and no config file to keep in sync.

```powershell
node scripts/discover.mjs                    # which tools exist / which the diff touched
node scripts/lint.mjs        fullshot        # node --check every shipped .js/.mjs
node scripts/policy-check.mjs fullshot       # privacy · permissions · store limits
node scripts/check-version.mjs fullshot      # manifest == CHANGELOG top == tag
node scripts/check-core-sync.mjs fullshot    # vendor/core matches core/
node scripts/test/selftest.node.js           # do the gates above actually bite?
```

## Conventions every script here follows

**Three exit codes, and the middle one is the point.**

| Code | Meaning |
|---|---|
| `0` | the gate ran, and everything it checked passed |
| `1` | the gate ran, and something it checked **failed** |
| `2` | the gate **could not run** — bad usage, missing file, unparseable input |

A script that cannot run never exits `0`. *Silence is not success*: a scanner that quietly stops
scanning still prints clean, CI still goes green, and nothing surfaces until the thing it guarded is
already broken.

**A tool is named by id or by path.** `fullshot` and `Extension/Full_Screen_Shot` resolve to the same
tool. CI passes the id, because the id is the stable public handle — tags, zip names and artifact names
are all built from it — while a human at a prompt has just tab-completed the path.

**`--repo-root <dir>` works on every script.** It is how `test/selftest.node.js` points the gates at a
synthetic tree. A guard you can only run against the real repo is a guard you can only negative-test by
breaking the real repo.

**A mistyped flag is refused, not ignored.** `--warings-as-errors` exits 2 rather than silently leaving
strict mode off.

**Four verdicts, and only one is fatal by default.** `PASS` · `FAIL` (exit 1) · `WARN` (printed) ·
`OWNER` (a gap only the owner can close — a domain to buy, a listing to create). Owner actions print on
every run and never fail the build unless `--owner-actions-fatal` is passed. A build permanently red on
work only one person can do teaches everyone that red is negotiable.

---

## What is here

| Script | Does | Notes |
|---|---|---|
| `discover.mjs` | globs `Category/Tool/tool.json` → the CI matrix, diff-aware | emits **ids**. Every ambiguity widens to ALL tools |
| `lint.mjs` | `node --check` on every shipped `.js`/`.mjs` | also accepts `core` and `scripts`. Fails when it checks **zero shipped files** |
| `policy-check.mjs` | the eight gates of the architecture's §4.3 | strips comments and strings before scanning; see below |
| `check-version.mjs` | manifest == CHANGELOG top == tag | delegates to the tool's own `publish/bump-version.mjs --check` when it has one |
| `sync-core.mjs` | `core/<channel>` → `<tool>/vendor/core` + hashes | refuses to write over strays; refuses an unsatisfiable pin |
| `check-core-sync.mjs` | fails if a tool's `vendor/core` drifted | compares file ↔ core ↔ recorded hash; names CRLF-only drift as such |
| `gen-catalog.mjs` | rewrites the README table from `tool.json` files | writes only between `<!-- CATALOG:START -->` / `<!-- CATALOG:END -->` |
| `new-tool.mjs` | stamps `templates/tool` (or `_skeleton`) → `Category/Tool_Name` | never writes into an existing directory |
| `lib/toolinfo.mjs` | loads and validates `tool.json`; answers "what ships?" | the one loader every gate reads through |
| `lib/report.mjs` | the pass/fail/warn/owner reporter and argv parser | not in the architecture's file list; added so eight gates cannot disagree about what "failed" means |
| `schema/tool.schema.json` | editor autocomplete and hover docs for `tool.json` | **not** the gate — `lib/toolinfo.mjs` is. Cross-file checks are the ones that matter and no JSON Schema can express them |
| `test/selftest.node.js` | 90 checks: every gate proven to fail on a real mutation | run it after touching anything here |

### Two deliberate deviations from the written architecture

1. **An external `<a href>` does not fail the remote-subresource gate.** §4.3.2 words the rule as "no
   `src`/`href` in packaged HTML with an http(s) scheme", which taken literally fails the privacy-policy
   link every options page is required to carry. An `<a href>` navigates; it loads nothing into the
   extension's context. External links are **listed** in the output; every other tag — `script`, `link`,
   `img`, `iframe` — still fails. A gate that fails correct code gets switched off, and then it guards
   nothing.

2. **Store metadata limits are measured on the resolved translation, in every locale.** `name` and
   `description` are `__MSG_` placeholders, so measuring the manifest literal measures nothing. The
   limit is enforced per locale by the store, and a translation is where 132 characters gets exceeded.

---

## ABSENT — named, not stubbed

These are required by `.github/workflows/ci.yml` and `release.yml` and **do not exist**. They are listed
with the exact contract the workflows call them with, so whoever writes them does not have to re-derive
it. A missing script fails the job by design; that is better than an `if [ -f ]` guard, which is a green
build that checks nothing.

| Script | Contract the workflows require | Why it is absent |
|---|---|---|
| `pack.mjs` | `node scripts/pack.mjs <id> --target <chromium\|firefox> --out dist [--release]` → `dist/<id>-<target>.zip`, and `dist/unpacked-firefox/` for the `web-ext lint` step | **A working packager already exists per tool and must be called, not replaced.** See below. |
| `verify-refs.mjs` | `--zip <path> --strict --leaks` — reference integrity **on the zip**, case-exact | Per-tool verifiers already do this. See below. |
| `run-tests.mjs` | `node scripts/run-tests.mjs <id>` — runs exactly the paths in `tool.json` `tests`, bare Node, no `npm install`, ever | Not written here. `lib/toolinfo.mjs` already validates that every listed path exists, so the input is trustworthy. |
| `secret-scan.mjs` | `node scripts/secret-scan.mjs .` — credential shapes over the whole tree | Not written here. `.githooks/pre-commit` carries the patterns. |
| `sha256.mjs` | `node scripts/sha256.mjs <file>` → the hex digest on stdout (the determinism check diffs two builds) | Not written here. |
| `changelog-section.mjs` | `node scripts/changelog-section.mjs <id> <version>` → that version's notes on stdout, for the release body | Not written here. `changelogTop()` in `lib/toolinfo.mjs` already parses the headings. |
| `lib/zip.mjs`, `lib/mergepatch.mjs` | deterministic zip writer; RFC 7386 merge patch | Belong with `pack.mjs`, for the same reason. |

### Why packing was not rewritten, and exactly what blocks a wrapper

Two real packagers exist and are the authority on what ships:

- `templates/tool/publish/pack.mjs` — positive allowlist, deterministic zip (sorted entries, fixed DOS
  timestamp, fixed deflate level), an unconditional `_locales` collector that no pattern edit can
  defeat, a diff against the previous release that fails on a **dropped** file, and a refusal to write
  a Firefox package while `gecko.id` is a placeholder.
- `Extension/Full_Screen_Shot/publish/package.node.js` — the same design, older, and the one that
  actually built the shipped `fullshot-1.10.1` zips.

Rewriting either from the architecture's description would replace tested code with untested code. But a
thin repo-level wrapper does not work today either, and these are the measured reasons:

1. **`templates/tool/publish/pack.mjs` reads `SK_ROOT`**, so it can be aimed at another tool — but it also
   does `require(<SK_ROOT>/publish/verify-package.node.js)` and
   `import '../_locales/package-guard.mjs'` (relative to the **script**, not to `SK_ROOT`).
   `Extension/Full_Screen_Shot/publish/` has **no** `verify-package.node.js`. Aiming `SK_ROOT` at
   FullShot therefore throws before it packs anything.
2. **The output names do not match.** The per-tool packers write
   `publish/<slug>-<version>.zip` and `publish/<slug>-<version>-firefox.zip`. `ci.yml` expects
   `dist/<tool-id>-<target>.zip` — different directory, no version in the name, and a target suffix on
   both. A wrapper has to own that mapping, and `--out` and `--release` on top of it.
3. **`dist/unpacked-firefox/` is required** by the `web-ext lint` step and neither packer produces it as
   part of a build. `pack.mjs --extract <dir> [--firefox]` gets close and is the piece to build on.

So: **packing stays per-tool for now.** The gates in this directory deliberately grade the *source tree*
and stop where the zip begins; `verify-refs.mjs` is the architecture's own name for the zip-side gate,
and the per-tool `verify-package.node.js` / `verify-firefox-package.node.js` already implement its
algorithm — including the check that caught a missing `background.js` before it shipped.

### Also absent, and deliberately

- **The ESM shim emitter in `sync-core.mjs`.** §2.3 describes writing
  `vendor/core/esm/<mod>.js` = `import '../<mod>.js'; export const <mod> = globalThis.TX.<mod>;`.
  Not implemented: the shim must know each module's namespace object and export name, and `core/v1/`
  today holds three modules promoted from `templates/tool` that attach their own globals because
  `core/v1/ns.js` **does not exist**. Generating those files would mean importing a symbol nothing ever
  assigns. It returns when `ns.js` is real.
- **`core/test/`.** `core/core.json` declares this gap itself. `ci.yml` fails the core job when
  `core/` exists and ships no sims, so it is visible rather than silently skipped.
- **The `CATALOG` markers in the root `README.md`.** `gen-catalog.mjs` refuses to write without them and
  prints the exact block to paste. Adding them is a one-time manual edit; until then the catalog table is
  hand-maintained.

---

## `test/selftest.node.js`

```powershell
node scripts/test/selftest.node.js          # 90 checks
node scripts/test/selftest.node.js --keep   # leave the fixtures on disk to poke at
```

It builds a real tool tree in the OS temp directory — real PNG icons copied out of `templates/tool`, a real
manifest, a real locale catalogue — runs each gate, then **breaks exactly one thing** and runs it again.
Every assertion comes in a pair: the gate passes on a correct tree and fails on one specific mutation,
with a message that names the problem.

*An assertion that cannot fail is worse than none* — it inflates apparent coverage. If you add a gate
here and cannot write the mutation that makes it red, the gate is not real.

Four bugs in these scripts were found by running them, and are recorded as cases in that file:

- `lint.mjs` reported a pass over a tool whose entire shipped surface had fallen out of
  `package.include`, because the tests named in `tool.json` still put one file in the set. Shipped
  files are now counted separately.
- A malformed manifest version was a `tool.json` **contract** error, so every gate exited `2` and the
  one script whose job is version agreement could not report it. Content moved to the gates that own it.
- `__MSG_@@bidi_dir__` was demanded of `messages.json`. It is one of Chrome's **predefined** messages and
  is never there. Found only by running against the real FullShot tree.
- `__MSG_` keys quoted in **comments** — FullShot's `pages/batch.js` documents why an inline `<style>`
  cannot pick one up — were treated as unresolved references. A gate red on its own documentation is a
  gate somebody disables.
