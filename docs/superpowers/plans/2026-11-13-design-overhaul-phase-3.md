# Design Overhaul, Phase 3: Evidence and News, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Evidence and News pages clear and fully usable from the keyboard and by screen readers.
- **Evidence:**
  - Labeled finding statuses
  - Real confirmation dialogs
  - One accessible Export menu
  - An "Open" button that shows a saved result
- **News:**
  - Plain metric explanations
  - Readable times
  - Announced loading
  - Focus that follows "Load more"

**Architecture:** The new markup lives in two new DOM-free modules, `public/evidence-view.js` and `public/news-view.js`. Like `search-results-view.js`, they return HTML strings and are unit-tested. `app.js` only wires them in and adds two small helpers:
- `confirmAction`: a promise-based confirmation `<dialog>`
- `setupMenu`: a keyboard menu button

**Tech Stack:** Plain HTML, CSS and ES modules, with `node --test` on Node ≥ 22. axe-core is used only in the test browser.

**Spec:** `docs/superpowers/specs/2026-11-12-design-overhaul-design.md`, section "3. Evidence and News" (release phase 3).

## Global Constraints

- Plain HTML, CSS and ES modules. No framework, no build step, no new runtime dependencies.
- Text sizes (px): 13 / 16 / 18 / 22 / 28 / 34. Nothing below 13.
- Contrast: text at least 4.5:1; icons, borders and focus at least 3:1; both themes.
- Focus: the 3 px `:focus-visible` outline. Never `outline:0`.
- Motion: 150 ms or less, and none under reduced motion.
- Use `ui.js` building blocks: `button`, `badge` (`ui-badge`), `emptyState` (`ui-empty`), and `term`, including `term(key, {visible: true})`. Glossary keys: `unverified` ("Not checked yet"), `confirmed`, `ruledOut`, `fingerprint`.
- **Stored values never change.** Evidence statuses stay `unverified`, `confirmed` and `ruled out` on disk. Only their labels change. The case API routes and payloads are unchanged.
- Every value the view modules interpolate goes through `escapeHtml`.
- Bump `?v=` on every changed stylesheet or module that `index.html` or `app.js` loads. New modules start at `?v=1`.
- Copy is taken from the spec. Where the spec gives text, use it word for word.

## Review Focus

1. **A finding title, case name, note or news title containing HTML or quotes** is escaped everywhere it appears, including the confirmation dialog's message. Covered in Tasks 1, 3 and 4.
2. **A news event with a missing or invalid timestamp** shows "Time unknown". It never shows "NaN days ago" or a broken `datetime` attribute. Covered in Task 1.
3. **Cancelling a confirmation** (Cancel button, Escape, or a click on the backdrop) deletes nothing and returns focus to the button that asked. Covered in Task 4: the code test, plus the Task 6 keyboard pass.
4. **The Export menu with no case open** keeps the menu button disabled. The three items never fire without a case. Covered in Task 5.
5. **A note at the 4000-character limit:** the counter reads "4000 of 4000 characters" and the server's limit is respected (`maxlength`). Covered in Task 3.

---

### Task 1: News view module

**Files:**
- Create: `public/news-view.js`
- Test: `tests/news-view.test.mjs`

**Interfaces:**
- **Produces** (all pure functions, returning strings):
  - `relativeTime(value, now = Date.now()): string`
    - `just now` when under 60 s
    - `<n> minute(s) ago`
    - `<n> hour(s) ago`
    - `<n> day(s) ago`
    - `Time unknown` when the value is missing or not a valid date
  - `newsMetrics(metrics, eventCount, {escapeHtml}): string`
    - Four `<article class="news-metric">` items, each with `<span class="news-metric-label">`, `<b>` (the value) and `<p class="news-metric-explain">`.
    - The values are the same as today:
      - Signal index `threatIndex · threatLevel`
      - Live signals `signals ?? eventCount`
      - High priority `highPriority`
      - Sources online `online/total`
    - Missing values show `—`.
    - The explanations (spec example plus three of the same kind):

      | Metric | Explanation |
      |---|---|
      | Signal index | IntelMap's overall activity score |
      | Live signals | Events in the current feed |
      | High priority | Events IntelMap rates as most severe |
      | Sources online | Feeds IntelMap could reach just now |
  - `newsCard(event, {escapeHtml, safeExternalUrl, now}): string`. It returns `<article class="news-card" tabindex="-1">` containing:
    - `badge({text: event.category || event.kind || 'signal'})`
    - `<time datetime="<ISO>">` holding the relative time and `<span class="visually-hidden"> (<exact local date and time>)</span>`. The `datetime` attribute and the exact time are left out when the time is unknown.
    - title, description, source, and country or region (as today)
    - a link "Open source" with `<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in a new tab)</span>`, plus `target="_blank" rel="noopener noreferrer"` and the href from `safeExternalUrl`. The link is left out when there is no `url`.

- [ ] **Step 1: Write the failing tests**

```js
import {relativeTime,newsMetrics,newsCard} from '../public/news-view.js';
const now=Date.parse('2026-11-13T12:00:00Z');
const escapeHtml=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const safeExternalUrl=v=>/^https?:/.test(v)?v:'#';
test('times read as words, and unknown times say so',()=>{
  assert.equal(relativeTime('2026-11-13T11:59:30Z',now),'just now');
  assert.equal(relativeTime('2026-11-13T11:59:00Z',now),'1 minute ago');
  assert.equal(relativeTime('2026-11-13T10:00:00Z',now),'2 hours ago');
  assert.equal(relativeTime('2026-11-10T12:00:00Z',now),'3 days ago');
  assert.equal(relativeTime('',now),'Time unknown');assert.equal(relativeTime('not a date',now),'Time unknown');
});
test('each metric explains itself',()=>{
  const html=newsMetrics({threatIndex:62,threatLevel:'Elevated',signals:120,highPriority:9,sourcesOnline:40,sourcesTotal:42},120,{escapeHtml});
  assert.match(html,/Signal index[\s\S]*62 · Elevated[\s\S]*IntelMap&#39;s overall activity score/);
  assert.equal((html.match(/class="news-metric-explain"/g)||[]).length,4);
  assert.match(newsMetrics(null,0,{escapeHtml}),/—/);
});
test('a news card gives exact time to screen readers and says the link opens a new tab',()=>{
  const html=newsCard({category:'cyber',timestamp:'2026-11-13T10:00:00Z',title:'<b>X</b>',source:'Reuters',url:'https://e.com/a'},{escapeHtml,safeExternalUrl,now});
  assert.match(html,/<time datetime="2026-11-13T10:00:00.000Z">2 hours ago<span class="visually-hidden"> \(/);
  assert.match(html,/Open source<span aria-hidden="true"> ↗<\/span><span class="visually-hidden"> \(opens in a new tab\)<\/span>/);
  assert.doesNotMatch(html,/<b>X<\/b>/);assert.match(html,/class="ui-badge/);assert.match(html,/tabindex="-1"/);
  const unknown=newsCard({title:'t'},{escapeHtml,safeExternalUrl,now});
  assert.match(unknown,/Time unknown/);assert.doesNotMatch(unknown,/datetime=/);assert.doesNotMatch(unknown,/Open source/);
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/news-view.test.mjs`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement `news-view.js`.** It imports `badge` from `./ui.js?v=4`.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `feat(news): news view with readable times and explained metrics`.

---

### Task 2: Wire the News page

**Files:**
- Modify: `public/index.html`, `#news` section
  - **Search field:** replace the icon-only `.filter` label with a visible label, `<label class="filter">Search news<input id="intelNewsFilter" …/></label>`. The ⌕ stays, wrapped in `aria-hidden`.
  - **Status line:** add `<p id="intelNewsStatus" class="news-status" role="status"></p>` above `#intelNewsList`.
  - **Refresh button text:** `Refresh`, with the ↻ as `aria-hidden`. `#intelNewsFreshness` stays next to it.
- Modify: `public/app.js`
  - Remove the local `relativeTime`. Import `relativeTime`, `newsMetrics` and `newsCard` from `./news-view.js?v=1`.
  - `renderIntelNews` uses them.
  - **Loading:** `#intelNewsStatus` reads `Loading news…`, and the list is empty.
  - **Error:** `#intelNewsStatus` reads `Couldn't reach IntelMap. Check your internet connection and try again.`, and the list shows a `Try again` button. Drop the raw technical error from the visible text, and log it with `console.warn` instead.
  - **Loaded:** `#intelNewsStatus` reads `<n> news events loaded`.
  - **Load more** (the `[data-load-more-news]` handler):
    - Remember the old count. After rendering, focus the card at that index (`#intelNewsList .news-card` index `oldLimit`).
    - The load-more button text becomes `Load more news`.
  - `#intelNewsFreshness` reads `Updated <relativeTime>`.
- Test: `tests/news-page.test.mjs` (new)

- [ ] **Step 1: Write the failing tests** (they read the page and app source, as the other page tests do)

```js
test('the news search has a visible label and loading is announced',()=>{
  const news=html.match(/<section id="news"[\s\S]*?<\/section>/)[0];
  assert.match(news,/<label class="filter">[\s\S]*?Search news[\s\S]*?id="intelNewsFilter"/);
  assert.match(news,/id="intelNewsStatus"[^>]*role="status"/);
  assert.match(app,/Loading news…/);
  assert.match(app,/Couldn't reach IntelMap\. Check your internet connection and try again\./);
});
test('Load more moves focus to the first new card',()=>{
  assert.match(app,/data-load-more-news[\s\S]{0,300}querySelectorAll\('#intelNewsList \.news-card'\)\[[^\]]+\]\?\.focus\(\)/);
});
test('news uses the shared view module',()=>{
  assert.match(app,/from '\.\/news-view\.js\?v=\d+'/);
  assert.doesNotMatch(app,/function relativeTime\(/);
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/news-page.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Make the changes above.** Also add CSS in `ui.css`: `.news-status` (muted, `--text-sm`), `.news-metric-explain` (`--text-xs`, muted), and `.news-card:focus-visible` uses the global outline.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `feat(news): labeled search, announced loading and errors, focus follows Load more`.

---

### Task 3: Evidence view module

**Files:**
- Create: `public/evidence-view.js`
- Test: `tests/evidence-view.test.mjs`

**Interfaces:**
- **Produces** (pure functions, returning strings):
  - `caseSummary(record): string`
    - `<n> finding(s): <c> confirmed, <u> not checked yet, <r> ruled out`, counted from `status` (missing counts as `unverified`).
    - Returns `''` for no record.
  - `findingCard(item, {escapeHtml}): string`. It returns `<article class="evidence-card">` with:
    - `<h3>` title
    - `<p class="evidence-meta">` with the found time, plus `· <server>` when there is a server
    - **Status:** a status group `<div role="group" aria-label="Status of <title>" class="status-group">` with three `<button type="button" class="status-option" data-set-status="<stored value>" data-finding="<id>" aria-pressed="true|false">`:
      - **Not checked yet** (icon `○`, stored value `unverified`)
      - **Confirmed** (icon `✓`, stored value `confirmed`)
      - **Ruled out** (icon `✕`, stored value `ruled out`)
      - Each icon sits in an `aria-hidden` span, and the label text comes from `GLOSSARY`.
    - **Note:** `<label for="note-<id>">Note</label>`, a `<textarea id="note-<id>" data-evidence-note="<id>" maxlength="4000" aria-describedby="note-count-<id>">`, then `<p id="note-count-<id>" class="note-count"><len> of 4000 characters</p>` and a `Save note` button (`data-save-note`).
    - **Actions:** `Open` (`data-open-finding="<id>"`) and `Remove` (`data-delete-evidence="<id>"`), both as text buttons. The old × icon is gone.
    - `<p class="fingerprint">` with `term('fingerprint', {visible: true})` followed by `<code>` and `shortFingerprint(sha256)`, imported from `./cases-client.js`.
    - The raw `<pre>` JSON is no longer shown. **Open** shows it in the results panel instead.
  - `evidenceEmpty(kind): string`
    - `kind='no-case'`: `emptyState({title:"You don't have a case yet.", text:"Create one, then use 'Save to evidence' on any search result.", action:<New case button with data-new-case>})`
    - `kind='empty-case'`: `emptyState({title:'This case has no findings yet.', text:'Run a search and save results here.'})`
  - `browserOnlyNotice(count): string`. It returns `<n> findings are saved only in this browser. Move them into this case so they're kept on this Mac.`. When `count` is 1, the verb agrees: "1 finding is saved only in this browser. Move it into this case so it's kept on this Mac." It also includes the existing `Import into a new case` button with id `importBrowserEvidence`.

- [ ] **Step 1: Write the failing tests**

```js
import {caseSummary,findingCard,evidenceEmpty,browserOnlyNotice} from '../public/evidence-view.js';
const item={id:'abcdef123456',title:'<img src=x>"',time:'2026-11-13T10:00:00Z',server:'Open OSINT',status:'ruled out',note:'n'.repeat(4000),sha256:'a'.repeat(64)};
test('the summary counts statuses in plain words',()=>{
  assert.equal(caseSummary({evidence:[{status:'confirmed'},{},{status:'ruled out'},{status:'unverified'}]}),'4 findings: 1 confirmed, 2 not checked yet, 1 ruled out');
  assert.equal(caseSummary({evidence:[{status:'confirmed'}]}),'1 finding: 1 confirmed, 0 not checked yet, 0 ruled out');
  assert.equal(caseSummary(null),'');
});
test('statuses are labeled toggle buttons that keep the stored values',()=>{
  const html=findingCard(item,{escapeHtml});
  assert.match(html,/role="group" aria-label="Status of &lt;img src=x&gt;&quot;"/);
  assert.match(html,/data-set-status="ruled out"[^>]*aria-pressed="true"[^>]*><span aria-hidden="true">✕<\/span>Ruled out/);
  assert.match(html,/data-set-status="unverified"[^>]*aria-pressed="false"[^>]*><span aria-hidden="true">○<\/span>Not checked yet/);
  assert.doesNotMatch(html,/<img src=x>/);
});
test('the note has a label, a limit and a live character count',()=>{
  const html=findingCard(item,{escapeHtml});
  assert.match(html,/<label for="note-abcdef123456">Note<\/label>/);
  assert.match(html,/maxlength="4000" aria-describedby="note-count-abcdef123456"/);
  assert.match(html,/id="note-count-abcdef123456" class="note-count">4000 of 4000 characters</);
});
test('findings open in the results panel and explain their fingerprint',()=>{
  const html=findingCard(item,{escapeHtml});
  assert.match(html,/data-open-finding="abcdef123456">Open</);
  assert.match(html,/data-delete-evidence="abcdef123456">Remove</);
  assert.match(html,/Fingerprint \(SHA-256\)<\/b>: Proves this saved result hasn&#39;t changed\./);
  assert.doesNotMatch(html,/<pre>/);
});
test('empty states and the browser-only notice say what to do',()=>{
  assert.match(evidenceEmpty('no-case'),/You don&#39;t have a case yet\.[\s\S]*Save to evidence[\s\S]*data-new-case/);
  assert.match(evidenceEmpty('empty-case'),/This case has no findings yet\./);
  assert.match(browserOnlyNotice(3),/3 findings are saved only in this browser\. Move them into this case so they&#39;re kept on this Mac\./);
  assert.match(browserOnlyNotice(1),/1 finding is saved only in this browser\. Move it into this case so it&#39;s kept on this Mac\./);
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/evidence-view.test.mjs`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement `evidence-view.js`.** It imports `escapeHtml`, `button`, `emptyState`, `term` and `GLOSSARY` from `./ui.js?v=4` and `./glossary.js`, and `shortFingerprint` from `./cases-client.js`. The `escapeHtml` option exists for symmetry with the other view; use the imported one.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `feat(evidence): finding cards with labeled statuses, note count and plain empty states`.

---

### Task 4: Wire the Evidence page, with confirmation dialogs

**Files:**
- Modify: `public/index.html`
  - **Case bar:**
    - Drop the select's `aria-label`; the wrapping `<label>` text "Case" is the name.
    - The buttons read `New case`, `Rename` and `Delete`. `Delete` keeps `id="deleteCase"`.
  - **Confirmation dialog:** add one shared dialog:
    ```html
    <dialog id="confirmDialog" aria-labelledby="confirmTitle" aria-describedby="confirmMessage">
      <h2 id="confirmTitle"></h2><p id="confirmMessage"></p>
      <div class="dialog-actions"><button type="button" class="ghost" data-confirm="no">Cancel</button><button type="button" class="primary danger" data-confirm="yes"></button></div>
    </dialog>
    ```
- Modify: `public/app.js`
  - **`confirmAction({title, message, confirmLabel}): Promise<boolean>`** (new):
    - It fills the dialog with `textContent` only and opens it with `openDialog`.
    - It resolves `true` only when the user presses the confirm button. Cancel, Escape and a click on the backdrop all resolve `false`.
    - Focus starts on **Cancel**, the safe choice.
  - **Delete case:**
    - Replace its `confirm(...)` with `confirmAction`.
    - Title: `Delete this case?`
    - Message: `"<name>" and its <n> finding(s) will be deleted from this Mac. This can't be undone.`
    - Confirm label: `Delete case`
  - **Remove finding:**
    - Title: `Remove this finding?`
    - Message: `"<title>" will be removed from this case. This can't be undone.`
    - Confirm label: `Remove finding`
  - **`renderEvidence`:**
    - `#caseSummary` uses `caseSummary`.
    - `#evidenceList` uses `findingCard` and `evidenceEmpty`.
    - `#caseImport` uses `browserOnlyNotice`.
  - **Status buttons:** a click on `[data-set-status]` calls `updateFinding(data-finding, {status: <stored value>}, 'Marked <label>')` and keeps focus on the same button after re-rendering (look it up again by `data-finding` and `data-set-status`). Remove the old `change` listener on the select.
  - **Note count:** an `input` listener on `[data-evidence-note]` updates its `#note-count-<id>` to `<len> of 4000 characters`.
  - **Open:** a click on `[data-open-finding]` calls `showResult(item.title, item.result)` for that finding.
  - **New case:** a click on `[data-new-case]` calls `createCase()`.
- Modify: `public/ui.css`
  - `.status-group`: buttons in a row.
  - `.status-option[aria-pressed="true"]`: filled, bold text, a ✓ already visible. It must not rely on color alone.
  - `.note-count`, `.fingerprint`, `.evidence-meta`
  - `.danger`: a red action that meets 4.5:1 with white text. Use `var(--accent)` in light, and check it in dark. If dark `#ff6378` with white text fails, use `color:#071b45` text on it, so the danger button meets 4.5:1 in both themes. Add the pair to the design-tokens test.
- Test: `tests/evidence-page.test.mjs` (new)

- [ ] **Step 1: Write the failing tests**

```js
test('destructive actions ask in a real dialog, starting on Cancel',()=>{
  assert.match(html,/<dialog id="confirmDialog" aria-labelledby="confirmTitle" aria-describedby="confirmMessage">/);
  const fn=app.match(/function confirmAction\(\{title,message,confirmLabel\}\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn,/\.textContent=/);assert.doesNotMatch(fn,/innerHTML/);
  assert.match(fn,/data-confirm="no"[\s\S]*\.focus\(\)/);
  assert.doesNotMatch(app,/\bconfirm\(['`"](?:Delete|Remove)/,'no native confirm() for deletes');
  assert.match(app,/Delete this case\?/);assert.match(app,/Remove this finding\?/);
});
test('the case picker is named by its visible label',()=>{
  assert.doesNotMatch(html,/id="caseSelect" aria-label=/);
  assert.match(html,/<label>Case<select id="caseSelect"/);
});
test('Evidence uses the view module and opens findings in the results panel',()=>{
  assert.match(app,/from '\.\/evidence-view\.js\?v=\d+'/);
  assert.match(app,/data-open-finding[\s\S]{0,200}showResult\(/);
  assert.match(app,/data-set-status[\s\S]{0,300}updateFinding\(/);
  assert.match(app,/note-count-/);
});
```

  Add the danger-button contrast pair to `tests/design-tokens.test.mjs`, in the style of the sidebar test.
- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/evidence-page.test.mjs tests/design-tokens.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Make the changes above.** `confirmAction` is written as `function confirmAction({title,message,confirmLabel}){` on its own line, and its body ends with `}` at column 0.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `feat(evidence): labeled statuses, confirmation dialogs, Open, and plain case summary`.

---

### Task 5: The Export menu

**Files:**
- Modify: `public/index.html`. Replace the three export buttons with a menu button. The three items keep their ids, so the existing click handlers and `downloadReport` stay unchanged.
  ```html
  <div class="menu" id="exportMenu">
    <button type="button" class="ghost" id="exportButton" aria-haspopup="menu" aria-expanded="false" aria-controls="exportItems">Export</button>
    <div role="menu" id="exportItems" aria-labelledby="exportButton" hidden>
      <button type="button" role="menuitem" tabindex="-1" id="reportMarkdown"><b>Report (Markdown)</b><span>A readable report with every finding and its fingerprint.</span></button>
      <button type="button" role="menuitem" tabindex="-1" id="reportHtml"><b>Report (printable page / PDF)</b><span>Open it, then print or save as PDF.</span></button>
      <button type="button" role="menuitem" tabindex="-1" id="exportEvidence"><b>Raw data (JSON)</b><span>The whole case as data, for other tools.</span></button>
    </div>
  </div>
  ```
- Modify: `public/app.js`. Add `setupMenu(button, menu): void`:
  - **Opening:** Enter, Space or ArrowDown on the button opens the menu and focuses the first item. ArrowUp opens it and focuses the last item.
  - **Inside the menu:**
    - ArrowDown and ArrowUp move between items and wrap around.
    - Home and End jump to the first and last item.
    - Enter or Space activates an item. Native button behavior handles that, then the menu closes.
    - Escape closes the menu and returns focus to the button.
    - Tab closes the menu.
  - **Closing:** a click outside closes it.
  - **State:** `aria-expanded` mirrors the menu's state.
  - **Wiring:** call `setupMenu($('#exportButton'), $('#exportItems'))` once.
  - **No case:** `renderEvidence` disables `#exportButton` instead of the three items when there is no case.
- Modify: `public/ui.css`: `.menu` (relative), `[role=menu]` (a positioned panel with a surface background and border), and `[role=menuitem]` (block, left-aligned, at least 44 px, title plus muted description).
- Test: `tests/evidence-page.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
test('Export is one menu button with three described items',()=>{
  assert.match(html,/id="exportButton" aria-haspopup="menu" aria-expanded="false" aria-controls="exportItems">Export</);
  assert.equal((html.match(/role="menuitem"/g)||[]).length,3);
  for(const id of ['reportMarkdown','reportHtml','exportEvidence'])assert.match(html,new RegExp(`role="menuitem" tabindex="-1" id="${id}"`));
});
test('the menu works from the keyboard',()=>{
  const fn=app.match(/function setupMenu\(button,menu\)\{[\s\S]*?\n\}/)[0];
  for(const key of ['ArrowDown','ArrowUp','Home','End','Escape','Tab'])assert.match(fn,new RegExp(`'${key}'`),key);
  assert.match(fn,/aria-expanded/);
  assert.match(app,/\$\('#exportButton'\)\.disabled=/);
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/evidence-page.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement as above.**
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `feat(evidence): one accessible Export menu`.

---

### Task 6: Browser audit and keyboard pass (verification)

- [ ] **Step 1: Set up the test environment.** Start the server on port 4174 with a throwaway token. Serve axe from an untracked `public/__axe-test.js` and delete it at the end. The page's API calls need the token, so open it as `http://127.0.0.1:4174/#access=<that throwaway token>`. That gives you a real local case store under `work/cases/`.
- [ ] **Step 2: Create test data through the app's own UI.** Create a case named `Audit <b>test</b>`. The audit must not touch the user's existing cases: list `work/cases/` before and after, and delete only the case you created, using its Delete button.
- [ ] **Step 3: Add findings to the case.** Save at least two findings into it. Use the results panel's Save button on a rendered result, or `POST /api/cases/<id>/evidence` with the token from the page.
- [ ] **Step 4: Run axe** (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`) on the following, in both themes:
  - Evidence with the case
  - Evidence with no case
  - News (loaded, or its error state if offline)
  - the open confirm dialog
  - the open Export menu

  Expected: zero violations.
- [ ] **Step 5: Keyboard pass.** Check each of these with the keyboard only:
  - Each status button toggles, keeps focus, and is announced as pressed.
  - The note count updates while you type.
  - Open shows the result in the panel, and Escape returns focus to Open.
  - Remove opens the dialog with focus on Cancel. Escape cancels it, and the finding remains.
  - The Export menu: Enter opens it, the arrows move between items, Escape returns to Export.
  - News: Load more puts focus on the first new card.
- [ ] **Step 6: Visual check at 1280 px and 375 px.**
- [ ] **Step 7: Delete the audit case using the app's Delete button.** Confirm that `work/cases/` matches its starting list. Fix any finding in its owning task with a test that fails first, then commit.
