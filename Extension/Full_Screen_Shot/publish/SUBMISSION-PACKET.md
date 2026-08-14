# SUBMISSION-PACKET.md — every field the three stores ask for, in one place

One document, three stores. Every field either has an answer written out ready
to paste, or is marked **OWNER** because no agent can supply it.

Nothing here is a substitute for `STORE-LISTING.md` (the long-form marketing
copy), `PRIVACY-POLICY-HOSTING.md` (getting the policy live and answering the
data questions), `CROSS-BROWSER-PUBLISHING.md` (the per-store runbook), or
`COMPLIANCE-CHECKLIST.md` (the code-vs-policy audit). This is the **field list**
those four feed into, so nothing is discovered missing at 11pm in a dashboard.

**Legend**
- **✍️ DRAFTED** — text below is final; copy it verbatim.
- **⚙️ DERIVED** — comes from the package or another file; do not retype it.
- **🔴 OWNER** — only you can supply this. Six of them, listed first.
- **🚧 BLOCKER** — submission cannot proceed until resolved.

Package under discussion: **v1.10.1**, built and verified.
`publish/fullshot-1.10.1.zip` (Chrome + Edge) · `publish/fullshot-1.10.1-firefox.zip` (AMO).
85 entries each: 30 shipping files + 55 locales. No test, Reference, `.md`, or
`node_modules` entries in either.

---

## 0. The 🔴 OWNER list — start here, everything else waits on these

| # | Item | Where it lands | Notes |
|---|---|---|---|
| O1 | **Legal name** (person or company) | Chrome trader details · Edge publisher · AMO account · `LICENSE` Required Notice · `PRIVACY-POLICY.html` §1 and footer | Must be **identical in all five**. This is the single most-repeated OWNER value in the project; decide it once and write it down. |
| O2 | **Trader address + phone + email** for the EU DSA | Chrome dashboard → **Account → Trader status** | If you declare **Trader**, Google **publishes your legal name, physical address, email and phone to EEA users on the listing**. That is the law's intent, not an oversight. A home address becomes public — if that is not acceptable, the usual answers are a registered business address, a company formation with a registered office, or a virtual-office/agent address you are entitled to use. Google verifies the details; **budget days, not minutes**, and do it before you need to publish. Non-trader status is only correct if the extension is genuinely outside any trade, business or profession — that is a call for you, not an agent. |
| O3 | **A domain you control** → the Firefox `gecko.id` | `publish/manifest.firefox.json` | 🚧 **BLOCKER for AMO.** Currently `fullshot@REPLACE-WITH-YOUR-DOMAIN.example`. Format `^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$`, ≤80 chars. **Permanent once AMO signs it** — changing it later publishes a *different* add-on, not an update. `node publish/verify-firefox-package.node.js` refuses to pass while the placeholder stands, by design. **This is the same domain decision as hosting the privacy policy** (`PRIVACY-POLICY-HOSTING.md` §3d) — one purchase settles both. |
| O4 | **Store developer accounts** | ×3 | Chrome: Google account + **US$5 one-time** registration. Edge: Microsoft account, Partner Center, free. Firefox: Firefox account, free. Register all three before you need them; each has its own verification step. |
| O5 | **Screenshots and promo tiles** | All three listings | 🚧 **BLOCKER — no store accepts a listing without at least one screenshot.** Specs in §5. `Reference/*.png` are development comparison shots at the wrong dimensions; they are a starting point, not assets. |
| O6 | **Support email** (and optional homepage/support URL) | All three listings + `PRIVACY-POLICY.html` | Becomes public. A role address (`support@…`) ages better than a personal one. Chrome additionally requires a **verified** contact email at account level. |

Two more that are owner-gated but are work rather than facts:

| | | |
|---|---|---|
| O7 | **On-device QA pass** | 🚧 Batch capture, Beautify, Scroll→Clip, and the `test/redact-e2e.html` fixture are implemented and pass the sandbox sims but have not been exercised by hand in a real browser. Every store penalises description-vs-behaviour mismatch, and your screenshots have to show something true. Do this before you write the listing copy, not after. |
| O8 | **Rebuild the Firefox zip after setting the gecko id** | The zip in `publish/` was built with the placeholder id inside it. Setting O3 changes `manifest.firefox.json`, so the package must be rebuilt (`node publish/package.node.js`) and re-verified before upload. |

---

## 1. Facts that are the same in all three stores

| Field | Value | |
|---|---|---|
| Product name | `FullShot - Full Page Screen Capture` | ⚙️ matches `_locales/en/messages.json` → `appName`. 35 chars. |
| Short name | `FullShot` | ⚙️ `appShortName`. |
| Version | `1.10.1` | ⚙️ `manifest.json` **and** `publish/manifest.firefox.json` — the gate fails on drift. |
| Price | Free | ✍️ |
| In-app purchases | None | ✍️ |
| Ads | None | ✍️ |
| Analytics / telemetry | None | ✍️ Audited: no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, or `EventSource` anywhere in shipped code. |
| Remote code | None | ✍️ Every `importScripts` / `<script src>` is a local relative path. No `eval`, no `new Function`, no CDN, no WASM. |
| Mature / sensitive content | No | ✍️ |
| Account required | No | ✍️ |
| Works offline | Yes | ✍️ |
| Languages | 55 | ⚙️ `_locales/`. `default_locale: "en"`. |
| Privacy policy URL | 🔴 OWNER — same URL in all three | See `PRIVACY-POLICY-HOSTING.md`. |
| Category | **Productivity** (alternate: Tools) | ✍️ |

**Long-form copy** — product name, 128-char summary, and the full detailed
description are already paste-ready in `STORE-LISTING.md`. Do not rewrite them
per store; divergent claims across three public listings is a finding waiting to
happen.

---

## 2. Chrome Web Store — field by field

### 2a. Account level (once, not per item)

| Field | Answer |
|---|---|
| Developer account | 🔴 O4 — Google account, US$5 one-time |
| Publisher display name ("Offered by") | 🔴 O1 |
| Contact email | 🔴 O6 — **must be verified**; unverified blocks publishing |
| Physical address | 🔴 O2 |
| **Trader status** | 🔴 O2 — Trader or Non-trader. If Trader: legal name, address, phone, email, **published to EEA users**. Verification takes time. |

### 2b. Store listing tab

| Field | Limit | Answer |
|---|---|---|
| Product name | 75 | ✍️ `FullShot - Full Page Screen Capture` (35) |
| Summary / short description | 132 | ✍️ `STORE-LISTING.md` § Summary — 128 chars, verified under the limit |
| Detailed description | 16,000 | ✍️ `STORE-LISTING.md` § Detailed description — plain text, no Markdown |
| Category | one | ✍️ Productivity |
| Language | one | ✍️ English (the item ships 55 locales; this field is the listing language) |
| Store icon | 128×128 PNG | ⚙️ `icons/icon128.png` — 🔴 confirm it is final art |
| Screenshots | 1–5 | 🔴 O5 — see §5 |
| Small promo tile | 440×280 | 🔴 O5 — optional to publish, required to be considered for featuring |
| Marquee promo tile | 1400×560 | 🔴 O5 — optional |
| YouTube video | — | Optional; skip |
| Official / homepage URL | — | 🔴 O6, optional |
| Support URL | — | 🔴 O6, optional |
| Mature content | — | ✍️ No |
| Google Analytics ID | — | ✍️ Leave empty — the item ships no analytics and adding a listing-analytics ID would contradict the privacy copy |

### 2c. Privacy practices tab

Every answer here is worked out in `PRIVACY-POLICY-HOSTING.md` §4, including
*why* "no data collected" is the wrong answer for a screenshot tool.

| Field | Answer |
|---|---|
| Single purpose | ✍️ `STORE-LISTING.md` § Single-purpose description |
| Justification: `activeTab` | ✍️ `STORE-LISTING.md` |
| Justification: `scripting` | ✍️ `STORE-LISTING.md` |
| Justification: `downloads` | ✍️ `STORE-LISTING.md` |
| Justification: `storage` | ✍️ `STORE-LISTING.md` |
| Justification: `unlimitedStorage` | ✍️ `STORE-LISTING.md` |
| Justification: host permission `<all_urls>` | ✍️ `STORE-LISTING.md` — stress that it is **optional** and requested at runtime |
| Are you using remote code? | ✍️ **No, I am not using remote code** |
| Data usage → Website content | ✍️ **YES** |
| Data usage → the other eight categories | ✍️ **NO** (each reasoned in `PRIVACY-POLICY-HOSTING.md` §4c) |
| Limited Use certifications ×3 | ✍️ Tick all three — FullShot qualifies for each |
| Privacy policy URL | 🔴 O6 / hosting |

### 2d. Distribution tab

| Field | Answer |
|---|---|
| Visibility | ✍️ Public (consider **Unlisted** for a first submission — you get a real review and a real install without a public launch) |
| Distribution regions | ✍️ All regions — **but EEA distribution depends on the trader declaration (O2)** |
| Pricing | ✍️ Free |

### 2e. Reviewer notes — ✍️ DRAFTED, paste as-is

```
FullShot is a screenshot utility that runs entirely on-device. There are no
accounts, no servers, and no test credentials to provide.

To exercise the item: open any web page, click the FullShot toolbar icon, and
choose Full page / Visible / Region / Element. The capture opens in the
extension's own result page, where it can be annotated, redacted, beautified,
and exported as PNG / JPEG / WebP / PDF.

Notes for review:
- No remotely hosted code. Every script is a local relative path inside the
  package; there is no eval, no new Function, no CDN, and no WASM.
- No network activity of any kind. The package contains no fetch,
  XMLHttpRequest, WebSocket, sendBeacon, or EventSource call.
- Broad host access is declared as an OPTIONAL host permission and is never
  requested at install. It is requested at runtime, from a user gesture, only
  when the user enables cross-origin frame expansion (Options) or Batch URL
  capture. Declining leaves all other functionality working.
- "Website content" is disclosed under Data usage because a screenshot is
  website content under User Data FAQ Q2, and Q3 requires disclosure even for
  purely local handling. Nothing is transmitted.
- The optional PII redaction feature scans page text locally and paints opaque
  blocks over matches. Detected values are never stored, indexed, or sent.
- Code is unminified and readable as shipped.
```

---

## 3. Microsoft Edge Add-ons (Partner Center) — field by field

Edge runs the **identical Chromium package**. No manifest change, no code change.

| Field | Answer |
|---|---|
| Developer account | 🔴 O4 — Microsoft account, Partner Center, **free** |
| Publisher display name | 🔴 O1 |
| Package | ⚙️ `publish/fullshot-1.10.1.zip` — the same file Chrome gets |
| Display name | ✍️ `FullShot - Full Page Screen Capture` |
| Short description | ✍️ `STORE-LISTING.md` § Summary |
| Description | ✍️ `STORE-LISTING.md` § Detailed description |
| Category | ✍️ Productivity |
| Search terms / keywords | ✍️ `screenshot`, `full page screenshot`, `screen capture`, `webpage capture`, `annotate`, `redact PII`, `screenshot to PDF` — factual, no competitor names, no stuffing |
| Store logo | 300×300 | 🔴 O5 (Edge asks for a larger logo than Chrome's 128) |
| Screenshots | 1–10, 1280×800 or 640×400 | 🔴 O5 |
| Small promo tile | 440×280 | 🔴 O5, optional |
| YouTube URL | Optional; skip |
| Website | 🔴 O6, optional |
| Support contact details | 🔴 O6 |
| **Privacy policy URL** | 🔴 — same URL as Chrome. Required. |
| Does this extension collect user data? | ✍️ **Yes — website content, handled locally, never transmitted.** Keep this consistent with the Chrome answer; both listings are public and comparable. |
| Markets / availability | ✍️ All markets |
| Visibility | ✍️ Public (or hidden-from-search for a soft launch) |
| Publisher / trader identity | 🔴 O2 — Partner Center verifies publisher identity at account level and collects the EU-facing details there. Same legal name and address as Chrome. Confirm the current form at submission. |
| Certification notes | ✍️ Reuse the Chrome reviewer notes in §2e verbatim |

---

## 4. Firefox AMO — field by field

Different manifest, different package, and Mozilla asks the data question **in
the manifest** rather than a dashboard.

### 4a. Blockers before upload

| | |
|---|---|
| 🚧 O3 | Real `gecko.id` on a domain you control. Permanent once signed. |
| 🚧 | `node publish/verify-firefox-package.node.js` must exit **green**. It is red today on purpose and names each blocker. |
| ⚠️ BUILD | Source `background.js` still calls `importScripts` unguarded. `publish/package.node.js` applies the guard when it writes the Firefox zip and refuses to write an unguarded one — so **build with the packager, never by hand-zipping the source folder**. |

### 4b. Listing fields

| Field | Answer |
|---|---|
| Developer account | 🔴 O4 — Firefox account, free |
| Distribution | ✍️ *On this site* (listed on AMO). Self-hosted signing is the alternative if you would rather distribute the `.xpi` yourself. |
| Package | ⚙️ `publish/fullshot-<ver>-firefox.zip`, rebuilt after O3 |
| Add-on name | ⚙️ from the manifest |
| Add-on URL slug | ✍️ `fullshot` if free, otherwise `fullshot-screen-capture` |
| Summary | 250 char max | ✍️ `STORE-LISTING.md` § Summary (128 chars) fits comfortably |
| Description | ✍️ `STORE-LISTING.md` § Detailed description |
| Categories | ✍️ *Photos, Music & Videos* and/or *Other* — AMO's category list has no direct "Productivity" equivalent for this shape of tool; pick at submission from what is offered |
| Tags | ✍️ `screenshot`, `capture`, `full page`, `annotate`, `privacy` |
| **License of your source code** | ✍️ **Custom License** → paste the contents of `LICENSE`, or link to it. **PolyForm Shield 1.0.0 is not in AMO's dropdown** (which lists MPL, GPL, MIT, BSD, Creative Commons, All Rights Reserved). Do **not** settle for a near-miss from the list to save a click — picking MIT here would publicly license the code under terms you did not choose. This field is why `LICENSE` had to exist before submission, not after. |
| Privacy Policy | 🔴 O6 / hosting — paste the URL. Since Aug 2025 Mozilla accepts a link to a self-hosted policy; older guidance required the full text pasted here. If the form insists on text, paste the rendered prose of `PRIVACY-POLICY.html`. Confirm which you get. |
| Data collection declaration | ⚙️ **Already in the manifest** — `data_collection_permissions.required: ["none"]`. Accurate because Mozilla's question is about data going *outside the add-on or the local browser*. Keep any dashboard answer consistent with it. |
| Support email / support site | 🔴 O6 |
| Icon | ⚙️ from the manifest |
| Screenshots | up to 10 | 🔴 O5 |
| Experimental? | ✍️ No |
| Requires payment / contributions? | ✍️ No |
| Notes for reviewers | ✍️ Chrome notes from §2e, **plus** the Firefox-specific paragraph below |

### 4c. Firefox-specific reviewer note — ✍️ DRAFTED, append to the §2e text

```
Firefox-specific notes:

- The manifest declares BOTH background.service_worker and background.scripts.
  This is deliberate and follows MDN's cross-browser recipe: Firefox runs the
  scripts array, and the addons-linter raises
  BACKGROUND_SERVICE_WORKER_NOFALLBACK (an error) for a service_worker with no
  scripts beside it. The BACKGROUND_SERVICE_WORKER_IGNORED warning is expected.

- background.js guards its importScripts calls behind a typeof check, because
  importScripts exists only in a service worker. In Firefox, pages/db.js and
  pages/batch.js load via background.scripts instead. One codebase, both
  browsers.

- data_collection_permissions is declared as {"required": ["none"]}. FullShot
  makes zero network calls; every byte it touches stays in the add-on's own
  storage on the user's machine. If the linter notes that this key postdates
  strict_min_version 128.0, that is expected — AMO enforces the key regardless
  of minimum version, and removing it would make the add-on unsubmittable.

- chrome.permissions.request is called only from user gestures (the Options
  toggle, the popup capture click, and Batch "start"), as Firefox requires.

- The code ships unminified and unobfuscated; no build step or source archive
  is needed for review.
```

### 4d. Test with `web-ext` before submitting

```bash
node publish/verify-firefox-package.node.js   # in-repo gate first — free and instant
npm i -g web-ext
web-ext lint     # static AMO checks
web-ext run      # launches Firefox with the add-on loaded — this is the O7 QA pass
web-ext build    # produces the submittable .zip
```

---

## 5. Visual assets — the exact specs (🔴 O5)

| Asset | Chrome | Edge | AMO |
|---|---|---|---|
| Screenshots | 1–5 · **1280×800** or 640×400 · PNG or JPEG · **24-bit, no alpha channel** · full-bleed, no padding | 1–10 · 1280×800 or 640×400 | up to 10 · PNG/JPEG |
| Store icon | 128×128 PNG (⚙️ already packaged) | **300×300** PNG | from the manifest |
| Small promo tile | 440×280 PNG/JPEG | 440×280 | — |
| Marquee tile | 1400×560 (optional) | — | — |

Practical notes:

- **A transparent PNG is the most common rejection** on the Chrome screenshot
  upload. Flatten onto an opaque background.
- Shoot the screenshots **after** the O7 QA pass, from the real product. A shot
  of a feature that misbehaves on device is a description-vs-behaviour finding
  with a picture attached.
- The obvious five: (1) the popup with the four capture modes, (2) a long page
  captured seam-free, (3) the editor with annotations, (4) redaction with visible
  opaque blocks, (5) Beautify output. Each carrying one short caption.
- Do not put a competitor's name or logo in a screenshot.
- **Screenshot your own screenshots carefully.** These images will be public
  forever. Use a throwaway profile and a page with no real data in it — a
  privacy tool whose store listing leaks the developer's inbox is a bad first
  impression and an avoidable one.

---

## 6. Open items that are not OWNER decisions

| # | Item | Status |
|---|---|---|
| N1 | Manifest description is **137 chars**, over the 132 the store displays | Cosmetic, not a submission blocker. **No longer a one-line manifest edit** — since the i18n phase the string lives at `_locales/en/messages.json` → `appDescription`, and changing it means changing it in 55 locales. `_locales/make-locales.mjs` has a guard that refuses to replace real translations with English fallback, with `--adopt` as the remedy. Read that file before touching `_locales`. Fold into a version bump, not into submission week. |
| N2 | `shipprobe-DELETE-ME.txt` (0 bytes) at the repo root | Not in either zip (the packager uses an allowlist). Delete it — `GIT-SETUP.md` step 0c. |
| N3 | `verify-firefox-package.node.js` red | By design, and correctly red: one OWNER blocker (O3) and one BUILD note. Not one of the eleven test tiers; do not add it to the all-green set. |

---

## 7. Order of operations

1. 🔴 Settle **O1** (legal name) and **O3** (domain). They unblock the most.
2. Register the three developer accounts (**O4**). Start Chrome's **trader
   verification (O2)** immediately — it is the longest pole and it is a hard gate
   on EEA distribution.
3. Fill the placeholders in `PRIVACY-POLICY.html`, host it, note the URL
   (`PRIVACY-POLICY-HOSTING.md`).
4. Fill the LICENSE Required Notice with O1.
5. Do the **on-device QA pass (O7)** — batch, Beautify, Clip, redaction fixture.
6. Take the **screenshots (O5)** from the QA'd build.
7. Set `gecko.id` from O3, rebuild both packages
   (`node publish/package.node.js`), and get
   `node publish/verify-firefox-package.node.js` **green** (**O8**).
8. Submit **Chrome** first — it has the strictest data disclosure, so anything
   it questions is worth knowing before the other two.
9. Submit **Edge** with the same package and the same answers.
10. `web-ext lint` / `run` / `build`, then submit **AMO**.
11. Tag the release in git (`GIT-SETUP.md` step 12) so the submitted tree is
    permanently identifiable.
