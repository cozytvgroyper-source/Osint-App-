# Passive Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the main Search page into Passive search for people, companies and news events. Results are grouped (Who/what, News, Related data, Records), each shown once, with exact-name ranking, a news sort, Save to case per result, a Deep Search hand-off for targets, and news working again.

**Architecture:**
- Three new DOM-free modules:
  - `public/passive-search.js` decides what a query is and which sources run.
  - `public/passive-results.js` ranks and groups the answers.
  - `public/passive-results-view.js` renders HTML.
- `public/app/search.js` runs them in place of the planner for the main search.
- The result dialog routes a `passive` payload to the new view.
- The news fix is in the data-service preload `scripts/require-loopback-token.mjs`.

**Tech Stack:** Plain ES modules, Node ≥22 `node --test`, no dependencies. Browser tests use `tests/helpers/browser.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-14-passive-search-design.md`

## Global Constraints

- No dependencies. Views are DOM-free and escape every value with `escapeHtml`; every link goes through `safeHttpUrl` (from `public/ui.js`).
- CSP `script-src 'self'; style-src 'self'`: no inline scripts or styles.
- Heading order h1 → h2 → h3 in the result dialog. Save buttons are named `Save to case: <title>`. Pivot names start with `Pivot:`.
- axe stays at 0 violations (rule sets wcag2a, wcag2aa, wcag21aa, wcag22aa, best-practice), light and dark.
- Only passive, reviewed tools run (the planner's exclusion rules apply). `get_hn_search` is never used by Passive search.
- Fixtures use stand-ins only (`ownername`, `Owner Example`, `owner-site.example`, `Example City`, "Example Corp"). No real person's or company's live answers are committed.
- Page copy, exact:
  - nav and title: `Passive search`
  - intro: `Look up a person, company or news event in public sources. Nothing here contacts anyone.`
  - placeholder: `e.g. Donald Trump, Rosneft or earthquakes in Chile`
  - chips:
    - `A person: Donald Trump` (data-prompt `Donald Trump`)
    - `A company: Rosneft` (data-prompt `Rosneft`)
    - `An event: earthquakes in Chile` (data-prompt `earthquakes in Chile`)
- Hand-off copy: `This looks like a <kind>. Passive search covers people, companies and news; <kind>s are checked in Deep Search.`, with the button `Open in Deep Search`. `<kind>` is one of: website, IP address, username, email address, phone number, vulnerability ID, file hash.
- Sanctions wording: `Appears in <dataset> — check before relying on it`. Never "sanctioned".
- Each task's tests pass with `npm test` (all files), and its commit stages explicit paths only.

## Review Focus

1. **One source fails or returns nothing while others answer.** The other groups still show. Failures and empty answers are listed only under Search details. → Task 4 test `a failed source leaves the other groups intact`.
2. **News items with a missing or unparseable date under Newest first.** They sort after dated items, in their original order, and nothing throws. → Task 4 test `undated news sorts last under newest first`.
3. **Hostile text or links in tool answers** (`<script>`, `javascript:` links). The text is escaped and the link is dropped. → Task 5 test `hostile titles are escaped and unsafe links are not links`.
4. **A query that is only topic words** ("latest news", "sanctions"). The subject is empty, so no identity or Records lookup runs with an empty query; News and topic sources run with the query. → Task 3 test `a topic-only query runs no identity lookup`.
5. **Saving while the search is still running, and saving the same result twice.** The "Saved" state survives the live redraw, and a second press does nothing. → Task 6 browser test `a saved result stays saved through live updates`.

---

### Task 1: News works again — the data service's calls to itself carry the token

**Files:**
- Modify: `scripts/require-loopback-token.mjs`
- Test: `tests/local-service-auth.test.mjs`

**Interfaces:**
- Produces: `addSelfToken(url, init, {port, token}) -> init` (exported, pure). It returns `init` with `authorization: Bearer <token>` added when `url` is `http://127.0.0.1:<port>/…` or `http://localhost:<port>/…` and no authorization header is present; otherwise it returns `init` unchanged.
- At load, the preload wraps `globalThis.fetch` with it. `port` is the port of the first `http.Server` that starts listening, falling back to 8080.

- [ ] **Step 1: Write failing tests** in `tests/local-service-auth.test.mjs`, importing `addSelfToken`:
  - `test('a call the data service makes to itself carries the launch token')`: `addSelfToken('http://127.0.0.1:8080/api/rss-proxy?url=x',{headers:{accept:'text/xml'}},{port:8080,token:T})` has `authorization` `Bearer ${T}` and keeps `accept`. The same holds for `http://localhost:8080/…`, and for a `Headers` instance and a `Request`-free `init` of `undefined`.
  - `test('calls anywhere else never get the token')`: other host `https://feeds.bbci.co.uk/x`, other port `http://127.0.0.1:8892/mcp`, and `https://127.0.0.1:8080/` all return `init` with no authorization.
  - `test('an existing authorization header is kept')`: `{headers:{Authorization:'Bearer other'}}` is unchanged.
- [ ] **Step 2: Run** `node --test tests/local-service-auth.test.mjs`. Expected: FAIL, `addSelfToken` is not exported.
- [ ] **Step 3: Implement** `addSelfToken`, and wrap `globalThis.fetch` and record the listening port (via the existing `http.Server.prototype` hook: on `'listening'`, read `this.address().port` once).
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `fix(data-service): its calls to itself carry the launch token, so news feeds and GDELT work`.
- [ ] **Step 6: Live check (owner's go-ahead needed).** Ask the owner before stopping their running app. Then run "Stop Public Desk.command" and "Start Public Desk.command".
  - Re-run `get_news_rss` (no arguments) and `get_gdelt {"query":"<an event>"}` through the app.
  - Expected: feed items have non-empty `title`, `link` and `pubDate`; GDELT returns articles, not "Authentication required".
- [ ] **Step 7:** Record the answer *shapes* (keys and value types, with stand-in values) of `get_news_rss`, `get_gdelt`, `get_opensanctions`, `get_sec_filings`, `get_offshore_leaks` and `get_opencorporates` as fixtures in `tests/fixtures/passive/<tool>.json`. Use stand-in titles, names and links (`https://news.example/…`). Commit them with Task 4.

### Task 2: A saved finding can carry its note

**Files:**
- Modify: `scripts/cases.mjs` (`addEvidence`)
- Test: `tests/cases.test.mjs`

**Interfaces:**
- Produces: `POST /api/cases/:id/evidence` accepts an optional `note` (string, trimmed, at most `MAX_NOTE_CHARS`; longer is rejected with `CASE_INPUT`). It is stored as the finding's `note`; without it, `note` stays `''`.

- [ ] **Step 1: Write failing test** `test('a finding can be saved with its note')`:
  - `addEvidence(id,{title:'t',result:1,note:'From Passive search: Example Corp'})` stores that note.
  - A note longer than `MAX_NOTE_CHARS` rejects with `{code:'CASE_INPUT'}`.
  - Without a note, `note` is `''`.
- [ ] **Step 2: Run** `node --test tests/cases.test.mjs`. Expected: FAIL on the note.
- [ ] **Step 3: Implement** in `addEvidence`, reusing the same trim and limit check as `updateEvidence`.
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(cases): a finding can be saved with its note`.

### Task 3: What a query is, and which sources run

**Files:**
- Create: `public/passive-search.js`
- Test: `tests/passive-search.test.mjs`

**Interfaces:**
- Consumes: `extractTarget`, `searchIntent`, `searchSubjectFor`, `argsForSearch` (`public/search-query.js`); the planner's exclusion check (export `isPassiveSearchTool` from `public/search-planner.js` if not already exported).
- Produces:
  - `passiveQuery(query) -> {kind:'target', target:{type,value}, label} | {kind:'search', subject, event:boolean, company:boolean, intentId}`.
    - `label` is the `<kind>` word from Global Constraints.
    - `company` is true when the intent is `organization`, `filings` or `offshore`, or the subject ends in Inc, Ltd, LLC, plc, AG, GmbH, SA, Corp or Company (case-insensitive, with an optional trailing dot).
    - `event` is true when the intent is a topic intent other than `organization`, `filings`, `offshore` or `sanctions`, or `news`.
  - `passiveSources(info, tools) -> [{tool, group:'identity'|'news'|'data'|'records', args}]`, exact, in this order:
    - identity: `get_wikidata`;
    - news: `get_news_rss`, `get_gdelt`;
    - records: `get_opensanctions`, `get_offshore_leaks`, plus `get_opencorporates` and `get_sec_filings` when `company`;
    - then the intent's own tools (from `searchIntent(query).tools`). Each goes to `records` when it is `get_sanctions`, `get_opensanctions`, `get_sec_filings`, `get_offshore_leaks` or `get_opencorporates`; to `news` when its name ends in `_news` or `_feeds` or is `get_gdelt`/`get_news_rss`; otherwise to `data`.
    - Skip tools that aren't connected or fail `isPassiveSearchTool`, and remove duplicates.
    - Identity and records `args` use the **subject**; news and data `args` use the full query. `get_news_rss` gets `{}`.
    - With an empty subject, identity and records are left out.
  - `addCompanySources(info, tools, wikidataEntity) -> extra sources`. Wikidata says organisation when `facts.instanceOf` is one of `wd:Q4830453`, `wd:Q43229`, `wd:Q783794` or `wd:Q6881511`. It returns the company records sources not already planned.

- [ ] **Step 1: Write failing tests** with a stand-in tool list built like `tests/fixtures/mcp-tools.json` entries:
  - `test('targets are handed to Deep Search with their kind')`:
    - `owner-site.example` → `{kind:'target', label:'website'}`
    - `8.8.8.8` → `IP address`
    - `@ownername` → `username`
    - `owner@example.com` → `email address`
    - `+15555550100` → `phone number`
    - `CVE-2024-3094` → `vulnerability ID`
    - a 32-hex hash → `file hash`
  - `test('a name runs identity, news and records, and never Hacker News')`: `Owner Example` gives exactly `get_wikidata` (identity), `get_news_rss` and `get_gdelt` (news), `get_opensanctions` and `get_offshore_leaks` (records). No `get_hn_search`.
  - `test('a company adds company registers and filings')`: `Example Corp` and `Example company` add `get_opencorporates` and `get_sec_filings`.
  - `test('a topic word keeps the subject lookup and adds its own sources')`:
    - `Owner Example sanctions`: subject `Owner Example`, records include `get_sanctions`.
    - `earthquakes in Example City`: `event:true`, earthquake tools in `data`.
  - `test('a topic-only query runs no identity lookup')`: `latest news` has no identity or records sources.
  - `test('only passive, connected tools run')`: an unconnected `get_gdelt` is skipped; a tool marked active is skipped.
  - `test('a Wikidata organisation adds the company sources once')`.
- [ ] **Step 2: Run** `node --test tests/passive-search.test.mjs`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement** `public/passive-search.js`.
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(search): decide what a passive search is and which sources it runs`.

### Task 4: Ranking and grouping the answers

**Files:**
- Create: `public/passive-results.js`
- Create: `tests/fixtures/passive/*.json` (from Task 1 Step 7, stand-in values)
- Test: `tests/passive-results.test.mjs`

**Interfaces:**
- Consumes: `classifyToolResult` output (`{kind, data, error}`) per source; `passiveSources` entries.
- Produces:
  - `passiveTier(item, subject) -> 0..5`, where 5 is best:
    - 5: the label, name or an alias equals the subject, ignoring case, dots and spaces;
    - 4: the subject is inside the title, label or name;
    - 3: the subject is anywhere in the item text;
    - 2: every subject word of two or more letters is present;
    - 1: some are;
    - 0: none.
    - With an empty subject, every item is 3.
  - `buildPassiveResults({query, subject, event, sources, outcomes}) -> {query, subject, event, identity, news, data, records, failed, pending}`:
    - `identity: {best, others}`. `best` is a Wikidata entity with tier ≥4, else `null`; `others` are the other entities with tier ≥2.
    - `news: [{key, title, link, date, source, snippet, tier, tool, item}]`, de-duplicated by `link`, then by lower-cased title with spaces collapsed.
    - `data: [{key, tool, label, items, hidden}]` and `records: [{key, title, detail, link, tier, tool, item}]`.
    - `failed: [{label, error}]` and `pending: [label]` for Search details.
    - Items of tier 0 are counted in a group's `hiddenCount` and kept in `hidden`.
    - Every `key` is `<group>:<tool name>:<index>`, stable across redraws.
  - `sortNews(news, order:'newest'|'relevant') -> news`:
    - `newest`: by date, newest first; undated items last in original order.
    - `relevant`: by tier, then date.
  - Item text fields: `label`, `name`, `title`, `headline`, `aliases`, `description`, `summary`, `snippet`, `text`, `company`, `dataset`.

- [ ] **Step 1: Write failing tests** using the stand-in fixtures and inline Wikidata entities shaped like the live answer (`{id,label,description,aliases,wikiUrl,facts}`):
  - `test('the exact name wins over a description that mentions it')`: for the subject `Owner Example`, an entity labelled `Owner Example` with an unrelated description is `best`; `Owner Example Jr.` ("son of Owner Example") is in `others`.
  - `test('aliases and initials match')`: subject `OE Example` matches the alias `O. E. Example` at tier 5; the two-letter word `oe` counts.
  - `test('every result appears once')`: the same link from `get_news_rss` and `get_gdelt` appears once.
  - `test('undated news sorts last under newest first')` (Review Focus 2).
  - `test('relevant order puts the subject first')`.
  - `test('a failed source leaves the other groups intact')` (Review Focus 1): GDELT rejected and OpenSanctions empty, so `failed` lists both and `news` still holds the RSS items.
  - `test('sanctions records say where the name appears')`: the record `detail` is `Appears in <dataset> — check before relying on it`.
  - `test('items that don't mention the subject are hidden, not dropped')`.
- [ ] **Step 2: Run** `node --test tests/passive-results.test.mjs`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement** `public/passive-results.js`. Dates come from `pubDate`, `date`, `seendate`, `publishedAt` or `published`, via `Date.parse`; NaN means undated.
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(search): rank and group passive search answers, each result once`.

### Task 5: The grouped results view

**Files:**
- Create: `public/passive-results-view.js`
- Modify: `public/ui.css` (group, card, news-row, sort and saved styles, light and dark)
- Test: `tests/passive-results-view.test.mjs`

**Interfaces:**
- Consumes: `buildPassiveResults` output, `sortNews`.
- Produces: `renderPassiveResults(results, {sort, savedKeys:Set, escapeHtml, safeHttpUrl, renderRecord, renderArray}) -> string`.
  - Groups are `<section class="passive-group">`, each with an `<h3>`:
    - `Who or what this is`
    - `News`
    - `Related data`
    - `Records`
  - An empty group is omitted.
  - The identity card lists close matches under `<h4>Other people or things with this name</h4>`.
  - The News sort is `<select id="newsSort" aria-label="Sort news">`, with options `newest` ("Newest first") and `relevant` ("Most relevant").
  - Every result has `<button class="save-result" data-save-result="<key>" aria-label="Save to case: <title>">Save to case</button>`. When `savedKeys` has the key, it reads `Saved` and is `disabled`.
  - Hidden items go under `<details class="more-results">` with the summary `Show N more that don't mention your search`.
  - `Search details` (`<details class="search-details">`) lists the sources asked, `failed` and `pending`.
  - `renderPassiveHandOff({label, value}) -> string`: the hand-off copy, plus `<button class="primary" data-open-deep-search="<value>">Open in Deep Search</button>`.

- [ ] **Step 1: Write failing tests**:
  - `test('groups appear in order and empty ones are left out')`.
  - `test('the identity card shows the best match and lists others')`.
  - `test('news shows date, source and a linked title, sorted as asked')`, for both sort values.
  - `test('every result has its own named Save to case button, and saved ones are marked')`.
  - `test('hostile titles are escaped and unsafe links are not links')` (Review Focus 3).
  - `test('headings stay in order: h3 inside the dialog')`.
  - `test('the hand-off names the kind and offers Deep Search')`.
- [ ] **Step 2: Run** `node --test tests/passive-results-view.test.mjs`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement** the view and its CSS.
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(search): grouped results view with a news sort and Save to case`.

### Task 6: Run Passive search in the app

**Files:**
- Modify: `public/app/search.js` (`smartInvestigate` → passive flow), `public/app/results.js` (route a `passive` payload), `public/app/evidence.js` (add `saveResultToCase`), `public/app.js` (wiring for save, sort, hand-off, pivot and rerun)
- Test: `tests/browser-flows.test.mjs`, `tests/helpers/browser.mjs` (extend `STUB_MCP` with Open OSINT stand-ins on `http://127.0.0.1:8892/mcp`)

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `smartInvestigate(query)`:
    - A target calls `showResult(query, {passiveHandOff:{label,value}})` and runs nothing.
    - Otherwise it runs `passiveSources`, rebuilds with `buildPassiveResults` as each answer arrives (stale searches are ignored, as today), and stores `state.lastResult = {title:query, result:{passive:results}, …}`.
    - When Wikidata answers with an organisation, it adds the `addCompanySources` sources.
  - `renderReadableResult` renders `payload.passive` with `renderPassiveResults`, and `payload.passiveHandOff` with `renderPassiveHandOff`.
  - `saveResultToCase(key)` finds the item by key in `state.lastResult.result.passive`. It saves `{title, result:item, server:toolLabel, time, note:'From Passive search: <query>'}`, adds the key to `state.savedResultKeys` (cleared on every new search), and redraws.
  - `#newsSort` change sets `state.newsSort` and redraws. A new search resets it: `newest` for events, `relevant` otherwise.
  - `[data-open-deep-search]` runs `switchView('deep')`, then `resetDeepSearch(value)`.
  - Pivot buttons and "Search again" with a target value do the same instead of `smartInvestigate`.

- [ ] **Step 1: Write failing browser tests** (stub answers use stand-in names):
  - `test('a name search groups results, ranks the exact name first, and shows each result once')`: `Owner Example` shows the identity card for `Owner Example` (not `Owner Example Jr.`), News, and Records. The same stand-in article from two sources appears once.
  - `test('a website, IP or username opens Deep Search instead')`: `owner-site.example` shows the hand-off, and nothing was called (the `__mcp.calls` list has no `tools/call`). The button opens Deep Search with the value filled in and not started.
  - `test('an event search lists news newest first, and the sort can change')`.
  - `test('Save to case saves that one result with its note')`: the case gets one finding whose note reads `From Passive search: Owner Example`.
  - `test('a saved result stays saved through live updates')` (Review Focus 5): save while a slow source is pending; after it answers, the button still reads `Saved`; a second press adds nothing.
  - `test('a pivot on a website goes to Deep Search')`.
- [ ] **Step 2: Run** `node --test tests/browser-flows.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Run** `npm test`. Expected: pass. Retire the old text checks that pinned the replaced main-search flow (only where the browser tests above now cover the same behaviour), and say which in the commit.
- [ ] **Step 5: Commit** `feat(search): run Passive search with grouped results and Save to case`.

### Task 7: Page copy, chips, the ⌘K button and the focus box

**Files:**
- Modify: `public/index.html` (nav label, placeholder, chips, remove `#cmdButton` and the `⌘K jumps here` hint), `public/app/core.js` (`PAGES.workspace`), `public/app.js` (remove the ⌘K keydown handler and the `#cmdButton` handler), `public/ui.css` (remove `.search-row:focus-within` outline; add `#query:focus-visible{outline:none}`)
- Test: `tests/search-page.test.mjs`, `tests/ui-polish.test.mjs`, `tests/browser-flows.test.mjs`

- [ ] **Step 1: Update the failing expectations first:**
  - `search-page` chips equal the three in Global Constraints.
  - `ui-polish`'s ⌘K test becomes `test('there is no ⌘K shortcut or header Search button')`: no `id="cmdButton"`, no `metaKey` handler, no `jumps here`.
  - Add `test('the page is called Passive search')`: nav text, PAGES title and intro exact.
  - Add a browser test `test('typing in the search box shows no focus box')`: after focusing `#query` with Tab, both `#query` and `.search-row` have outline style `none`. Another control (`#newInvestigation`) still shows a `:focus-visible` outline.
- [ ] **Step 2: Run** `npm test`. Expected: those tests FAIL.
- [ ] **Step 3: Implement** the copy, removals and CSS.
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(search): call it Passive search; remove ⌘K and the search field's focus box`.

### Task 8: Check it end to end

- [ ] **Step 1:** Run `npm test` five times. Expected: identical full passes.
- [ ] **Step 2: Live passive searches** through the running app, after the Task 1 restart. Report counts and titles of the top items only; nothing is committed.
  - `Donald Trump`: the card is the president, and Donald Trump Jr. appears only under "Other people or things with this name".
  - `JD Vance`: the card is JD Vance; no Hacker News source.
  - `Rosneft`: card plus records.
  - `earthquakes in Chile`: News newest first, plus earthquake data.
  - Expected: no result appears twice.
- [ ] **Step 3: axe 4.10.2** (ask the owner before downloading) on Passive search with results, light and dark, at 1280 px and 375 px. Expected: 0 violations.
- [ ] **Step 4: Whole-branch review**, on the most capable model. Fix Critical and Important findings test-first.
- [ ] **Step 5:** Ask the owner before pushing or opening a PR.
