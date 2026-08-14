# Releasing

The path from a working tree to a package a store will accept.

One tool is released at a time. Nothing here builds, versions or tags more than the tool you are
standing in. Commands are shown from a tool's own directory.

**CI exists and cannot pass yet.** `.github/workflows/` holds `ci.yml`, `release.yml` and `e2e.yml`, and
they are written to call `scripts/*.mjs` gates that are still landing — a named script CI cannot find
fails the job, deliberately, rather than being skipped. No tag has ever been pushed, so `release.yml` has
never run. **Until that clears, the release is a human running the local commands below in order.** That
is a statement about the tree as of **2026-08-14**, not a design position — the design position is that a
gate must be runnable identically in both places, which is why they are dependency-free Node scripts.

---

## 1. The sequence

```
node publish/preflight.mjs                # is this still a template? fix every TODO first
node test/<tool>-sim.node.js              # the node tier — ALL PASS
node test/browser/smoke.mjs               # the real-browser tier — ALL PASS
node _locales/make-locales.mjs --check    # the locale catalogues are in step
node publish/bump-version.mjs minor       # stamps a CHANGELOG stanza — fill it in
node publish/pack.mjs                     # writes and grades both packages
node publish/verify-firefox-package.node.js
```

**Every one of these ends in `process.exit(failures ? 1 : 0)`, so the exit code is the signal — read it
and the output.** What is not trustworthy is how a shell reports that code:

- `node gate.mjs | tail -5` gives you *`tail`'s* status. A failing gate reads as `0`.
- `printf '%s %s\n' "$(basename "$g")" "$?"` gives you *`basename`'s* status, because the command
  substitution runs before `$?` is expanded. A loop written that way reports every gate green.

Capture the status on its own line, before anything else runs, and print the variable:

```sh
out=$(node "$g" 2>&1); code=$?; printf '%s EXIT %s\n' "$(basename "$g")" "$code"
```

A checking loop is itself a check. Run yours once against a gate you know is red and confirm it prints
non-zero, before you trust a screen of passes.

`preflight.mjs` is deliberately red in the template — its whole job is to answer "has this copy become a
tool yet?". It is not part of the all-green set. When it goes green, the two test tiers are green, and
the packager grades clean, you are looking at a submittable item.

**FullShot is on an older toolchain.** It carries `publish/package.node.js` instead of `pack.mjs`, and it
has no `identity.json`, no `preflight.mjs` and no `bump-version.mjs`. Its build command is
`node publish/package.node.js`. The sequence above is the template's; FullShot's equivalent steps exist
but are not the same files. Converging them is work that has not been done.

---

## 2. Version

**`manifest.json` `version` is the single source of truth.** Nothing else declares a version — no
`package.json` version, no metadata file version. Every duplicate is a drift bug waiting for a release
day.

The version is nevertheless *written* in more than one place, which is why bumping is a script and not a
three-character edit:

| Site | Why it is easy to miss |
| --- | --- |
| `manifest.json` | The source of truth. |
| `publish/manifest.firefox.json` | A second manifest that AMO reads and that nothing else will remind you about. |
| `CHANGELOG.md` heading | The release notes come from here. |
| Both package filenames | Derived: `<slug>-<version>.zip` and `<slug>-<version>-firefox.zip`. |

```
node publish/bump-version.mjs patch     # 1.2.3 -> 1.2.4
node publish/bump-version.mjs minor     # 1.2.3 -> 1.3.0
node publish/bump-version.mjs major     # 1.2.3 -> 2.0.0
node publish/bump-version.mjs 1.2.3     # exactly that
node publish/bump-version.mjs --check   # do all the sites agree?
node publish/bump-version.mjs --sync    # re-derive gecko.id from identity.json; touches no version
```

The list of version sites is declared data, not a guess. Adding a site is one line, and a site that
stops matching is a hard failure rather than a silent skip.

### The format rules the stores enforce

- **One to four dot-separated integers, each 0–65535, no leading zeros.** Nothing else is a valid
  extension version.
- **No pre-release suffixes.** `1.9.11-beta` is not a legal Chrome version. Gecko would accept
  `1.9.11beta1`; do not use it. One convention across three stores beats each store's maximum
  expressiveness.
- **Use the fourth component for a store-only re-upload** that carries no source change: `1.9.11.1`.

### Never reuse a version number

Two different packages under one version is unrecoverable in public: the store keeps whichever it
received first, and no diff afterwards tells you which one a given user has. Bump before you rebuild,
always. The bump script refuses to bump to the current number for this reason.

---

## 3. CHANGELOG

Keep-a-Changelog form, newest first:

```markdown
## [1.10.1] — 2026-08-14
### Fixed
- …
```

The heading is one of the version sites, so the bump script and `preflight.mjs` both check that it
matches the manifest. Write the stanza when you bump, while you still know what changed — a release note
reconstructed a week later is a guess with a date on it.

---

## 4. Pack

```
node publish/pack.mjs                    # build both packages, then grade them
node publish/pack.mjs --verify           # grade what is already there, build nothing
node publish/pack.mjs --extract <dir>    # unpack the built package for the browser tier
```

Two packages come out of one source tree:

| File | Goes to | Manifest |
| --- | --- | --- |
| `<slug>-<version>.zip` | Chrome Web Store **and** Microsoft Edge Add-ons — the same file, unchanged | `manifest.json` |
| `<slug>-<version>-firefox.zip` | AMO | `publish/manifest.firefox.json` swapped in |

`background.js` is identical in both. The `importScripts` guard lives in the source file, so there is no
patch step and no text anchor to lose.

**Two refusals are deliberate, and both mean "nothing was written".**

- If the localisation gate fails — a declared `default_locale` whose catalogue is missing, or locale
  files on disk the build did not collect — the packager writes nothing and leaves the previous zips
  untouched. A store rejects that upload outright, and an unshippable zip written over a good one is not
  something a non-zero exit can undo.
- If the Firefox add-on identity is still a placeholder or disagrees with `identity.json`, no Firefox
  package is written at all. AMO fixes an add-on's identity at first signing; see
  [STORE-PLAYBOOK.md](STORE-PLAYBOOK.md#firefox--amo).

### What the grader checks

Run automatically by `pack.mjs`, and separately with `node publish/verify-package.node.js`:

- `manifest.json` is at the **root** of the archive, not nested inside a folder. Hand-zipping a folder in
  Windows Explorer nests everything and the store answers "Manifest file is missing or unreadable" — the
  most common first-upload failure there is.
- Every reference inside the package — manifest paths, `<script src>`, `<link href>`, `importScripts`
  arguments — resolves **inside the package, case-exactly**. A case mismatch is reported as its own
  verdict, separate from missing.
- No packaged script can reach the network.
- Nothing leaked: no `test/`, no `.md`, no build script, no `node_modules`, no scratch file, no
  credential-shaped filename.
- `_locales` ships in full; nothing else underscore-prefixed ships at all.
- `LICENSE` **is** in the package, deliberately — PolyForm Shield requires the terms to travel with every
  copy, and a store user receives the zip. (FullShot's older packager does **not** allowlist it: its
  shipped 1.10.1 zip has 85 entries, `background.js` and `manifest.json` at the root, and no `LICENSE`.
  That is a divergence to close, recorded in its `tool.json`, not a rule with an exception.)
- The manifest passes the store's upload rules: `manifest_version` 3, name and short-name and description
  length limits **in every locale**, every `__MSG_*__` resolving, no static `host_permissions`, no
  developer `key`, no `update_url`, an icon set including 128.
- Version parity across the manifest, the AMO manifest, the CHANGELOG heading and both filenames.
- A **diff against the previous release**, so a silently dropped file is caught. Versions are compared
  numerically — a lexical sort puts `1.9.7` after `1.9.11` and would quietly diff against the wrong
  release.

### The build is deterministic, and that is the point

Entries are sorted, the timestamp is fixed, and the compression level is pinned, so the same inputs
produce the same bytes. A rebuild that changes the file is a change in the *code*, and it can be diffed.
That is what makes a privacy claim checkable by someone who does not trust you: rebuild from the source
at a given version and compare hashes with the artifact the store received.

The built zips are kept in `publish/` as golden masters — the exact artifacts a store received, and what
the next build diffs against. This is a deliberate divergence from the usual "build output never enters
git" rule, and the root `.gitignore` says so in place. Real release binaries also belong on a release
page; the copy in `publish/` is the reference, not the distribution.

⚠️ **A tool's own nested `.gitignore` can quietly overrule the root's exception**, and a golden master
that is not committed is not a golden master — it is a file on one machine. Today only
`templates/tool/publish/skeleton-0.0.1.zip` is tracked; FullShot's `.gitignore` carries a bare `*.zip`, so its
five shipped pairs exist on disk and in no commit. Check the file, do not assume the rule:
`git check-ignore -v <path-to-zip>` names the line that decided.

---

## 5. Tag and release

The convention is `<tool-id>-v<version>` — `fullshot-v1.10.1`. Ids are lowercase-kebab and permanent
(see [ARCHITECTURE.md](ARCHITECTURE.md#1-naming)).

```
git commit -am "fullshot: v1.10.1 — <what changed>"
git tag fullshot-v1.10.1
git push origin main --tags
```

A release carries both packages and their checksums:

```
<id>-<version>.zip
<id>-<version>-firefox.zip
SHA256SUMS.txt
```

**`release.yml` exists and has never run — no tag has been pushed.** It fires on `<tool-id>-v<semver>`
(and excludes `core-v*`, which is versioned but is not a tool), then re-runs the gates, builds both
packages, checksums them and creates the release with `gh`. Until its `scripts/` gates are all present,
creating the release and attaching the artifacts is manual. Two rules survive automation either way: the
tag must be on an ancestor of the default branch, and the tag version, the manifest version and the top
CHANGELOG entry must be the same string — the check that kills the entire class of "shipped 1.10.1 with
1.10.0 in the manifest".

FullShot cannot satisfy that check yet: it has **no `CHANGELOG.md`**, so only two of the three numbers
exist to compare. Backfilling it is a prerequisite for its first tag, not a tidy-up afterwards.

---

## 6. After it is live

- Install the published item yourself, on a profile that is not your development profile, and do the
  thing the single-purpose sentence promises.
- Keep the shipped zip as the golden master for the next diff.
- Write the first line of the next CHANGELOG entry while you still remember what you are about to do.

Two failure modes are worth remembering because they cost days rather than minutes:

- **A resubmission restarts the review queue.** Getting the listing right the first time is worth an
  hour of care; see [STORE-PLAYBOOK.md](STORE-PLAYBOOK.md).
- **Never upload a hand-zipped folder.** Besides the nesting problem, hand-zipping sweeps in `test/`,
  whose fixtures deliberately contain network APIs inside an item whose listing claim is that it makes
  none. The allowlist makes that impossible; a right-click makes it likely.
