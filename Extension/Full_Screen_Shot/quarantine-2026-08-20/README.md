# Quarantine — six Firefox packages that must never reach AMO

**Moved here 2026-08-20 out of `publish/`. Nothing has been deleted.**

## What these are

Six built Firefox store packages whose `browser_specific_settings.gecko.id` is
the placeholder `fullshot@REPLACE-WITH-YOUR-DOMAIN.example`. Every one of them
predates 2026-08-18, the day `publish/manifest.firefox.json` was converted to an
RFC 7386 merge patch and its id set to `fullshot@nikatru.com` from
`publish/identity.json`.

Measured 2026-08-20 by inflating `manifest.json` out of each archive:

| file | version | bytes | `gecko.id` | sha256 |
|---|---|---:|---|---|
| `fullshot-1.9.7-firefox.zip`   | 1.9.7  | 105 439 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `f357fc634bd0c095a118e31193bdaaa211d15a493fac6f4f80916b1854a52994` |
| `fullshot-1.9.11-firefox.zip`  | 1.9.11 | 106 619 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `1c682500d1a565ab65efcc1c61a42a25466b33af4ade94c7226b454fc553d7f4` |
| `fullshot-1.9.13-firefox.zip`  | 1.9.13 | 137 063 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `4883d5423ef089f8dca24afa1ef9f151e4ea7d7cb38710df95cd6169c99c9f86` |
| `fullshot-1.10.0-firefox.zip`  | 1.10.0 | 595 715 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `37c73e3b5b382839335097b40ddcb9790f045628170d2b21ac76aec7c4a6c086` |
| `fullshot-1.10.1-firefox.zip`  | 1.10.1 | 940 175 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `6ee44ed30a3e329f9f1414bc991deedab8ef73e7d1e56889b080389bc1a3efa4` |
| `fullshot-1.10.2-firefox.zip`  | 1.10.2 | 940 164 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `a20093b9e32f1cf66962dfe5e11fff9974e12389eeaac4ef304d47e37df5d8cd` |

The six **chromium** zips left in `publish/` carry no `browser_specific_settings`
at all, which is correct for Chrome and Edge. They are stale by version but not
dangerous, so they were not moved.

## 🔴 Why this is worse than an ordinary stale artifact

The placeholder **passes AMO validation**. It is a syntactically valid
email-style id on a domain nobody owns, so an upload does not bounce — it
succeeds, and binds the add-on to that identity. Mozilla's addons-server
documentation states that a guid *"cannot be restored and will forever be
unusable for submission"*.

So the failure mode is not a rejected upload somebody retries. It is an accepted
upload discovered afterwards, with no way back — a new listing, and every
install, review and rating starting from zero.

`publish/verify-firefox-package.node.js` defaults its `--zip` argument to
`publish/fullshot-<version>-firefox.zip`. While these files sat in `publish/`,
running that script with no arguments graded one of them. That is now impossible
because they are not there.

## Why they were moved and not deleted

They are **untracked** — `Extension/Full_Screen_Shot/.gitignore` ignores `*.zip`
— and this repository has **zero tags**, so there is no commit to rebuild them
from. Deleting them destroys the only copy of six historical builds, which is
irreversible in a way that moving them is not.

The digests above are recorded so that deleting them later loses nothing that
mattered: any copy that turns up elsewhere can be identified against this table.

## What replaced the hazard

`scripts/check-store-packages.mjs` (added 2026-08-20) opens every built store
package it can find and refuses a `gecko.id` that is the placeholder or that
disagrees with `publish/identity.json`. It runs in `ci.yml` twice — in `gates`,
where a clean checkout has no packages and it says so out loud, and in
`package`, where it grades the zip that job just built, which is the one place in
CI where the subject really exists.

A freshly built package was verified on 2026-08-20 to carry
`fullshot@nikatru.com` and to pass that gate.

## ⚠️ Open for the owner

**Delete this directory, or keep it?** Deletion is irreversible for the reason
above, so it was not done unilaterally. Nothing reads these files, and no
process needs them.
