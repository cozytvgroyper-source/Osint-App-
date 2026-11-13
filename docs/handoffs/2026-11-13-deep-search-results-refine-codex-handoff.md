# Handoff: Deep Search person-results refine (for Codex)

Date: 2026-11-13 · Repo: `cozytvgroyper-source/Osint-App-` · Branch: **`deep-search/results-refine`** (from `main` at `b089847`), head `a68ccef` plus this handoff commit.

## 1. Your job, in one paragraph

Finish the person-results refine for Deep Search. **Tasks 1–3 of 5 are built and committed.** Task 3 has one fix round committed that is **awaiting a scoped re-check**. Tasks 4 (the results page) and 5 (verification) are not started.

- **Design (approved, binding):** [docs/superpowers/specs/2026-11-13-deep-search-results-refine-design.md](../superpowers/specs/2026-11-13-deep-search-results-refine-design.md)
- **Plan:** [docs/superpowers/plans/2026-11-13-deep-search-results-refine.md](../superpowers/plans/2026-11-13-deep-search-results-refine.md)

Read this handoff, then the design, then the plan's Task 4 and Task 5.

## 2. Why this work exists

The owner ran a real **username** Deep Search and found:
1. **No result link opened a working page.** Omega tools return a JSON envelope whose inner text has escaped line breaks. The adapters didn't unwrap it, so every link ended in a literal `\n`. Some links were also API/data addresses (`…/about.json`).
2. **False "linked" accounts.** That run showed 78 linked accounts, almost none proven.
   - `omega_socmint` answers with a status table (`200` found, `❌ 404` not found, `403`/`429`/`401` couldn't check), and every row became a "linked" account, including the 404s.
   - The searched username was echoed into each account's evidence, and the linking step treated that echo as proof.
3. **Connected details were thrown away.** Maigret's per-site profile `data` (fullname, links, location) was never read.

The owner wants to **see everything connected to the person** (names, other usernames, emails, IPs, websites), with **links that open**, and **no unproven links**.

## 3. Owner decisions (all in the design §5; do not reopen)

- **Unconfirmed same-username accounts stay folded,** as before.
- **Connected details come only from confirmed sources.** Details from unconfirmed accounts show under that account inside the folded section.
- **An account is confirmed only by:**
  - **a.** it is registered with a searched email (Holehe; GHunt once signed in)
  - **b.** its profile details show something already confirmed, or a confirmed profile links to it
  - **c.** two or more found accounts on different sites share the same extra detail (name, website or email)
- **The searched username alone never confirms anything.**
- **Confirmation level:** every confirmed account shows how many rules back it.
  - 3 rules = **Level 1** (highest), 2 = **Level 2**, 1 = **Level 3**.
  - Badge text: `Level N · backed by K of 3 rules`.
  - Within each group, Level 1 accounts are listed first.
- **Phone layout and website/IP results are out of scope.**
- The level picker is correctly hidden for email/username searches. That was a decision in the original redesign, not a bug.

## 4. State of the branch

```
a68ccef fix(deep): keep searched leads as real details and never confirm through shared platform hosts   ← Task 3 fix round 1 (awaiting re-check)
df30041 fix(deep): confirm accounts only by rules a, b and c, with a level                                 ← Task 3
571d2d2 fix(deep): read socmint and identity tables, clean links, keep profile details                     ← Task 2 (reviewed, clean)
9de2c87 fix(deep): www and path inputs are websites, not usernames                                        ← Task 1 (reviewed, clean)
b8eb0d2 docs: plan …   1de2941 docs: design …
```

- `npm test` at `a68ccef`: **525 passed, 0 failed** (implementer's report; re-run it).
- **Not pushed.** If you can't see the branch, ask the owner to push it.
- **Task 3's re-check is done.** The original task review found two Critical issues, and fix round 1 (`a68ccef`) was re-reviewed:
  1. **Shared hosts: ADDRESSED.** Rule b no longer confirms strangers through big shared hosts.
  2. **Following a lead erased confirmations: STILL OPEN for leads that come from linked non-account findings.**
     - It is fixed for leads that come from accounts.
     - **Where:** `public/deep-linking.js`, `addNonAccountRoots`, lines ~319–324 (emails, usernames, the host value, and the finding's lead). These still drop **every searched identifier** instead of **only the seed**.
     - **Effect:** a linked fact carries `alt@owner-site.example`, and an account showing that email gets `b` in round 1. Once the lead has been searched, that account falls back to `possible`. Domain leads are fine.
     - **Fix:** in `addNonAccountRoots`, replace the searched-keys filter with a seed-only check. This is safe, because a non-account source can't confirm itself.
     - **Add a two-round test** (same input, with and without the lead in `searched`) where the lead comes from a **linked fact**. The existing two-round tests only use account-sourced leads.
     - The reviewer's reproduction probe: `probe2.mjs` cases P4 (email lead) and P6 (username lead from fact evidence).
  3. **Multi-round tests: ADDRESSED.**

  **Do this fix first, test-first, as Task 3 fix round 2.** Then continue to Task 4.
- **New minor finding** (from the re-check, deferred): `accountHosts` marks every account's own host as a platform. If a tool reports an account on the owner's personal domain, that domain stops host-matching. This errs on the safe side.

## 5. Rulings made on the owner's behalf (keep them)

1. **All `?v=` cache-busting bumps happen in Task 4 only.** The server sends `no-store`, so there's no stale-module risk between tasks. Task 4 must bump:
   - in `app.js`: `deep-search.js?v=4→5`, `deep-adapters.js?v=1→2`, `deep-linking.js?v=1→2`, `deep-results-view.js?v=1→2`
   - in `index.html`: `app.js?v=60→61`
   - and update any test pinning these.
2. **Image-looking values never count** as website details, in adapters and again in linking.
3. **Socmint `✅ Found` rows with no status code** count as found. The Reddit mapping also accepts a cut-off `about.js`.
4. **Maigret `evidence` still contains the searched username.** Linking uses `account.details` only, never `evidence`.
5. **The seed is never a detail.** A searched **lead** counts as an echo only on accounts whose own `subject` is that lead. Leads are **not** standalone rule-b roots, because that let an account confirm itself. Instead, a lead stays in its source account's details, so it stays confirmed through that account. Verified: statuses are identical with and without the lead in `searched`.
6. **Rule b is evaluated as if the account itself weren't there**, so it can never back itself up.
7. **Host-only matching** is allowed only against bare website values (no path) from confirmed accounts' details.
   - It never matches a host that is any account's own platform, or a known shared platform. The list is hand-picked in `deep-linking.js`.
   - Non-account evidence contributes full URLs, never bare hosts.
8. **The `owner.name` input** stays a domain (`.name` is a real TLD), and the test locks that.

## 6. What's left

### Task 4: Person results page (plan Task 4; not started)

Files:
- `public/deep-results-view.js` (person view only)
- `public/ui.css`
- `public/app.js` and `public/index.html` (version bumps above)
- `tests/fixtures/deep/run-person.json`
- tests: `tests/deep-results-view.test.mjs`, `tests/deep-page.test.mjs`

Must also handle:
- **`account.url === ''` with `rawUrl` set:** show the site name plus `No page address`, with no `<a>` and no Pivot on an empty value.
- **Older stored runs** without `presence`/`details` must render (treat them as found / empty).
- **"How we found this":** account trails now start at the account's own subject. Make sure a round-2 account's card still reads sensibly.

Exact copy is in the plan's Global Constraints.

### Task 5: Verify (plan Task 5)

- `npm test` with 0 failures.
- **Browser check** on a throwaway server:

  ```bash
  PORT=4199 PUBLIC_DESK_TOKEN=<random> node server.mjs
  ```

  Open `http://127.0.0.1:4199/#access=<token>` with stand-in data only.
- **Keyboard pass.**
- **axe-core 4.10.2:** git-excluded as `public/__axe-test.js`. Ask the owner before downloading it. Rule sets `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, `best-practice`; light and dark at 1280 px; wait at least 600 ms after switching theme. Expect 0 violations.
- **The owner's real run, only with their explicit OK.** It lives at `/Users/randybill/Documents/Codex/2026-11-10/public-desk/work/deep-search-runs/226f79d7-7252-40bc-95c4-d1f026f1c207.json`.
  - Copy it into the throwaway app's git-ignored `work/deep-search-runs/`.
  - Re-open it, and check that links open profile pages, that 404 rows are folded, and that confirmed accounts show levels and reasons.
  - Delete the copy afterwards.
  - **Report counts only, never identifiers.**
- **Whole-branch review** on the most capable model. Fix Critical/Important issues test-first.
- **Stop and ask the owner before pushing or opening a PR.**

## 7. Deferred minor findings (for the final review to triage)

- **T1:**
  - No regression assertion that email or IP/path inputs aren't captured by the new website branch.
  - Pre-existing: `node.js`-style usernames classify as domains.
- **T2:**
  - The `✅ Found` branch and Reddit `about.js` mapping are untested.
  - `tableEvidence` has an unused `subject` parameter.
  - Table rows copy whole-answer emails into evidence (record only).
  - No test feeds an image-extension value under a non-image key.
- **T3:**
  - A circular path through non-accounts could let an account back itself via a fact it caused (debatable).
  - The outer fixed point stops silently at 10 passes.
  - `confirmedWithout` recomputes per account (~280 ms worst case per call).
  - Rule c's count is of merged accounts; URL-less accounts each count as their own host.
  - The shared-platform host list is hand-picked.

## 8. Working rules (unchanged from earlier handoffs)

- **Plain language** to the owner; they aren't a developer.
- **Test first** for every change and fix.
- **Commits:** stage explicit paths only (never `git add -A`). One commit per task, using the plan's commit messages. Use your own `Co-Authored-By` line.
- **Never commit** `work/`, `public/__*`, `.superpowers/` or `tests/fixtures/deep/raw/`.
- **Fixtures** use stand-ins only: `ownername`, `owner@example.com`, `Owner Example`, `owner-site.example`, `Example City`.
- **Never print or commit** the owner's identifiers or tokens.
- **CSP** is `script-src 'self'; style-src 'self'`.
- **Views** are DOM-free and return escaped HTML.
- **Heading order** is h1 → h2 → h3.
- **Pivot** accessible names start with `Pivot:`.
- **Main Search** (`search-query.js`, `search-planner.js`) and website results stay unchanged.
- **Never push, open a PR or merge without the owner's say-so.**

## 9. Other open items (not this branch)

- **GHunt:** the owner will run `ghunt login` (a throwaway Google account is recommended).
- **Live GreyNoise check:** a Deep Search of `8.8.8.8` once the tool servers are running.
- **Website results** ("Things to fix") are parked until the owner has a site to test.
