# `core/` — the shared runtime

Shared code for the extensions in this repository. It is **vendored, not linked**: `core/v1/**` is copied
into a tool as `<tool>/vendor/core/**` with a hash recorded per file, so an extension folder loads unpacked
with zero setup and a hand-edit of a vendored file is a CI failure rather than a mystery.

The copying and the drift gate live in `scripts/`, not here. `sync-core.mjs` copies `core/v1/**` into a
tool and writes `vendor/core/.coremeta.json` — channel, core version, and a sha256 per file.
`check-core-sync.mjs` fails when a vendored file stops matching, and `ci.yml` runs it for every affected
tool in the `gates` matrix, which is what makes the hash a gate rather than a note. What `core/` owns is
the source of truth those two copy from, and the rules below.

> **Never call the vendored directory `_core/`.** Chrome refuses to load any extension whose package has a
> root file or directory whose name begins with `_` — *"Filenames starting with `_` are reserved for use by
> the system."* `_locales` is the only permitted exception. Hence `vendor/core/`.

---

## What is actually here, today

`core/` is **0.1.0**, not 1.0.0. The directory `v1` is the major version (a breaking change becomes
`core/v2/` beside it); the version *number* is a claim about how much of that channel exists.

> **Two counts, both real.** The architecture enumerates **11 modules** under `core/v1/` — `ns.js`,
> `msg.js`, `settings.js`, `idb.js`, `download.js`, `clipboard.js`, `i18n.js`, `diag.js`, `detect/pii.js`,
> `imaging.js`, and `ui/` — where `ui/` is one module holding three files. Counted as **files** that is
> **13**. `core.json` keys on files, so 13 of its entries are marked `"specified": true` and each carries a
> `"module"` field; the 11 is the number of distinct values of that field, not a number typed next to a
> list. Both figures are in `core.json` → `counts`, with the rule.

| | |
|---|---|
| Modules the v1 architecture specifies | **11** (13 files) |
| Of those, built | **1** — `settings.js` |
| Specified but not built | **10** modules (12 files) |
| Built but not on that list | **2** files (`storage.js`, `jobs.js`) — real implementations existed, so they were promoted |
| Node-side dev helpers built | **3** (never shipped) |
| Core's own sims (`core/test/`) | **0** — CI is red on this; see [Known gaps](#known-gaps) |

Everything here was **promoted from working code that already existed on disk**. Nothing in `core/` was
written from a description. The architecture expected `ns.js`, `msg.js` and `ui/tokens.css` to land first;
those three have no implementation anywhere in this repo, and the three that do have one are these. The
order inverted for that reason and no other — an unbuilt module is listed below as unbuilt.

### Built — `core/v1/` (runtime, vendored into tools)

| Module | Promoted from | What it owns |
|---|---|---|
| `settings.js` | `templates/tool/lib/settings.js` | Schema, defaults, the sync/local partition, migrations, change events over `chrome.storage`. |
| `storage.js` | `templates/tool/lib/storage.js` | The concrete IndexedDB wrapper: a `scratch` store and an `items` store, age and count sweeps, export, quota classification, `clearAll`. |
| `jobs.js` | `templates/tool/lib/jobs.js` | The in-flight job table, mirrored write-through to `chrome.storage.session` so it survives service-worker termination. |

Each file carries a header naming its source and the **sha256 of that source at promotion**. Below the
header the body is byte for byte the file that was read; nothing was retyped, reformatted or "improved".
The sha256 is what makes divergence between the two copies detectable — by a human who runs `sha256sum`,
since no script recomputes it yet.

Two of the three are not on the specified module list, and are labelled that way in `core.json`
(`"specified": false`). In particular:

- **`storage.js` is not `idb.js`.** `idb.js` is specified as the *generic* primitive — open, upgrade,
  transaction, put, get, cursor, quota, and nothing else. It does not exist. `storage.js` is the wrapper
  that does exist, and it has opinions in it (two named stores, a retention policy, an export format).
  Extracting the generic part is the work `idb.js` names; that work has not been done, and pretending
  otherwise by renaming the file would have been the whole lie in one move.
- **`jobs.js` was never on the list.** It is here because it is real.

### Built — `core/dev/` (Node-side test helpers, **never shipped**)

| Helper | Promoted from | What it owns |
|---|---|---|
| `fakedom.js` | `Extension/Full_Screen_Shot/test/pixel-sim/fakedom.js` | Fake DOM for simulations: elements, shadow roots, computed style, ranges, a window with DPR-quantised scrolling. |
| `canvas2d.js` | `Extension/Full_Screen_Shot/test/pixel-sim/canvas2d.js` | Buffer-backed canvas + 2d context subset, so a rasterised result can be graded without a browser. |
| `png.js` | `Extension/Full_Screen_Shot/test/pixel-sim/png.js` | Minimal 8-bit RGBA PNG writer, `node:zlib` only. |

`core/dev/` is **outside the vendored surface**. Be precise about how much of that is enforced:

- **Structural, holds by construction:** `sync-core.mjs` walks `core/v1/**` and nothing else, so `dev/`
  cannot reach a tool by the vendoring route.
- **Convention, enforced by nobody today:** no packaging allowlist may include `dev/`, and nothing inside
  an extension may `require` it. `scripts/policy-check.mjs` asserts neither. These are rules a reviewer
  applies, not gates — and a rule with no gate is worth exactly the attention the next reviewer pays it.

`dev/` exists so a simulation tier can grade a produced artifact — not a return value — on bare Node.

**The originals are still in place.** FullShot's sims require them by relative path, and FullShot's terms
of entry to this repo are zero file moves and zero source changes, so promoting by copy was the only move
available. Two copies exist today; the recorded sha256 is the only thing standing between that and silent
drift, and re-pointing FullShot's sims at these copies is what removes the second one.

### Specified, **not built**

None of these exist. There is no stub, no empty file and no placeholder export for any of them — a
fail-closed stub in a shared runtime reports healthy while doing nothing, which is the failure mode this
whole document is written to avoid. The line is what the module *will* own when someone writes it.

Ten modules, twelve files:

| Module | Will own |
|---|---|
| `v1/ns.js` | The namespace object every other core file attaches to; loads first, has no other job. |
| `v1/msg.js` | Promise-wrapped runtime messaging plus the service-worker lifetime guards: send timeouts, the `onMessage` router, port teardown, keepalive. |
| `v1/idb.js` | Generic IndexedDB mechanism only — open, upgrade, transaction, put, get, cursor, quota. No store schema, no retention policy. |
| `v1/download.js` | Handing bytes to `chrome.downloads`: object-URL lifecycle, filename sanitisation (including Windows reserved names), `conflictAction`. |
| `v1/clipboard.js` | Writing an image or text to the clipboard, including the focus/permission sequence and its fallbacks. |
| `v1/i18n.js` | A `chrome.i18n` wrapper and the `[data-i18n]` DOM applier. |
| `v1/diag.js` | A local, telemetry-free error ring buffer and the redacted report it produces on demand. Never a network call. |
| `v1/detect/pii.js` | Detection of sensitive strings — and only detection. How a tool renders a redaction stays in the tool. |
| `v1/imaging.js` | DPR-aware scaling, tiling, and encoding to a byte budget. |
| `v1/ui/` | One module, three files: `tokens.css` (design tokens — colour, space, radius, type, light and dark), `base.css` (reset and layout primitives for popup and options pages), `controls.js` (framework-free toggle, select, slider, section, toast). |

---

## Load form

Classic namespace scripts, not ESM — extension pages load core with `<script src>`, a Chrome service
worker pulls it in with `importScripts()`, and a Firefox event page lists the same files in
`background.scripts`. One file, three loaders, no build step.

```html
<script src="../vendor/core/settings.js"></script>
```
```js
if (typeof importScripts === 'function') importScripts('vendor/core/settings.js');
```

Each promoted file is an IIFE that attaches to the global object and also sets `module.exports`, so Node
can `require()` it in a sim. That much is verified: all six parse under `node --check`, and each was
loaded and exercised once on Node 24.18.0 after promotion —

- `encodePng(w, h, rgba)` returns bytes opening with the PNG signature `89 50 4E 47 0D 0A 1A 0A`.
- `FakeCanvas` (no-arg constructor; `width`/`height` are setters that allocate) fills inside its rect and
  leaves the pixel outside it at zero alpha.
- `SKJOBS.set(job)` — one argument, a job object carrying `tabId` — then `has()`, `size()` and
  `stale(maxAgeMs)` behave with no `chrome.*` present at all.
- `SKDB.scratchKey('job1', 3)` → `"job1:00003"`; `isQuotaError` is true for a `QuotaExceededError` and
  false for a plain one.
- `settings.js` exposes its six functions (`skGetSettings`, `skSetSettings`, `skResetSettings`,
  `skMigrateSettings`, `skInitSettings`, `skOnSettingsChanged`) and its three key lists
  (`SK_SYNC_KEYS`, `SK_LOCAL_KEYS`, `SK_INTERNAL_KEYS`).

That is a one-shot smoke check run by hand, not a suite. It is not `core/test/`, and it does not run in CI.

---

## Admission policy

1. **Rule of three-ish.** A module enters `core/` when two tools ship it and a third credibly wants it.
   Until then it lives in the tool. Copying into tool #2 and deleting the duplicate later is cheaper than
   deleting a wrong abstraction. *(The three modules here predate a second tool; they were promoted
   because a working implementation already existed in a template that is not itself shipped, not because
   two consumers were counted. That is a deviation, and it is recorded here rather than hidden.)*
2. **Mechanism, not policy.** Core owns *how to write a file*; the tool owns *what the filename means*.
3. **No DOM at load, no top-level side effects** beyond attaching to the namespace. Core must load in a
   service worker, an event page, an options page and a Node sim.
4. **Zero npm runtime dependencies. Forever.**
5. **Additive-only within a channel.** A breaking change becomes `core/v2/` beside `core/v1/`; existing
   tools keep running unchanged.
6. **Every core module ships with a Node sim in `core/test/`.** Not satisfied today — see below.

Deliberately **not** core: the capture/scroll-unroll engine, PDF export, GIF/WebM encoding, the editor,
beautify, the batch queue. Single-consumer, large and opinionated; freezing them behind a shared API would
ossify the code that most needs to keep changing.

---

## Known gaps

These are the reasons this is 0.1.0. Each is a real hole, stated so nobody has to discover it.

1. 🔴 **`core/test/` does not exist, and CI is red on `core/` because of it.** The `core sims` job in
   `.github/workflows/ci.yml` runs `node scripts/lint.mjs core` (6 files, passing), then globs
   `core/test/*.node.js`, finds none, prints
   `::error::core/ exists but core/test/ holds no sims — every core module ships with one.` and **exits 1**.
   That is the gate working as designed: the job was written so an empty glob *fails*, precisely because a
   loop over zero files that exits 0 is indistinguishable from a passing one. Do not read the red as
   noise — admission rule 6 is unmet for all three modules and the build says so.
   The three promoted modules do have coverage where they came from — `templates/tool/test/skeleton-sim.node.js`
   names `lib/settings.js` 20 times, `lib/storage.js` 13 and `lib/jobs.js` 5 — but that suite loads the
   skeleton's copies, not these, and nothing points it at `core/`.
2. **Nothing vendors core yet, so nothing is hash-checked yet.** `Extension/Full_Screen_Shot/tool.json`
   sets `"core": null` on purpose and has no `vendor/core/` directory. `check-core-sync.mjs` and the
   `ci.yml` step that runs it are wired and currently have no subject. The gate is real; it is idle.
3. **No `ns.js`, so no namespace.** The promoted modules keep the globals their sources define — `SK_*`
   and `sk*` from `settings.js`, `SKDB`, `SKJOBS`. Renaming them onto a namespace object that nothing
   defines yet, with no core sim to catch a mistake, would be an unverified rewrite of working code.
4. **`settings.js` is not drop-in vendorable.** As promoted it is a *template*: a tool is meant to fill in
   its own defaults, key lists and migrations, and it still carries the skeleton's `PLACEHOLDER` markers.
   But a vendored core file is hash-checked and must not be hand-edited. Those two facts contradict each
   other. The reconciliation — the tool handing its schema *in* rather than the file declaring it — is the
   first real design decision `core/v1` needs, and it is not made. Until it is, treat this as the
   reference copy of a proven implementation.
5. **`core/dev/` duplicates three files** that still live under `Extension/Full_Screen_Shot/test/pixel-sim/`.
   Deliberate, explained above, and guarded by nothing but the sha256 in each header, which nothing
   recomputes.

---

## Licence

`core/` is **MPL-2.0** (`core/LICENSE`). Every file in `core/v1/` and `core/dev/` carries
`SPDX-License-Identifier: MPL-2.0` — verified, all six.

**The tools in this repo are not open source, and the difference is not "weaker copyleft".** Each
extension carries its own `LICENSE` (there is no repo-root one; the root `README.md` points at the
per-extension file), and both trees these files came from — `templates/tool/` and
`Extension/Full_Screen_Shot/` — are **PolyForm Shield License 1.0.0**, a source-available *non-compete*
licence rather than an OSI or copyleft one. PolyForm Shield forbids using the software to compete with
the licensor. MPL-2.0 does not.

So putting `core/` under MPL-2.0 is a deliberate, one-directional decision: this shared layer may be
adopted, improved and shipped by anyone — including someone building a competing extension — while the
tools themselves stay non-compete. Making a *narrower* licence choice for `core/` later would not undo
copies already taken under this one.

Relicensing a copy is the copyright holder's call, and the copies still under `templates/tool/` and
`Extension/` keep the licence of the tree they are in. One loose end, named because it qualifies the
sentence above: neither source `LICENSE` currently names that holder — `templates/tool/LICENSE` still carries
the `⟨LICENSOR⟩` placeholder that PolyForm's Notices section requires to be filled in. That needs doing,
and it is not a `core/` decision.
