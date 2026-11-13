# Deep Search Person Results Refine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Person results whose links open real pages, whose accounts are confirmed only by rules a/b/c (with a level 1–3), and whose Connected details list everything found from confirmed sources.

**Architecture:**
- **Adapters** (`public/deep-adapters.js`) read answers correctly: unwrap envelopes, clean URLs, map data addresses to profile pages, and give each account `presence` and `details`.
- **Linking** (`public/deep-linking.js`) merges each profile across tools, then applies rules a/b/c to accounts, recording `confirmedBy` and a `level`. Non-account findings keep today's path.
- **The person view** (`public/deep-results-view.js`) shows Connected details, Confirmed accounts with level badges, and two folded sections.
- **A small fix** in `public/deep-search.js` detects `www.` and path inputs as websites.

**Tech Stack:** browser ES modules, `node --test`, no dependencies.

**Spec:** [docs/superpowers/specs/2026-11-13-deep-search-results-refine-design.md](../specs/2026-11-13-deep-search-results-refine-design.md)

## Global Constraints

- **Branch and commits:** branch `deep-search/results-refine` (from `main` at `b089847`). Stage explicit paths. One commit per task, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Test data:** fixtures and tests use stand-ins only: `ownername`, `owner@example.com`, `Owner Example`, `owner-site.example`, `Example City`. Never read or commit the owner's own run data in tests.
- **Views:** stay DOM-free, return escaped HTML, and keep heading order h1 → h2 → h3. Pivot accessible names start `Pivot:`. CSP: no inline styles or scripts.
- **Versions:**
  - in `app.js`: `deep-search.js?v=4` → `5`, `deep-adapters.js?v=1` → `2`, `deep-linking.js?v=1` → `2`, `deep-results-view.js?v=1` → `2`
  - in `index.html`: `app.js?v=60` → `61`
  - bump `ui.css?v=` only if it changes
  - update any test pinning those versions in the same commit
- **Copy (exact):**
  - Section headings: `Connected details`, `Confirmed accounts (N)`, `Same username, not confirmed (N)` (folded `<summary>`), `Not found or couldn't check (N)` (folded `<summary>`).
  - Level badge: `Level 1 · backed by 3 of 3 rules`, `Level 2 · backed by 2 of 3 rules`, `Level 3 · backed by 1 of 3 rules`.
  - Rule reasons:
    - a: `Registered with <email>.`
    - b: `Profile links to <detail>, which is confirmed.`, or the reverse direction: `A confirmed profile links to this account.`
    - c: `<N> profiles with this username share the name "<name>".` / `… share the website <site>.` / `… share the email <email>.`
  - Dropped reasons: `Not found.`, `Couldn't check (<status>).`
  - Connected details empty state: `No details were confirmed. Accounts that only share the username are listed below.`
  - No-URL account: the site name as text plus `No page address`.
- **Main Search and website results are unchanged.**

## Review Focus

1. **Two strangers sharing a common username and a common display name (e.g. "Alex") on two sites.** Rule c confirms both, as the owner accepted. Expect level 3 and a reason naming the shared name, so the owner can judge. Test: Task 3.
2. **Avatar or image URLs on a shared host** (gravatar, CDN) in two accounts' data. These must never count as a shared website for rule c, or as a detail for rule b. Test: Task 2 (excluded from `details`) and Task 3.
3. **The same profile reported by socmint as `❌ 404` and by Maigret as found.** It shows as found with a presence note, never dropped. Test: Task 3.
4. **A Twitter account reported as `twitter.com/x` by one tool and `x.com/x` by another.** It is one account and can't corroborate itself. Test: Task 3.
5. **A stored older run re-opened** (raw answers re-adapted through the new adapters, `presence` absent on old stored findings). It must render without crashing and use the new statuses. Test: Task 4.

---

### Task 1: Detect `www.` and path inputs as websites

**Files:** Modify `public/deep-search.js` (`detectDeepTarget`); Test `tests/deep-search.test.mjs`.

**Interfaces:** Produces: `detectDeepTarget('www.example.com')` → `{type:'domain',value:'example.com'}`; `detectDeepTarget('example.com/path')` → `{type:'domain',value:'example.com'}`.

- [ ] **Step 1: Write the failing test** `website input with www or a path is a website, never a username`:
  - `www.example.com`, `WWW.Example.com`, `example.com/path`, `www.example.com/a/b?x=1` → `{type:'domain',value:'example.com'}`
  - `ownername` → username
  - `owner.name` with no TLD-like ending stays as today (assert the current result, captured before the change, so nothing regresses)
- [ ] **Step 2: Run** `node --test tests/deep-search.test.mjs`. Expected: FAIL (`www.example.com` → username).
- [ ] **Step 3: Implement** in `detectDeepTarget`, before the username fallback: if the text (after trimming) matches `^(?:www\.)?<host>(?:/\S*)?$` and `extractTarget(host)` is a domain, return it normalised. Reuse `normalizeIdentifier`, which already strips `www.`.
- [ ] **Step 4: Run** `node --test tests/deep-search.test.mjs tests/deep-page.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `public/deep-search.js tests/deep-search.test.mjs` — `fix(deep): www and path inputs are websites, not usernames`.

### Task 2: Read answers correctly (adapters)

**Files:** Modify `public/deep-adapters.js`; Test `tests/deep-adapters.test.mjs`.

**Interfaces** (all exported for tests):
- `cleanUrl(value: string): string`: strips trailing literal `\n` `\r` `\t`, backslashes, and trailing `.,;)]`.
- `profilePageUrl(value: string): {url: string, rawUrl: string}`:
  - Applies the spec §6.1 data-address → page table (Reddit, HackerNews `.json`/`.jso`, dev.to, Gravatar, Docker Hub, Twitch).
  - Other data-like URLs (host starts `api.`, host contains `firebaseio`, path contains `/api/`, or ends `.json`) → `{url:'', rawUrl:value}`.
  - Otherwise → `{url:value, rawUrl:''}`.
- `unwrapText(result): string`: `textOf`, then, if that parses as JSON with a string `result` or `output`, that inner string.
- Account findings: `finding.account` gains:
  - `presence: 'found'|'not-found'|'unchecked'`
  - `presenceNote?: string` (e.g. `'404'`, `'403'`)
  - `rawUrl?: string`
  - `details: {names:[], usernames:[], emails:[], phones:[], ips:[], websites:[], places:[]}`
  - `details` never contains: the account's own URL; image values (keys `image`, `image_bg`, `avatar`, `photo`, `picture`; or values ending `.jpg|.jpeg|.png|.gif|.webp|.svg`); or the finding's `subject.value`.
- `evidence` keeps today's meaning, minus the subject echo in `profileTextAdapter`.

- [ ] **Step 1: Write failing tests:**
  - `socmint table rows carry presence, clean links and no echo`: adapt the committed `omega-mcp--omega-socmint--username.json` fixture.
    - no `account.url` or `rawUrl` contains `\n` or `\\`
    - the GitHub row (`❌ 404`) → `presence:'not-found'`, `presenceNote:'404'`
    - GitLab (403) → `unchecked` / `'403'`
    - Twitter/X (200) → `found`
    - Reddit's `about.json` → `account.url === 'https://www.reddit.com/user/ownername'`
    - the HackerNews `.jso` row → `https://news.ycombinator.com/user?id=ownername`
    - no finding's `evidence.usernames` or `account.details.usernames` contains `ownername`
  - `identity list rows are found accounts without the echo`: the `omega-mcp--omega-identity--username.json` fixture → 5 accounts, all `presence:'found'`, URLs clean, no `ownername` in details.
  - `Maigret profile details become details, never images or the searched username`: the Maigret fixture.
    - `details.names` contains `Owner Example`
    - `details.places` contains `Example City`
    - `details.websites` contains `https://example.com/linked-profile`
    - no `avatar.jpg`, and no `ownername`, in any details
    - every account is `presence:'found'`
  - `Sherlock and Blackbird hits are found accounts`: both fixtures → all `presence:'found'`, with empty `details`.
  - `profilePageUrl maps data addresses and leaves pages alone`: each table row; `https://github.com/x` unchanged; `https://api.example.net/u/x` → `{url:'',rawUrl:…}`.
  - `cleanUrl strips escaped line breaks`: `'https://github.com/x\\n'` → `'https://github.com/x'`.
  - Update `Maigret keeps extracted names, links and usernames as evidence` to assert the new `details` instead, if it relied on the echo.
- [ ] **Step 2: Run** `node --test tests/deep-adapters.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `URL_PATTERN` becomes `/https?:\/\/[^\s<>"'\\\])}]+/gi`, and every extracted URL passes through `cleanUrl`.
  - Socmint: a table-row parser on `unwrapText(result)` lines matching `^\s*(\S.*?)\s{2,}(❌\s*)?(\d{3})\s+(https?:\/\/\S+)`.
  - Identity: list rows matching `^\s*(\S.*?)\s{2,}(https?:\/\/\S+)`, after the "Found on" line.
  - Maigret: `details` from `entry.data`:
    - `fullname`/`name` → names
    - `links` (string or array, split on whitespace and commas) → websites
    - `location` → places
    - emails/phones by regex over `data` values, skipping image keys
    - usernames from `username`/`nickname`/`login` keys when they differ from the subject
  - `accountFinding` gains the new fields and calls `profilePageUrl`.
  - Register `omega_socmint` → the socmint adapter and `omega_identity` → the identity adapter in `ADAPTERS`.
- [ ] **Step 4: Run** `node --test tests/deep-adapters.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `public/deep-adapters.js tests/deep-adapters.test.mjs` — `fix(deep): read socmint and identity tables, clean links, keep profile details`.

### Task 3: Confirm accounts by rules a/b/c with a level (linking)

**Files:** Modify `public/deep-linking.js`; Test `tests/deep-linking.test.mjs`.

**Interfaces:**
- Consumes: account `presence`, `details`, `rawUrl` (Task 2).
- Produces:
  - `accountLevel(rulesHeld: number): 1|2|3|null` (3 → 1, 2 → 2, 1 → 3, 0 → null)
  - `normalizeUrl` treats `twitter.com` as `x.com`
  - account findings returned by `linkFindings` carry:
    - `status`: `'linked'` (confirmed), `'possible'` (found, no rule holds), or `'dropped'` (not-found or unchecked, with the exact dropped reasons)
    - `confirmedBy: ('a'|'b'|'c')[]`, sorted
    - `level`
    - `reasons: {rule, text}[]`
    - `reason`: the joined texts
    - `presenceNotes: string[]`, e.g. `'omega_socmint: not found (404)'` when tools disagree
- Linking steps:
  1. **Merge first.** Account findings are merged by `normalizeUrl(account.url||account.rawUrl)` before any rule runs. Presence precedence: found > unchecked > not-found. Details and sources are unioned.
  2. **Searched identifiers** are the seed plus `searched`. They never count as a detail.
  3. **Rule a:** `account.verified` and the subject is a searched email.
  4. **Rule c:** two or more merged, found accounts on different normalised hosts share a normalised name (≥ 2 characters, not equal to a searched identifier), a website (normalised, not the account's own host), or an email.
  5. **Rule b:** repeat until nothing changes. An account gets `b` if:
     - its details contain a value in the confirmed set (websites by normalised URL or host, emails, usernames), or
     - its own normalised URL appears in the confirmed set's websites.

     The confirmed set is built from confirmed accounts' details and URLs, plus linked non-account findings' identifiers.
  6. **All rules are checked for every account,** not first-match.
- Non-account findings keep today's logic (`Found while checking …`, sanctions rule).
- **Leads** come from linked findings only:
  - from confirmed accounts' `details` (emails, usernames, phones; websites as domains)
  - from linked non-accounts, via `evidenceIdentifiers` as today

- [ ] **Step 1: Write failing tests.** Build findings with a local helper `account(site,url,{presence='found',details={},verified=false,subject={type:'username',value:'ownername'},tool})`.
  - `the searched username alone never confirms an account` → `possible`.
  - `rule a: a registered account for the searched email is level 3` → `confirmedBy ['a']`, `level 3`, reason `Registered with owner@example.com.`
  - `rule c: the same name on two different sites confirms both at level 3`.
  - `rule c ignores the same account reported twice` (`twitter.com/ownername` + `x.com/ownername`, same name) → one merged account, `possible`.
  - `rule c ignores image hosts and the account's own site` (details only differing by an avatar URL are not shared websites) → `possible`.
  - `rule b: an account linking to a confirmed website is confirmed, and confirmation spreads`: a chain of three accounts.
  - `rule b reverse: a confirmed profile linking to an account confirms it` → reason `A confirmed profile links to this account.`
  - `levels count every rule that holds`: an account meeting a and c → `['a','c']`, level 2; one meeting a, b and c → level 1. Also `accountLevel(3)===1`, `accountLevel(1)===3`, `accountLevel(0)===null`.
  - `not found and couldn't check are dropped with their reasons` → `Not found.`, `Couldn't check (403).`
  - `found beats not found when tools disagree, and the disagreement is kept`: socmint 404 + Maigret found, same URL → `presence:'found'`, `presenceNotes` includes `omega_socmint: not found (404)`.
  - `leads come from confirmed details only`: an email in a possible account's details is not a lead; one in a confirmed account's details is.
  - Update existing tests whose premise changes:
    - "rule 2: a profile showing a known identifier is linked" → rewrite as rule b with a non-searched confirmed identifier
    - "rule 3/4" → rule b chains
    - "username-only … possible" → keep

    Ledger each rewrite.
- [ ] **Step 2: Run** `node --test tests/deep-linking.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** as described in Interfaces. Keep `linkFindings(input, seed, {searched})` and `{findings, leads}` unchanged in signature.
- [ ] **Step 4: Run** `node --test tests/deep-linking.test.mjs tests/deep-engine.test.mjs`. Expected: PASS. The engine tests use linking end to end; fix only premises the spec changed, and ledger them.
- [ ] **Step 5: Commit** `public/deep-linking.js tests/deep-linking.test.mjs` (plus `tests/deep-engine.test.mjs` if touched) — `fix(deep): confirm accounts only by rules a, b and c, with a level`.

### Task 4: Person results page

**Files:**
- Modify: `public/deep-results-view.js` (person view only), `public/ui.css` (level badge and details list, existing tokens), `public/app.js` and `public/index.html` (versions per Global Constraints), `tests/fixtures/deep/run-person.json` (new account fields)
- Test: `tests/deep-results-view.test.mjs`, `tests/deep-page.test.mjs`

**Interfaces:**
- Consumes: Task 3's account fields.
- Produces: `renderPersonResults(run)`, with sections in this order:
  1. header, plus the summary line `<found> accounts found · <confirmed> confirmed · details: <n> name(s), …` (omit zero counts)
  2. `Connected details` (h2)
  3. `Confirmed accounts (N)` (h2, kind groups h3, cards h4 sorted by level then site, each with the level badge `<p class="deep-level-badge">…</p>`)
  4. Websites found (as today)
  5. More leads (as today)
  6. `<details>` `Same username, not confirmed (N)`, with cards showing their own details; with more than one searched username, h3 per username
  7. `<details>` `Not found or couldn't check (N)`, a `<ul>` of `site — Not found` / `Couldn't check (403)`
  8. Search details
  9. actions
- Connected details rows: `<li><strong>Label:</strong> value <span class="result-source">from GitHub (maigret_username_search · OSINT Toolbox), …</span> [Pivot →]</li>`, grouped Names, Usernames, Emails, Phones, IPs, Websites, Locations. Pivot only for websites, emails and usernames.
- Account card link: `externalLink(url)` when `account.url` is set; otherwise `<p>SiteName <span class="subtle">No page address</span></p>`.

- [ ] **Step 1: Write failing tests:**
  - `person results show connected details from confirmed sources only`: a run where a confirmed account has `details.names=['Owner Example']` and a possible account has `details.names=['Stranger Name']`. Connected details contains `Owner Example` with its source. `Stranger Name` appears only after the `Same username, not confirmed` summary.
  - `confirmed accounts show their level badge and are ordered by level`: level 1 before level 3 within a group; badge text exact.
  - `not found and couldn't check are folded and listed`.
  - `an account without a page address has no link`: no `<a` inside that card, and `No page address` is present.
  - `headings stay in order and hostile text is escaped`: reuse the existing hostile-text assertions on the new sections.
  - `the empty Connected details explains why`.
  - `an older stored run without presence or details still renders`: the old `run-person.json` shape with `presence`/`details` removed → no throw, and found accounts are treated as found.
  - Version pins: `deep-*.js?v=` and `app.js?v=61`.
- [ ] **Step 2: Run** `node --test tests/deep-results-view.test.mjs tests/deep-page.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the view. Update `run-person.json` to the new shape (stand-ins only), add the CSS for `.deep-level-badge` and `.connected-details` with existing tokens, and bump versions.
- [ ] **Step 4: Run** `node --test tests/deep-results-view.test.mjs tests/deep-page.test.mjs tests/design-tokens.test.mjs tests/a11y-structure.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** the listed files — `feat(deep): connected details, confirmation levels and folded unconfirmed accounts`.

### Task 5: Verify

- [ ] **Step 1:** `npm test`. Expected: 0 failures; report the total.
- [ ] **Step 2:** Throwaway app on port 4199 with a stand-in run. Check:
  - the person results page renders as the spec sketch
  - keyboard order and focus
  - axe-core 4.10.2: 0 violations in light and dark at 1280 px

  Ask the owner before downloading axe again.
- [ ] **Step 3:** **With the owner's OK only:** copy the owner's 11:41 run file into the throwaway app's git-ignored `work/deep-search-runs/` and re-open it. Confirm that links open profile pages, that "not found" rows are folded, and that confirmed accounts (if any) show a level and reasons. Delete the copy afterwards. Report counts only, never identifiers.
- [ ] **Step 4:** Whole-branch review (fresh reviewer); fix Critical/Important test-first.
- [ ] **Step 5:** Stop and ask before pushing.
