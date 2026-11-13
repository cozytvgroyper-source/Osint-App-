# Design Overhaul, Phase 2: Search Page and Results Panel, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Search page clear to a non-technical person. It gets:
- a labeled search box with example searches that fill it
- a results panel whose wording explains itself
- clickable recent searches
- one plain "Sources status" line in place of the technical connection panels

It also fixes the contrast gaps phase 1 left on this page.

**Architecture:**
- The results wording changes in `public/search-results-view.js`, which is DOM-free and tested.
- The page markup changes in `public/index.html`.
- `app.js` changes stay small:
  - remove the renderers whose panels move off this page
  - add a `renderRecentSearches` and a `renderSourcesStatus`
  - add the results-panel extras (Pivot explanation, a save button that names the case)
- Two of `ui.js`'s building blocks get class names of their own, so the older CSS that phase 1 found overriding them no longer applies.

**Tech Stack:** Plain HTML, CSS and ES modules, with `node --test` on Node ≥ 22. axe-core is used only in the test browser.

**Spec:** `docs/superpowers/specs/2026-11-12-design-overhaul-design.md` ("2. Navigation and Search" and "Testing"). This plan is release phase 2.

## Global Constraints

- Plain HTML, CSS and ES modules: no framework, no build step, no new runtime dependencies.
- Text sizes (px): 13, 16, 18, 22, 28, 34. Nothing below 13. Body 16; the search input 18.
- Contrast: text ≥ 4.5:1; large text, icons, borders and focus ≥ 3:1, in both themes (checked by `tests/design-tokens.test.mjs`).
- Focus: the 3 px `:focus-visible` outline. Never `outline:0` or `outline:none`.
- Motion: 150 ms or less. Nothing moves under `prefers-reduced-motion: reduce`, including JavaScript scrolling.
- Wording rules:
  - "MCP server" and "Pivot" keep their names.
  - "Run grant" is never shown.
  - All copy below is copied verbatim from the spec.
- **The PR 81 results data is unchanged.** Ranking, the `ranking` field, the open-state keys (`search-details`, `more:<toolName>`), `data-default-open`, and the old-layout fallback for saved reports without `ranking` all keep their behavior.
- Every value `ui.js` and the view interpolate goes through `escapeHtml`.
- Bump `?v=` on every changed stylesheet or module that `index.html` or `app.js` loads. This includes `app.js?v=` in `index.html`, which phase 1 left at 36.

## Review Focus

1. **History entries that aren't main searches** (a file analysis or a single Tool library run) must not be offered as "run again". Rerunning a file name as a text search would silently do the wrong thing. Covered in Task 4.
2. **A search that finishes with no results:** the empty message names the query, and a query containing HTML is escaped there. Covered in Task 2.
3. **Saving with no active case:** the button reads "Save to a new case", and saving still creates the case, as it does today. **A case name containing HTML** is escaped in the button label. Covered in Task 3.
4. **Every `$('#id')` that `app.js` still uses must exist in `index.html`** after the server grid, data-source strip and connection panel are removed. Otherwise the page throws at load. Covered in Task 4.
5. **Dark theme** on the redesigned search box, chips and status line: contrast and focus. Covered by the Task 5 audit, which runs in both themes with a populated results panel.

---

### Task 1: Building-block classes the older CSS can't override

Phase 1's review found that the older `.badge` and `.empty-state` rules in `styles.css` and `theme.css` load after `ui.css` and override what `badge()` and `emptyState()` produce.

**Files:**
- Modify: `public/ui.js`
  - `badge()` emits `class="ui-badge ui-badge-<tone>"`.
  - `emptyState()` emits `class="ui-empty"` with `<p class="ui-empty-title">`.
- Modify: `public/ui.css`
  - Rename `.badge` → `.ui-badge`, and `.empty-state` / `.empty-state-title` → `.ui-empty` / `.ui-empty-title`.
  - Add the tones `.ui-badge-neutral`, `.ui-badge-safe`, `.ui-badge-warn` and `.ui-badge-danger`. Each pair of text color and background must meet 4.5:1 in both themes, using token colors only.
- Test: `tests/ui.test.mjs`, `tests/design-tokens.test.mjs`

**Interfaces:**
- **Produces:** the same `badge()` and `emptyState()` signatures as phase 1, with the new class names. Nothing calls them yet except Task 4.

- [ ] **Step 1: Write the failing tests**

```js
// tests/ui.test.mjs
test('building blocks use class names no older stylesheet defines',()=>{
  assert.match(badge({text:'Passive',tone:'safe'}),/class="ui-badge ui-badge-safe"/);
  assert.match(emptyState({title:'t',text:'x'}),/class="ui-empty"/);
});
```

```js
// tests/design-tokens.test.mjs
test('older stylesheets never style the building blocks',()=>{
  for(const file of ['styles.css','results.css','theme.css'])assert.doesNotMatch(read(file),/\.ui-(?:badge|empty)\b/,file);
  for(const name of ['ui-badge','ui-badge-safe','ui-badge-warn','ui-badge-danger','ui-empty'])assert.match(css,new RegExp(`\\.${name}\\b`));
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/ui.test.mjs tests/design-tokens.test.mjs`. Expected: the 2 new tests FAIL.
- [ ] **Step 3: Rename the classes in `ui.js` and `ui.css` and add the four tones.**
  - Each tone sets `color:var(--ink)` and a tinted `background`. For example, safe uses `--ink` on `color-mix(in srgb, #1f8b5b 18%, var(--surface))`. If a tone's pair falls below 4.5:1, use `--ink` text.
  - Add the four tone pairs to the contrast test's `PAIRS` by computing the mixed background in the test: the `mix(hex, alpha)` helper already exists there.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `fix(ui): building-block classes that older stylesheets cannot override`.

---

### Task 2: Results wording

**Files:**
- Modify: `public/search-results-view.js`
- Test: `tests/search-results-view.test.mjs`. Update the assertions that match the old wording, keeping their intent.

**Interfaces:**
- **Unchanged:** `renderRankedReport(data, helpers)`.

**Copy** (verbatim from the spec):
- **Source tag** on Top results cards and section headers: `<tool> (via <server>)`, e.g. `OpenSanctions (via Open OSINT)`.
- **Folded items:** `Show <n> more from <tool> that don't mention your search`.
- **No results:** `Nothing found for '<query>'. Try a shorter name, or open Search details to see which sources answered.`
  - `<query>` is `data.query`, escaped.
  - When `data.query` is empty, use `Nothing found. Try a shorter name, or open Search details to see which sources answered.`
- **Status line:** unchanged ("41 results from 2 tools", "3 of 6 tools answered…").

- [ ] **Step 1: Write the failing tests** (in `tests/search-results-view.test.mjs`, reusing its fixtures)

```js
test('sources read as "<tool> (via <server>)"',()=>{
  assert.match(html,/OpenSanctions \(via Open OSINT\)/);
  assert.doesNotMatch(html,/OpenSanctions · Open OSINT/);
});
test('folded items say why they are folded',()=>{
  assert.match(html,/<summary>Show 38 more from News RSS that don&#39;t mention your search<\/summary>/);
});
test('no results names the search and points at Search details',()=>{
  const out=renderRankedReport({...emptyData,query:'<b>Rosneft</b>'},helpers);
  assert.match(out,/Nothing found for &#39;&lt;b&gt;Rosneft&lt;\/b&gt;&#39;\. Try a shorter name, or open Search details to see which sources answered\./);
  assert.match(renderRankedReport({...emptyData,query:''},helpers),/Nothing found\. Try a shorter name/);
});
```

  `html` and `emptyData` are the file's existing main fixture and no-results fixture. `'` is escaped as `&#39;` by `escapeHtml`, so the copy is built with `esc()`.
- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/search-results-view.test.mjs`. Expected: the 3 new tests FAIL.
- [ ] **Step 3: Change the `label` helper, the `<summary>` text and the empty copy.** Then update the older assertions that matched `·` or "No results for this search".
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `feat(search): results that explain their sources and folded items`.

---

### Task 3: Results panel

**Files:**
- Modify: `public/app.js`
  - `showResult` (around line 455)
  - `saveLastResultToCase` (around line 320–330): no behavior change
  - the `[data-pivot]` handler stays as it is
- Modify: `public/ui.css`: add `.result-dialog{width:min(1100px,calc(100vw - 32px));max-height:90vh}`. It must win over `results.css` and `styles.css`, so use the selector `dialog.result-dialog`.
- Test: `tests/ui-polish.test.mjs`

**Interfaces:**
- Produces, in `app.js` (exported for tests by being a plain top-level function the source tests can find):
  - `saveButtonLabel(activeCase): string`. It returns `Save to <name> case` when there is an active case (with `name` the case name, escaped by the caller because it is set with `textContent`), and `Save to a new case` otherwise.

**Behavior:**
- **Save button:** on every `showResult`, `#saveEvidence.textContent = saveButtonLabel(state.activeCase)`, and the button gets class `primary`.
- **Pivot explanation:** when the rendered body contains at least one `.pivot-button`, `showResult` inserts `<p class="pivot-note">${term('pivot')}</p>` once, at the top of `#resultBody`. Import `term` from `./ui.js?v=2`.
- **Open/close:** the result dialog keeps `openDialog` and the live-redraw path unchanged.

- [ ] **Step 1: Write the failing tests**

```js
test('the results panel is large and names the case it saves into',()=>{
  assert.match(read('ui.css'),/dialog\.result-dialog\{width:min\(1100px,calc\(100vw - 32px\)\);max-height:90vh\}/);
  const fn=app.match(/function saveButtonLabel\(activeCase\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn,/`Save to \$\{activeCase\.name\} case`/);
  assert.match(fn,/'Save to a new case'/);
  assert.match(app,/\$\('#saveEvidence'\)\.textContent=saveButtonLabel\(state\.activeCase\)/);
});
test('Pivot is explained once, at the top of results that have pivots',()=>{
  assert.match(app,/querySelector\('\.pivot-button'\)[\s\S]{0,200}pivot-note[\s\S]{0,80}term\('pivot'\)/);
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/ui-polish.test.mjs`. Expected: the 2 new tests FAIL.
- [ ] **Step 3: Implement as above.** Write `saveButtonLabel` on lines of its own, in the form `function saveButtonLabel(activeCase){` … `}`, so the test can extract it.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `feat(search): larger results panel, Pivot explained, save button names its case`.

---

### Task 4: The Search page

**Files:**
- Modify: `public/index.html`, the `#workspace` section:
  - **Hero:** remove `.hero-copy` (status pill, h2 "What do you want to investigate?", and its `<p>`). The page header now carries the name and intro.
  - **Search form:**
    - Add a visible `<label for="query" class="search-label">What do you want to look up?</label>` above `.search-row`, and drop the input's `aria-label`.
    - Placeholder: `e.g. Rosneft, example.com, 8.8.8.8 or @jdoe`.
    - Submit button text: `Search`.
    - After the row, add `<p class="search-hint"><kbd>⌘</kbd><kbd>K</kbd> jumps here from any page.</p>`.
  - **File upload:** the label text becomes `Add a file (picture, video, PDF, Word, text, CSV or JSON)`.
  - **Examples:** replace the four chips with five `.chips` buttons, each a label plus the value it fills in:

    | Label | `data-prompt` |
    |---|---|
    | A company: Rosneft | `Rosneft` |
    | A website: example.com | `example.com` |
    | An IP address: 8.8.8.8 | `8.8.8.8` |
    | A username: @jdoe | `@jdoe` |
    | An event: earthquakes in Chile | `earthquakes in Chile` |

    The group's `aria-label` becomes `Example searches`.
  - **Remove** "Available servers" with `#workflowGrid`, "Data sources" with `#dataSourceStrip` and `#dataSourceSummary`, and the `.connection-panel` panel.
  - **Recent searches:** the history panel's heading becomes `<h2>Recent searches</h2>`, and its eyebrow is removed.
  - **Sources status:** add `<p id="sourcesStatus" class="sources-status" role="status"></p>` under the search form, inside `.hero-card`.
- Modify: `public/app.js`
  - **Remove:** delete `renderWorkflows`, the Search-page parts of `renderConnections` (`#serverStatus`, `#connectionCount`, `#connectionSummary`), and the `#dataSourceStrip` and `#dataSourceSummary` lines in `renderDataSources`. Update `renderAll` to match. Keep everything the MCP servers page uses.
  - **Add `renderRecentSearches()`**, which replaces `renderHistory()`:
    - It shows the last 5 entries.
    - An entry whose `sourceLog` is an array (a main search) is a `<button type="button" class="history-item" data-rerun="<title>">` showing the title, its sources line and the time.
    - Any other entry is a plain `<div class="history-item">`.
    - The empty state is `emptyState({title:'No searches yet', text:'Your searches will appear here so you can run them again.'})`.
    - A delegated click on `[data-rerun]` sets `#query` to the title and submits `#investigateForm` with `requestSubmit()`.
  - **Add `renderSourcesStatus()`:**
    - With at least one connected MCP server, it sets `#sourcesStatus` to `<connected> MCP server(s) connected · <n> data source(s) set up · ` followed by `<button class="text-button" data-view-link="servers">Manage</button>`. Use `serverConnectionLabel`'s count, the connected entries in `dataSources.list`, and singular/plural.
    - With none connected, it shows `No MCP servers are connected, so searches can't run yet.` followed by `<button class="text-button" data-view-link="servers">Open MCP servers</button>`.
    - Call it from `renderAll` and after data sources load.
  - **Motion:** `switchView` scrolls with `behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'`.
- Modify: `public/theme.css` and `public/styles.css`
  - `.search-row button` uses `background:var(--action);color:var(--on-action)`, replacing the red gradient (4.21:1).
  - `.search-row` and `.filter` borders use `var(--field-border)`.
  - The query input is `font-size:var(--text-md)`, and form controls are `font-size:var(--text-sm)` (16 px).
- Modify: `public/ui.css`: add `.search-label` (`--text-md`, weight 650), `.search-hint`, `.sources-status` (`--text-sm`, `--muted` text), and `.history-item` as a button (full width, left-aligned, the 44 px target).
- Test: `tests/search-page.test.mjs` (new)

**Interfaces:**
- **Consumes:** `emptyState` (Task 1, `ui.js?v=2`), and `serverConnectionLabel` from `tool-health.js` (existing).

- [ ] **Step 1: Write the failing tests**

```js
const html=read('index.html'),app=read('app.js');
const workspace=html.match(/<section id="workspace"[\s\S]*?<\/section>\s*<section/)[0];
test('the search box has a visible label and a plain button',()=>{
  assert.match(workspace,/<label for="query" class="search-label">What do you want to look up\?<\/label>/);
  assert.match(workspace,/<button type="submit">Search<\/button>/);
  assert.match(workspace,/Add a file \(picture, video, PDF, Word, text, CSV or JSON\)/);
});
test('example searches fill the box with a plain value',()=>{
  const chips=[...workspace.matchAll(/data-prompt="([^"]+)">([^<]+)</g)].map(m=>[m[2],m[1]]);
  assert.deepEqual(chips,[['A company: Rosneft','Rosneft'],['A website: example.com','example.com'],['An IP address: 8.8.8.8','8.8.8.8'],['A username: @jdoe','@jdoe'],['An event: earthquakes in Chile','earthquakes in Chile']]);
});
test('technical connection panels left the Search page',()=>{
  for(const id of ['workflowGrid','dataSourceStrip','connectionSummary','serverStatus'])assert.doesNotMatch(workspace,new RegExp(`id="${id}"`),id);
  assert.match(workspace,/id="sourcesStatus"[^>]*role="status"/);
  assert.match(workspace,/<h2>Recent searches<\/h2>/);
});
test('every element app.js looks up by id exists on the page',()=>{
  // Ids in the page, plus ids app.js creates itself in its templates (e.g. id="retryIntelNews").
  const ids=new Set([...(html+app).matchAll(/\bid=\\?"([\w-]+)/g)].map(m=>m[1]));
  for(const m of app.matchAll(/\$\('#([\w-]+)/g))assert.ok(ids.has(m[1]),`#${m[1]} is missing from index.html`);
});
test('only main searches can be run again',()=>{
  const fn=app.match(/function renderRecentSearches\(\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn,/Array\.isArray\(item\.sourceLog\)/);
  assert.match(fn,/data-rerun="\$\{escapeHtml\(item\.title\)\}"/);
});
test('the sources status explains an empty connection list',()=>{
  assert.match(app,/No MCP servers are connected, so searches can(?:'|\\')t run yet\./);
  assert.match(app,/data-view-link="servers">Open MCP servers</);
});
test('page switches do not animate for people who ask for less motion',()=>{
  assert.match(app,/matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\?'auto':'smooth'/);
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/search-page.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Make the `index.html`, `app.js` and CSS changes above.** If an older test asserts on a removed element (e.g. the ⌘K button test in `ui-polish`, or a history test), update only what the spec changed.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures, including `design-tokens` (contrast, font floor, focus).
- [ ] **Step 5: Commit** `feat(search): a labeled search box, example searches, recent searches and a plain sources status`.

---

### Task 5: Browser audit with real results, and a keyboard pass (verification)

- [ ] **Step 1: Start the server and load axe.** Start the branch's server on port 4174 with a throwaway `PUBLIC_DESK_TOKEN`. Serve axe-core 4.10.2 from an untracked `public/__axe-test.js` (downloaded to scratch, copied in, deleted at the end, never committed), and load it with a `<script>` tag from the test browser.
- [ ] **Step 2: Audit the Search page in both themes.** Expected: zero violations at any impact.
- [ ] **Step 3: Audit a populated results panel in both themes.** Render a realistic ranked payload into the real dialog. Build it in the page with `buildSearchReport` from `/search-report.js?v=…`, using the app's own helpers through a normal `showResult` call. If `showResult` isn't reachable from the console, render with `renderRankedReport` and the same helper signatures. The payload should include:
  - two direct sanctions results
  - 14 news items, 2 matching
  - one pivot-able domain
  - a consolidated finding

  Expected: zero violations, and "Show 12 more from News RSS that don't mention your search" is present.
- [ ] **Step 4: Visual check at 1280 px and 375 px** of the Search page and the results panel. Check:
  - the 13 px floor items (`.pivot-button`, `.source-meta dt`) don't overflow
  - the panel is large on desktop and fits on the phone
- [ ] **Step 5: Keyboard pass.** Check each of these with the keyboard only:
  - Tab reaches the search label's field, the Search button, the file control, each example, and each Recent search.
  - An example fills the box without running.
  - ⌘K focuses the box.
  - In the results panel, Tab reaches "Show more", Search details and Pivot. Pivot closes the panel and leaves focus on the filled box.
  - Escape closes the panel and returns focus to the search box.
- [ ] **Step 6: Fix and record.** Fix any finding in its owning task, with a test that fails first, re-run `npm test`, commit, and record the results for the PR description.
