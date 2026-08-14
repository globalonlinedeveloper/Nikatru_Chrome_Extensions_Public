# Changelog — `core/`

All notable changes to the shared runtime. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
newest first. `core/` is versioned independently of the tools that vendor it, and its tag form is
`core-v<version>` (this entry: `core-v0.1.0`). The channel directory — `v1` — is the major version; a
breaking change becomes `core/v2/` beside it rather than a new number here.

> **The tag records a point in history; it does not trigger anything.** `.github/workflows/release.yml`
> matches `*-v<semver>` tags and then explicitly excludes `core-v*`, because core ships no package and has
> no store listing, so tag parsing would go looking for a tool called "core" and fail confusingly. Pushing
> `core-v0.1.0` starts no workflow run. An empty `gh run list` after that push is the designed behaviour,
> not a stuck queue.

## [0.1.0] — 2026-08-14

The directory exists and holds only code that already existed and was read. Nothing here was written from
a description of what it should do.

### Added — `core/v1/` (runtime, vendored into tools)

Each file is its source byte for byte, under a header that names that source and the sha256 it had at
promotion. The header is the only addition.

- `v1/settings.js` — schema, defaults, the sync/local partition, migrations, change events over
  `chrome.storage`.
  Promoted from `templates/tool/lib/settings.js`
  (`sha256 889185d1ee85b9b0d99fee91fb46ffabd3d65a930c029bc3546a7be2c0321354`).
- `v1/storage.js` — the concrete IndexedDB wrapper: `scratch` and `items` stores, age and count sweeps,
  export, quota classification, `clearAll`.
  Promoted from `templates/tool/lib/storage.js`
  (`sha256 7f40a480f088fc728a895ea9e8bd0c66980fa5f0602e1d4175a1ef0ba82fbb6f`).
- `v1/jobs.js` — the in-flight job table, mirrored write-through to `chrome.storage.session` so it
  survives service-worker termination.
  Promoted from `templates/tool/lib/jobs.js`
  (`sha256 820e3d3be269a94a65d1597665816f59f9a52564700f73e78fa6a14fc13665f5`).

### Added — `core/dev/` (Node-side test helpers, never shipped)

Outside the vendored surface. One part of that is structural — `sync-core.mjs` walks `core/v1/**` and
never sees `dev/`. The companion rules (no packaging allowlist may include `dev/`, nothing in an extension
may `require` it) are review conventions; `policy-check.mjs` asserts neither today.

- `dev/fakedom.js` — fake DOM for simulations.
  Promoted from `Extension/Full_Screen_Shot/test/pixel-sim/fakedom.js`
  (`sha256 8479fc889ef0c2155ec7e03d4de40fcaaf9cd77e17a27dcd9e6a15ba5ad35e8e`).
- `dev/canvas2d.js` — buffer-backed canvas + 2d context subset.
  Promoted from `Extension/Full_Screen_Shot/test/pixel-sim/canvas2d.js`
  (`sha256 14197e20f7f6fd852b78903fc6340b0a4d91e65533cbcd32eb5e1f9e46948488`).
- `dev/png.js` — minimal 8-bit RGBA PNG writer, `node:zlib` only.
  Promoted from `Extension/Full_Screen_Shot/test/pixel-sim/png.js`
  (`sha256 663c2f0e21999a78559b53942fbbdef52d2a0e124d20f39e60aeb0e9b9238337`).

The three originals stay where they are. FullShot's sims require them by relative path and FullShot's
terms of entry are zero file moves; promoting by copy was the only available move. Two copies now exist,
guarded by the recorded sha256 and nothing else — no script recomputes it.

### Added — declarations

- `core.json` — `{ version, channel }` plus a per-module status map (`built` / `planned`) with a one-line
  statement of what each module owns, a `caveat` where one applies, and a `gaps` list. The map is keyed by
  **file path** because `scripts/sync-core.mjs` looks up `modules[channel + '/' + relativePath]` for each
  file it copies, so it can surface core's own caveats to a tool that adopts a module.
- `README.md`, `CHANGELOG.md`, `LICENSE` (MPL-2.0).

### Not implemented — declared, deliberately absent

No stub, no empty file, no placeholder export exists for any of these. A fail-closed stub in a shared
runtime reports healthy while doing nothing, which is worse than an obvious hole.

`v1/ns.js` · `v1/msg.js` · `v1/idb.js` · `v1/download.js` · `v1/clipboard.js` · `v1/i18n.js` ·
`v1/diag.js` · `v1/detect/pii.js` · `v1/imaging.js` · `v1/ui/` (three files: `tokens.css`, `base.css`,
`controls.js`)

**That is 10 of the 11 modules the v1 architecture specifies** — `settings.js` is the one that exists.
Counted as files rather than modules it is 12 of 13, because `ui/` is one module holding three files. Both
figures and the rule that produces them are in `core.json` → `counts`; the 11 is derived from the
`"module"` field on each specified entry, not typed beside the list. What each will own is in `README.md`
and in `core.json` under `modules[*].owns`.

### 🔴 Known-red — `core/test/` is absent and CI says so

Admission rule 6 is *every core module ships with a Node sim in `core/test/`*. None of the three does, and
`core/test/` does not exist. The `core sims` job in `.github/workflows/ci.yml` therefore lints `core/`
(6 files, passing), globs `core/test/*.node.js`, finds none, prints

```
::error::core/ exists but core/test/ holds no sims — every core module ships with one.
```

and **exits 1**. That job is written so an empty glob fails rather than passes, because a loop over zero
files that exits 0 is indistinguishable from a passing run — which is the exact trap this repo's gates are
built to refuse. The red is correct. Wire the sims to clear it.

### Notes on this release

- **Version is 0.1.0, not 1.0.0.** 1 of 11 specified modules is built. The number becomes 1.0.0 when the
  v1 surface is real. No tool pins a core version yet — `Extension/Full_Screen_Shot/tool.json` has
  `"core": null` — so 0.1.0 breaks no pin.
- **Nothing vendors core yet.** No `vendor/core/` directory exists in any tool, so `check-core-sync.mjs`
  and the `ci.yml` step that runs it are wired and idle. Nothing is hash-checked in anger today.
- **The build order inverted.** The architecture expected `ns.js`, `msg.js` and `ui/tokens.css` first;
  none of the three exists anywhere in this repo, while `settings.js`, `storage.js` and `jobs.js` do. Only
  the latter were promoted. `storage.js` and `jobs.js` are not on the specified v1 list at all and are
  marked `"specified": false` in `core.json`.
- **`storage.js` is not `idb.js`.** `idb.js` is the generic primitive (open/upgrade/txn/put/get/cursor/
  quota) and is unbuilt; `storage.js` is the opinionated wrapper that exists. Renaming one to the other
  would have been a false claim of work done.
- **`settings.js` is not yet drop-in vendorable**: it declares a tool's own defaults and key lists inline
  and still carries `PLACEHOLDER` markers, while vendored files are hash-checked and must not be
  hand-edited. Reconciling that is `core/v1`'s first real design decision and it is not made.
- **Verified on promotion**, not assumed: all six files pass `node --check`; each body was compared byte
  for byte against its source after the header was prepended; each was loaded and exercised once on Node
  24.18.0 — `encodePng` emits bytes opening with the PNG signature, `FakeCanvas` (no-arg constructor,
  `width`/`height` setters allocate) fills inside its rect and leaves the pixel outside at zero alpha,
  `SKJOBS.set(job)` / `has` / `size` / `stale` work with no `chrome.*` present, `SKDB.scratchKey('job1',3)`
  gives `"job1:00003"` and `isQuotaError` separates a `QuotaExceededError` from a plain one, and
  `settings.js` exposes its six functions and its three key lists (`SK_SYNC_KEYS`, `SK_LOCAL_KEYS`,
  `SK_INTERNAL_KEYS`). That was a one-shot smoke check run by hand. It is not `core/test/` and it does not
  run in CI — see the known-red section above.
- **Licence.** `core/` is MPL-2.0. The trees these files came from — `templates/tool/` and
  `Extension/Full_Screen_Shot/` — are **PolyForm Shield License 1.0.0**, a source-available non-compete
  licence, not a copyleft one; MPL-2.0 is the more permissive of the two and lets anyone, competitor
  included, adopt this layer. The copies still under `templates/tool/` and `Extension/` keep the licence of the
  tree they are in. Neither source `LICENSE` yet names the copyright holder — `templates/tool/LICENSE` still
  carries the `⟨LICENSOR⟩` placeholder PolyForm's Notices section requires to be filled in.
