# Architecture

How this repository fits together, and why each part is shaped the way it is.

This is a **catalogue of independently shipped MV3 browser extensions, not an application.** That one
sentence decides everything below. There is no repo-wide build step, no workspace tool, no shared
`node_modules` that an extension depends on at runtime, and no release that ships more than one
extension at a time. Each tool carries its own version, its own package, its own store listings and its
own release.

Two consequences worth stating plainly, because they are constraints rather than preferences:

- **Clone and load unpacked has to work.** A contributor points `chrome://extensions` at a tool
  directory and it runs. Anything that breaks that — a bundler, a codegen step, a dependency install —
  is a per-tool opt-in with a written reason, never a repo-wide decision.
- **Nothing shared may be *linked*.** The unit of delivery is a zip containing one directory. Shared
  code has to be *inside* that directory when the zip is built, so shared code is copied. The rest of
  this document is largely about making a copy auditable instead of assumed.

---

## 1. Naming

| Identifier | Form | Example | Used by |
| --- | --- | --- | --- |
| Category directory | `Capitalized_Singular` | `Extension/` | filesystem only |
| Tool directory | `Title_Snake_Case` | `Full_Screen_Shot/` | filesystem only |
| **Tool id** | `lowercase-kebab` | `fullshot` | tags, zip filenames, CI matrix, artifact names |
| Product name | free text | `FullShot` | manifest, store listings, README |

**A category is a delivery surface, not a product theme.** `Extension/` is where things that install
into a browser live. A surface determines the toolchain, the package format and the store target, and
it does not change. Themes ("capture", "privacy", "productivity") change whenever the marketing does,
and re-categorising breaks every path, tag and store reference that pointed at the old one. So one flat
`Extension/` directory is correct; sub-foldering it by theme is not.

**The tool id — not the directory — is the stable public handle.** Directories can be renamed. Ids
cannot: they appear in tags, in package filenames and in artifact names, and a rename orphans all of
them. Choose the id once, when the tool is created.

**Casing is load-bearing.** Git on Windows is case-insensitive by default; Linux CI runners and
zip-entry lookups are not. `<script src="Pages/db.js">` works on a Windows machine and 404s inside the
package on a reviewer's Linux box. The package graders therefore resolve every reference **case-exactly**
and report a case mismatch as its own kind of failure, separate from "missing" — because
"not in the package" sends an author hunting for a file that is right there. If you ever rename by case
alone, set `git config core.ignorecase false` first.

---

## 2. Why shared code is vendored into each tool

MV3 has no shared-code mechanism. There is no runtime module resolver, no package manager inside the
browser, and no way for one installed extension to import from another. Everything the extension loads
must be a file inside its own package. Three obvious alternatives fail for concrete reasons:

| Alternative | Why it does not work |
| --- | --- |
| Relative imports across the repo (`../../core/v1/msg.js`) | Only files inside the tool directory are packaged. The reference resolves on disk and is absent from the zip — the exact failure the reference-integrity gate exists to catch. |
| Symlinks | Windows needs Developer Mode or admin, Git for Windows has `core.symlinks` off by default, and the unpacked loader treats them inconsistently. |
| npm workspace with a `file:` dependency | Drags `node_modules` into a runtime with no module resolver, and forces a build step to flatten it — the thing this repo is built to avoid. |

**So the copy is the design, and the discipline is around the copy.** Shared code is copied into the
tool, committed with it, and checked against its source. That buys four things worth more than the
elegance of a link: the tool directory loads unpacked with zero setup; adopting a shared change is a
visible diff in the pull request that adopts it; a tool can stay on an older shared version while
another moves ahead; and a hand-edit of a copied file is a check failure rather than a silent fork.

The admission rules for shared code — what may be copied into every tool in the first place — are in
[CORE-POLICY.md](CORE-POLICY.md).

### The vendored directory is `vendor/core/`, never `_core/`

Chrome refuses to load an extension whose package has a root file or directory whose name begins with
an underscore:

```
Cannot load extension with file or directory name _core.
Filenames starting with "_" are reserved for use by the system.
```

`_locales` is the only permitted exception. This is not a style rule and it has no workaround: the
extension does not load at all. Any vendored directory is `vendor/core/`.

**The same rule has a second, opposite edge, and it has already bitten this family once.** Because
underscore-prefixed entries are forbidden, the intuitive packaging rule is "exclude `_*`" — and that
rule silently drops `_locales/`. Once `default_locale` is declared, an extension whose default
catalogue is missing is rejected on upload, and if it were installed it would not load. So the packager
treats `_locales/` as **allowlist-always**: it enumerates the locale directories directly, outside the
pattern language that decides everything else, and unions them in unconditionally. The general pattern
rule is deliberately kept as well, and the build reports when the two paths disagree — two independent
statements of the same claim, so the bug is both impossible and visible.

### Load form: classic scripts, one namespace

Shared files are classic scripts that attach to a single global namespace, not ES modules. The reason is
that one file must load in three places with no build step:

```html
<!-- an extension page -->
<script src="../lib/settings.js"></script>
```
```js
// the Chrome service worker
if (typeof importScripts === 'function') importScripts('lib/settings.js');
```
```jsonc
// the Firefox event page loads the same files through the manifest
"background": { "scripts": ["lib/settings.js", "lib/storage.js", "lib/jobs.js", "background.js"] }
```

Note the guard in the second block. Firefox runs `background.scripts` as event-page scripts, where
`importScripts` is undefined; calling it unguarded throws at load and the add-on is dead. The guard
belongs in the `background.js` **source**, not in a build step that patches the Firefox package —
otherwise the Firefox package is a hand-patched artifact rather than a build output, and one source
tree no longer serves both engines.

---

## 3. The scripts are the gate

A gate here is a plain Node script with **no dependencies**, runnable with the same command on a
developer's machine and on a runner. Five properties make them worth trusting:

1. **They grade the artifact, not the intention.** The package graders read entries back out of the
   finished zip rather than trusting the file list the builder meant to write. "The list and the archive
   disagreed" is the entire class of bug they exist for.
2. **The zip is graded, not the folder.** Every other check reads the working tree — the node sims, the
   browser smoke run, and the developer, who loaded the tree too. A file that loads unpacked and 404s
   inside the archive is invisible to all three.
3. **The file list is a positive allowlist.** Only files the browser loads are packaged, pinned per
   directory. A stray `.md` dropped into `pages/` cannot ride along, because nothing but `.html`, `.js`
   and `.css` from `pages/` ever could. This matters more than tidiness: test fixtures in this family
   deliberately contain network APIs and an exfiltration-shaped URL, inside items whose listing claim is
   that they make no network calls. An automated scan finding those in a package is a malware referral,
   not a warning.
4. **A refusal beats a bad artifact.** The packager refuses to *write* when the localisation gate fails
   or when the Firefox add-on identity is still a placeholder, rather than writing and warning. A file
   that exists is a file somebody uploads at 11pm, and an unshippable zip written over the last good one
   is not something an exit code can undo.
5. **Every gate has a recorded failing case.** An assertion that cannot fail is worse than none — it
   inflates apparent coverage. If you cannot write the input that makes a check go red, delete it or
   re-point it.

The privacy claim is one of these gates rather than a sentence in a README: no packaged script may
reach the network, and the graders scan packaged scripts for network APIs. Extensions in this
repository collect no analytics, and that is checkable from the artifact.

### What exists today

A status table dates instantly, and a stale one is worse than none — it gets read as current. So each row
below names **where the authority is**; the snapshot is only the last column. Verified against the tree on
**2026-08-14**, while several of these were actively being written. Re-derive before relying on any of it.

| Capability | Where it lives / who decides | Status, 2026-08-14 |
| --- | --- | --- |
| Deterministic packager, positive allowlist, both targets | `templates/tool/publish/pack.mjs` | Real, runnable |
| Package grader (case-exact references, leaks, network scan, locale completeness, version parity, previous-release diff) | `templates/tool/publish/verify-package.node.js` | Real, runnable |
| AMO submission gate (gecko id, data-collection declaration, background fallback, Chrome-only keys) | `templates/tool/publish/verify-firefox-package.node.js` | Real, runnable |
| Version bump across every version site | `templates/tool/publish/bump-version.mjs` | Real, runnable |
| Specialisation gate ("has this copy become a tool yet?") | `templates/tool/publish/preflight.mjs` | Real, runnable, red by design in the template |
| Listing screenshots at store-legal dimensions | `templates/tool/publish/shots.mjs` | Real, runnable |
| Node simulation tier and harness | `templates/tool/test/skeleton-sim.node.js`, `templates/tool/test/harness.js` | Real, runnable |
| Real-browser smoke tier | `templates/tool/test/browser/smoke.mjs` | Real, runnable |
| Pixel simulation (fake DOM, canvas2d, PNG encoder) | `Extension/Full_Screen_Shot/test/pixel-sim/` | Real, runnable |
| Drift audit across stamped tools | `templates/tool/tools/audit-fleet.mjs` | Real, runnable |
| A tool's own packager | `Extension/Full_Screen_Shot/publish/package.node.js` | Real, runnable — **an older, separate implementation from the template's** |
| The shared runtime | `core/` — and `core/core.json` is its own status file, module by module | **Partial, v0.1.0.** Three files are in `core/v1/`, but only **one of the eleven specified** modules; the other two were never on the list. Every one was promoted from code that already ran. `core/test/` holds no sims. See [CORE-POLICY.md](CORE-POLICY.md#5-status-what-exists-today). |
| The vendored copy inside a tool | `<tool>/vendor/core/` | **Absent everywhere.** There is no `vendor/` directory in the tree at all, so the hash gate that makes a copy honest is not yet exercised by anything. |
| Repo-level gates | `scripts/`, and the header comment of `.github/workflows/ci.yml` is the authoritative list of what CI requires | **Incomplete, landing.** A script that header names and CI cannot find fails the job on purpose — there are no `if [ -f … ]` guards, because a workflow that skips its own absent gates is a green build that checked nothing. `ls scripts/` answers "which exist". |
| The per-tool contract | `Extension/Full_Screen_Shot/tool.json`, `templates/tool/tool.json` | Written; **not yet consumed end to end** (§5). |
| Scaffolding a new tool | `scripts/new-tool.mjs`, stamping from `templates/tool/` | Real, runnable. `templates/tool/` is the full 132-file stamp since the move recorded in `MIGRATION.md`; copying by hand still works. |
| CI | `.github/workflows/` (`ci`, `release`, `e2e`), the issue forms, `.githooks/pre-commit` | Present and **not green**: the workflows call `scripts/*.mjs` gates that are still landing, and no tag exists, so `release.yml` has never run. |

**FullShot and the template do not share a packager.** FullShot predates the template and carries its own
`publish/package.node.js` with the same design and a different implementation. Two implementations of
one rule is a real divergence, not a nuance: a fix applied to one is not applied to the other. Treat
convergence as work that has not happened yet.

---

## 4. The template is a stamp, not a library

A new tool is made by copying the template directory and specialising it. Copying is the only mechanism
available — see §2 — so the discipline is entirely in what the copy records and what a script can check
afterwards:

- **Provenance is stamped at copy time.** `skeleton.json` records which template version the tree came
  from, which tool it became, and when. Retro-stamping is guesswork: by then the copies have diverged
  for good reasons and accidental ones, and telling them apart means reading the inherited test code in
  every tool.
- **The inherited set is declared.** `skeleton.json` lists the files a tool is expected *not* to edit.
  Editing one is allowed — it just has to be a decision somebody can see, rather than many copies
  quietly diverging. `tools/audit-fleet.mjs` reads that list across tools and reports what has drifted.
- **The template is red on purpose.** `preflight.mjs` answers "has this copy actually become a tool
  yet?", so in the template itself every item is outstanding. It is not part of the all-green set, and
  it must never be added to it.
- **A stamped copy is not a shippable listing.** Identical descriptions and screenshots across listings
  fail Microsoft's distinct-metadata rule, and identical copy is a stamped portfolio's *default output*
  rather than an accident that might happen. Differentiation is a required step, not polish — see
  [STORE-PLAYBOOK.md](STORE-PLAYBOOK.md).

---

## 5. Where a tool's contract lives

The architecture calls for one file per tool — `tool.json` — as the entire coupling surface between a
tool and the repo: id, package allowlist, targets, tests, permission justifications and an empty network
allowlist that makes the privacy claim machine-readable. **The file exists for FullShot. Nothing reads it
end to end yet** — the gates that would consume it (`pack`, `verify-refs`, `run-tests`) are the part still
landing. Treat it today as a written contract with no enforcement behind it, and check `scripts/` before
assuming otherwise.

Two properties of it are worth knowing before writing the second one:

- **It was filled in from the tree, not from the plan.** Where a planning document and the shipped
  artifact disagreed, the artifact won and the disagreement is recorded in the file rather than smoothed
  over. Its package list was checked against the 85 entries of the zip that actually shipped.
- **It carries an `absent` block.** A tool records what the architecture names and it does not have — no
  `CHANGELOG.md`, no vendored core, a Firefox manifest that is a full second manifest rather than an
  overlay. A gap that is written down can be read as a gap; a plausible stub cannot.

Three other files hold the rest of a tool's facts:

| File | What it owns |
| --- | --- |
| `manifest.json` | The version. The single source of truth; the AMO manifest and the CHANGELOG follow it. |
| `publish/identity.json` | The facts that appear in more than one place: slug, owner domain (the Firefox add-on id is derived from it), support email, hosted privacy-policy URL. Every publish script reads them from here so they cannot be typed twice and drift. **Template-side only — FullShot has none**, which is part of why its publish scripts are a different set. |
| `skeleton.json` | Provenance and the inherited-file list (§4). |

The package allowlist, the permission justifications and the network prohibition are also stated in code
and prose (`pack.mjs`, `publish/package.node.js`, `publish/STORE-LISTING.md`, the graders). Where those
and a `tool.json` disagree, the code is what ships — so the contract file is the thing to correct, not
the evidence.

---

## 6. Reading order

- Releasing a version: [RELEASING.md](RELEASING.md)
- Getting a package in front of a store reviewer: [STORE-PLAYBOOK.md](STORE-PLAYBOOK.md)
- Deciding whether something may become shared code: [CORE-POLICY.md](CORE-POLICY.md)
