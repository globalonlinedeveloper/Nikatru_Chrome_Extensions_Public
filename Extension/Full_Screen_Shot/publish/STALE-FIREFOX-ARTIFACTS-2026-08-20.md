# Six Firefox packages that carried a placeholder add-on id — deleted 2026-08-20

**This is the record that made deleting them safe. It is deliberately the only thing that survived
them.** Everything below was measured from the files themselves before they were removed.

## What they were

Six built Firefox store packages whose `browser_specific_settings.gecko.id` was the placeholder
`fullshot@REPLACE-WITH-YOUR-DOMAIN.example`. All six predated 2026-08-18, the day
`publish/manifest.firefox.json` was converted to an RFC 7386 merge patch and its id set to
`fullshot@nikatru.com` from `publish/identity.json`.

Measured by inflating `manifest.json` out of each archive — first on 2026-08-20 when they were moved
out of `publish/`, and re-measured immediately before deletion. Both readings agreed exactly.

| file | version | bytes | `gecko.id` | sha256 |
|---|---|---:|---|---|
| `fullshot-1.9.7-firefox.zip`   | 1.9.7  | 105 439 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `f357fc634bd0c095a118e31193bdaaa211d15a493fac6f4f80916b1854a52994` |
| `fullshot-1.9.11-firefox.zip`  | 1.9.11 | 106 619 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `1c682500d1a565ab65efcc1c61a42a25466b33af4ade94c7226b454fc553d7f4` |
| `fullshot-1.9.13-firefox.zip`  | 1.9.13 | 137 063 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `4883d5423ef089f8dca24afa1ef9f151e4ea7d7cb38710df95cd6169c99c9f86` |
| `fullshot-1.10.0-firefox.zip`  | 1.10.0 | 595 715 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `37c73e3b5b382839335097b40ddcb9790f045628170d2b21ac76aec7c4a6c086` |
| `fullshot-1.10.1-firefox.zip`  | 1.10.1 | 940 175 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `6ee44ed30a3e329f9f1414bc991deedab8ef73e7d1e56889b080389bc1a3efa4` |
| `fullshot-1.10.2-firefox.zip`  | 1.10.2 | 940 164 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `a20093b9e32f1cf66962dfe5e11fff9974e12389eeaac4ef304d47e37df5d8cd` |

2 825 175 bytes in total.

**Use this table to identify a copy that turns up elsewhere** — on a backup drive, in a cloud sync, in
somebody's Downloads. A file matching any sha256 above is one of these six and **must not be uploaded
to AMO**, whatever its filename.

The six **chromium** zips in `publish/` were never affected: they carry no `browser_specific_settings`
at all, which is correct for Chrome and Edge. They were not touched.

## 🔴 Why these six were dangerous and an ordinary stale artifact is not

The placeholder **passes AMO validation**. It is a syntactically valid email-style id on a domain
nobody owns, so an upload does not bounce — it succeeds, and binds the add-on to that identity.
Mozilla's addons-server documentation states that a guid *"cannot be restored and will forever be
unusable for submission"*.

The failure mode was therefore not a rejected upload somebody retries. It was an **accepted** upload
discovered afterwards, with no way back: a new listing, and every install, review and rating starting
from zero.

There was also a live trap while they sat in `publish/`. `publish/verify-firefox-package.node.js`
defaults its `--zip` argument to `publish/fullshot-<version>-firefox.zip`, so running that script with
no arguments graded one of these files rather than a fresh build.

## Why deleting was safe, and why it needed this file first

They were **untracked** — `Extension/Full_Screen_Shot/.gitignore` ignores `*.zip` — and this
repository has **zero tags**, so there was no commit to rebuild them from. Deletion was genuinely
irreversible.

What made it safe is that nothing needed them. They cannot be uploaded, no script reads them, and no
build depends on them. The only value they had was forensic, and this table is that value, kept.

## What holds the line now

`scripts/check-store-packages.mjs` opens every built store package it can find and refuses a
`gecko.id` that is the placeholder or that disagrees with `publish/identity.json`. It runs in `ci.yml`
twice:

- in `gates`, where a clean checkout has no packages and it **says so on every run**, so
  "0 packages, clean" cannot be misread as "12 clean";
- in `package`, where it grades the zip that job just built — the one place in CI where the subject
  really exists.

Verified in CI on 2026-08-20: the freshly built `dist/fullshot-firefox.zip` carries
`fullshot@nikatru.com` and passes. Stale versus fresh is exactly the distinction the gate draws.

## ⚠️ Still open, and not closed by this

`Extension/Full_Screen_Shot/.gitignore` ignores `*.zip` while the **root** `.gitignore` says a
recursive glob over `publish/` zips is *"deliberately NOT ignored"* because *"each release zip is a
golden master"*. The nested file wins, which is why these six sat where no gate could see them.
Tracking megabytes of binaries is a decision rather than a fix, so it is recorded rather than changed.
