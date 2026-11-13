# Design Overhaul, Phase 5: One Stylesheet and the Final Audit, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the overhaul in four steps:
1. Delete the three older stylesheets (`styles.css`, `results.css` and `theme.css`), keeping one, `ui.css`, with **no visible change**.
2. Add the theme switch's visible label, which the spec requires and earlier phases left out.
3. Fix three small pre-existing accessibility gaps the phase 3 and 4 reviews flagged.
4. Run one final full audit of every page with real content in both themes.

**Architecture:** The proof that nothing changed visually is a **computed-style snapshot**: every element on every view, in both themes, at desktop and phone widths, recording the properties that affect appearance. It is captured before any CSS change and compared after each change.
- **Dead rules:** rules whose classes nothing produces are deleted first.
- **One file:** the remaining rules are moved into `ui.css` in their current cascade order (`ui → styles → results → theme`), so specificity and source order stay the same.
- **Snapshot use:** the snapshot is a test-browser tool, not shipped code.

**Tech Stack:** Plain HTML, CSS and ES modules, with `node --test` on Node ≥ 22. axe-core and the snapshot script are used only in the test browser and never committed.

**Spec:** `docs/superpowers/specs/2026-11-12-design-overhaul-design.md`, release phase 5 ("Delete the old CSS files and run the final full audit"), plus the page-wide requirement "The theme switch has a visible label and `aria-pressed`".

## Global Constraints

- Plain HTML, CSS and ES modules. No framework, no build step, no new runtime dependencies.
- **No visible change** from the stylesheet merge (Tasks 2 and 3). The computed-style snapshot must be identical before and after, apart from differences that a ruling explains and that the snapshot shows to be dead rules.
- All earlier guarantees hold, and the existing tests (`design-tokens`, `layout`, `mobile-nav`, `ui-polish` and the rest) keep their intent. Tests that read `styles.css`, `results.css` or `theme.css` are pointed at `ui.css`.
  - text sizes 13–34 px
  - contrast 4.5:1 for text and 3:1 for non-text, in both themes
  - a 3 px `:focus-visible` outline and no `outline:0`
  - motion of 150 ms or less, and none under reduced motion
- **Classes built at runtime must keep their rules.** These are `tier-<key>`, `run-risk-<key>`, `self-check-<outcome>` and `source-outcome-<kind>`. Any class that appears inside a `${…}` template counts as used.
- Bump `?v=` on `ui.css` and `app.js`. Remove the three `<link>` tags.

## Review Focus

1. **Dark theme:** `theme.css` holds many `[data-theme="dark"]` rules that override base rules by source order. After merging, every dark rule must still come after the base rule it overrides. The dark-theme snapshot comparison covers this.
2. **Phone width (≤720 px) and collapsed sidebar (≤1050 px):** media-query rules must keep their order relative to the base rules. Covered by the 375 px and 900 px snapshots plus the existing `layout` and `mobile-nav` tests.
3. **Runtime-built classes** (`tier-<key>` and the others listed above) are not deleted as dead code. Covered in Task 2: a test lists them and checks `ui.css` still defines each one.
4. **`[hidden]` handling:** `styles.css` and `ui.css` both carry `[hidden]` rules, e.g. for the Export menu. Merging must keep hidden elements hidden. The snapshot records `display` for hidden elements.
5. **Pages in states the audit hasn't seen:** a results panel with a failing source, an evidence card with a long note, and News filtered to nothing. Covered by the Task 5 audit list.

---

### Task 1: Computed-style snapshot baseline (test-browser tool, not committed)

**Files:**
- Create (scratch only, never committed): `<scratchpad>/style-snapshot.js`. It runs in the browser and exposes `window.styleSnapshot()`, which returns a JSON string.

**Behavior of `styleSnapshot()`:**
- **Elements:** every element under `body`, in document order, keyed by a stable path (tag, id, classes and position among its siblings).
- **Properties recorded:**
  - `display`, `position`, `visibility`, `opacity`
  - `color`, `background-color`, `background-image`
  - `border-*-color`, `border-*-width`, `border-*-style`, `border-*-radius`
  - `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `text-transform`
  - `margin-*`, `padding-*`, `gap`
  - `grid-template-columns`, `flex-direction`, `justify-content`, `align-items`
  - `width`, `height`, rounded to whole pixels
  - `box-shadow`, `outline-*`, `z-index`, `overflow`
- **Inputs:** run per view (`workspace`, `evidence`, `news`, `servers`, `library`, `deep`), per theme (`light`, `dark`) and per width (1280, 900 and 375 px, set with the browser's viewport control). Wait at least 600 ms after each theme switch.
- **Content:** each view is captured with **content**:
  - **Search:** a results panel rendered from a `buildSearchReport` payload. It has two direct results, 14 news items with 2 matching, a WHOIS record with pivots, and one failing source.
  - **Evidence:** a throwaway case with two findings, one of them with a 600-character note.
  - **News:** loaded (or its error state if offline).
  - **Tool library:** stand-in tools rendered through `tools-view.js`.
  - **Deep Search:** at Intrusive with a typed target.
  - **MCP servers:** as the app renders them.

- [ ] **Step 1: Write `style-snapshot.js`** in the scratchpad. A self-check: two calls without a change in between return identical JSON.
- [ ] **Step 2: Capture the baseline on `main` (this branch, before any CSS edit).** Save each result to `<scratchpad>/baseline/<view>-<theme>-<width>.json`. That is 36 files.
- [ ] **Step 3: Record in the ledger** the number of elements per view and the location of the baseline.

---

### Task 2: Delete dead rules

**Files:**
- Modify: `public/styles.css`, `public/results.css`, `public/theme.css`
- Create: `tests/stylesheet.test.mjs`

**Dead classes**, found with the class-usage scan:
- No source produces these classes:
  - `styles.css`: `hero-copy`, `status-pill`, `workflow-grid`, `workflow-icon`, `history-empty`, `connection-name`, `source-strip`, `source-pill`, `deep-hero`, `tool-flags`, `case-exports`, `evidence-review`, `status-confirmed`, `status-ruled-out`, `recommended-badge`
  - `results.css`: `result-summary`, `result-stats`, `server-workflow`, `server-workflow-head`, `server-workflow-foot`
  - `theme.css`: `status-pill`, `workflow-icon`, `result-summary`
- Also dead:
  - `.tier-chip.active`: chips now use `aria-pressed`.
  - `.connection` and `.workflow`: their panels were removed in phase 2.

Before deleting any rule, confirm with a search of `public/` that no `.js` or `.html` file produces the class, as a literal or in a template. A rule whose selector list mixes dead and live classes keeps its live selectors.

- [ ] **Step 1: Write the failing test**

```js
// tests/stylesheet.test.mjs
const sheets=['styles.css','results.css','theme.css','ui.css'].filter(f=>fs.existsSync(new URL(`../public/${f}`,import.meta.url))).map(read).join('\n');
const DEAD=['hero-copy','status-pill','workflow-grid','workflow-icon','history-empty','connection-name','source-strip','source-pill','deep-hero','tool-flags','case-exports','evidence-review','status-confirmed','status-ruled-out','recommended-badge','result-summary','result-stats','server-workflow'];
test('no stylesheet keeps rules for classes nothing produces',()=>{
  for(const name of DEAD)assert.doesNotMatch(sheets,new RegExp(`\\.${name}\\b`),name);
  assert.doesNotMatch(sheets,/\.tier-chip\.active/);
});
test('classes built at runtime keep their rules',()=>{
  for(const name of ['tier-passive','tier-light','tier-active','tier-unreviewed','run-risk-','self-check-','source-outcome-'])assert.match(sheets,new RegExp(`\\.${name}`),name);
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/stylesheet.test.mjs`. Expected: the first test FAILS.
- [ ] **Step 3: Delete the dead rules**, editing selector lists where a rule is only partly dead.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures. Then re-capture the snapshot (Task 1's procedure) and compare it with the baseline. Expected: identical. Dead rules match no element, so no computed value changes.
- [ ] **Step 5: Commit** `refactor(css): remove rules for classes nothing produces`.

---

### Task 3: One stylesheet

**Files:**
- Modify: `public/ui.css`. Append the full contents of `styles.css`, then `results.css`, then `theme.css`, in that order, each under a comment heading such as `/* ---- page and component styles (was styles.css) ---- */`. Do not reorder or rewrite rules inside them.
- Delete: `public/styles.css`, `public/results.css`, `public/theme.css`
- Modify: `public/index.html`. Remove the three `<link>` tags and bump `ui.css?v=`.
- Modify: `tests/design-tokens.test.mjs`, `tests/layout.test.mjs`, `tests/mobile-nav.test.mjs`, `tests/ui-polish.test.mjs`. Every read of the three old files now reads `ui.css`. Every check that compared `ui.css` with "later stylesheets" now checks for later rules within `ui.css`:
  - A rule in the merged file "wins" when it has higher specificity, or equal specificity and comes later.
  - Keep each test's intent: the field borders, the danger button, the tier chips, the font floor, focus and motion.
  - Write a small helper in `tests/helpers/css.mjs`, `rulesAfter(css, index)`, that returns `{selector, body}` for every rule after a position.
- Test: `tests/stylesheet.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('one stylesheet',()=>{
  for(const file of ['styles.css','results.css','theme.css'])assert.equal(fs.existsSync(new URL(`../public/${file}`,import.meta.url)),false,file);
  const html=read('index.html');
  assert.equal((html.match(/<link rel="stylesheet"/g)||[]).length,1);
  assert.match(html,/<link rel="stylesheet" href="\/ui\.css\?v=\d+" \/>/);
});
```

- [ ] **Step 2: Run the test to verify it fails.** Expected: FAIL.
- [ ] **Step 3: Merge the files, delete them, update `index.html` and the tests** as described above.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures. Then compare the snapshot with the baseline across all 36 views, themes and widths. Expected: **identical**.

  Concatenating in the original load order preserves the cascade exactly, so any difference is a bug. The likely causes are a missing rule, or an `@media` block that was split.
- [ ] **Step 5: Commit** `refactor(css): one stylesheet (styles, results and theme merged into ui.css)`.

---

### Task 4: Visible theme label and three small accessibility fixes

These close the spec's theme-switch requirement and three minors from the phase 3 and 4 reviews that affect screen-reader and keyboard users directly.

**Files:**
- Modify: `public/index.html` and `public/app.js`
  - **Theme switch:** `#themeToggle` gets visible text next to its icon, `<span class="theme-label">Dark theme</span>`. `applyTheme` keeps `aria-pressed` and stops setting a changing `title`.
  - **Confirmation dialog:** a click counts as "outside" only if it lands outside the dialog's bounding box (compare `event.clientX` and `event.clientY` with `getBoundingClientRect()`), not anywhere `event.target===dialog`. That includes the dialog's own padding, so a click there no longer cancels.
  - **Repeat confirmations:** `confirmAction` returns `Promise.resolve(false)` when the dialog is already open.
  - **Field errors:** remove `role="alert"` from the error `<p>`s that are in a field's `aria-describedby` (Add MCP server). The error is read once, as part of the focused field.
- Modify: `public/ui.css`: `.theme-label` stays visible except in the collapsed sidebar (≤1050 px), where the icon shows alone. The button keeps its `aria-label="Dark theme"`, which matches the visible text.
- Test: `tests/a11y-structure.test.mjs`, `tests/evidence-page.test.mjs`, `tests/servers-page.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
test('the theme switch has a visible label',()=>{assert.match(html,/id="themeToggle"[\s\S]{0,200}<span class="theme-label">Dark theme<\/span>/);});
test('only a click outside the dialog box cancels a confirmation, and a second ask while one is open is refused',()=>{
  const fn=app.match(/function confirmAction\(\{title,message,confirmLabel\}\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn,/getBoundingClientRect\(\)/);assert.match(fn,/if\(dialog\.open\)return Promise\.resolve\(false\)/);
});
test('field errors are read once, through the field',()=>{assert.doesNotMatch(html,/id="server(?:Name|Endpoint)-error"[^>]*role="alert"/);});
```

- [ ] **Step 2: Run the tests to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement as above.**
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `fix(ui): visible theme label; confirmations ignore clicks inside the box; errors read once`.

---

### Task 5: Final full audit (verification)

- [ ] **Step 1: Set up** as in phases 3 and 4: a server on port 4174 with a throwaway token, axe-core 4.10.2 served from an untracked file, and a 600 ms wait after each theme switch.
- [ ] **Step 2: Run axe** (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa` and `best-practice`) **with content**, in both themes, at 1280 px and 375 px. Expected: zero violations everywhere. Cover:
  - **Search:** empty, and with a results panel with every section expanded, including a failing source
  - **Evidence:** a case with findings (a long note, one finding marked Confirmed), no case, the Export menu open, and the confirmation dialog open
  - **News:** loaded, and filtered to zero results
  - **MCP servers:** the page, the key dialog, and Add MCP server with an error
  - **Tool library:** populated with stand-in tools
  - **Deep Search:** at Passive and at Intrusive
- [ ] **Step 3: Keyboard pass across the whole app** in one session. Check each of these:
  - skip link
  - every nav entry
  - a search with an example
  - results: Show more, Pivot and Escape
  - save to a new case
  - Evidence: status, note, Open and Remove (with Cancel)
  - the Export menu
  - News: Load more
  - Add MCP server with an error
  - tier chips
  - Deep Search through step 3
  - the theme switch
- [ ] **Step 4: Clean up.** Delete the throwaway case using the app's Delete button. Confirm that `work/cases/` and `work/api-keys.env` match their state before the audit. Delete the untracked axe file.
- [ ] **Step 5: Fix and record.** Fix any finding with a test that fails first, re-run `npm test` and the snapshot comparison, and commit. Record the full audit table for the PR.
