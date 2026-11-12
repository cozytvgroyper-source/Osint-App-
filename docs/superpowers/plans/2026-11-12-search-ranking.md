# Ranked, Results-Only Main Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the main search so the most relevant results come first. By default the window shows only results, each tagged with its tool and server, and every other part of the search moves into one collapsed "Search details" section.

**Architecture:**
- A new DOM-free module, `search-ranking.js`, finds items in each tool's data, scores them against the search subject, and orders the items and the sections.
- `search-report.js` adds the ranking output to the payload as `data.ranking`. This is an addition only.
- A new DOM-free view module, `search-results-view.js`, turns a ranked payload into HTML using rendering helpers passed in from `app.js`. This keeps the logic testable with `node --test` and stops `app.js` from growing.
- `app.js` uses the new view when `ranking` is present and the old layout otherwise.

**Tech Stack:** Plain ES modules in the browser, `node:test`, and Node ≥ 22. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-12-search-ranking-design.md`

**Deviation from the spec (refinement):** Rendering lives in the new `public/search-results-view.js`, not directly in `app.js`. The behavior is the same; the change makes the layout unit-testable. `app.js` changes are limited to wiring.

## Global Constraints

- Only additions to the report payload. Every existing field stays exactly as it is (`report`, `errors`, `sourceLog`, `modulesQueried`, `modulesWithResults`, `durationMs`, `servers`, `finished`, `findingCount`).
- Saved evidence is never rewritten. A payload without `ranking` renders with the current layout.
- Match score: 3 for an exact phrase, 2 for all words, 1 for some words, 0 for none. Sort by score, then direct before context, then the tool's original order.
- Top results holds at most **10** items, and only items with a score of 1 or more.
- The 25-item limit per list still applies (`renderArray`).
- Search details is closed by default, and open when there are no results. Planner Diagnostics appears only in development mode, as today.
- `argsForSearch` output must not change for any existing test.
- Bump the version query on every changed import in `app.js`, and add one (`?v=1`) to each new module's import.
- All text that comes from a tool goes through `escapeHtml`.

## Review Focus

1. **A subject containing regex or punctuation characters** ("C++", "AT&T", "(USA)"): it is matched literally, without throwing. Covered in Task 2.
2. **Item fields that aren't strings** (a numeric `title`, `null` `name`, a nested object): no crash, and those fields are ignored when matching. Covered in Task 2.
3. **Tool data that is a bare string** (Omega's multi-line text output): treated as one single-record item scored on the string. Covered in Task 2.
4. **HTML inside tool data or server names** (`<img onerror>` in a title): escaped in the Top results tags and the section headers. Covered in Task 4.
5. **Sections reordering while a "Show more" is open:** the open state follows the tool through its `data-details-key`, not its position. Covered in Task 4 (the view uses `openKeys`) and Task 5 (`showResult` collects and passes the keys).

---

### Task 1: Shared search subject

**Files:**
- Modify: `public/search-query.js` (around `searchSubject` at line 129 and `argsForSearch` at line 153)
- Test: `tests/search-query.test.mjs`

**Interfaces:**
- Produces: `export function searchSubjectFor(query: string): string`
  - If `extractTarget(query)` finds a target, return `target.value`.
  - Otherwise, apply the `argsForSearch` cleaning that doesn't depend on the tool: strip the protocol, `@`, and the trailing `/`; strip the leading label words; strip the leading recency words and trailing news words; remove `MAP_AREA` and collapse spaces; then return `searchSubject(clean, searchIntent(query).id)`.

- [ ] **Step 1: Write the failing test**

```js
test('the ranking subject is the target, or the phrase without its topic and framing words',()=>{
  assert.equal(searchSubjectFor('OFAC sanctions on Rosneft'),'Rosneft');
  assert.equal(searchSubjectFor('recent earthquakes in Chile'),'Chile');
  assert.equal(searchSubjectFor('example.com whois'),'example.com');
  assert.equal(searchSubjectFor('8.8.8.8 abuse reports'),'8.8.8.8');
  assert.equal(searchSubjectFor('sanctions'),'sanctions');
});
```

Add `searchSubjectFor` to the file's import list.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/search-query.test.mjs`
Expected: FAIL, because `searchSubjectFor` is not exported.

- [ ] **Step 3: Implement `searchSubjectFor`, and make `argsForSearch` use it when there is no target**

`argsForSearch` keeps its own `clean` for the target case and calls `searchSubjectFor(query)` in place of the inline `searchSubject(...)` line.

- [ ] **Step 4: Run the tests to verify they pass, with the old ones unchanged**

Run: `node --test tests/search-query.test.mjs`
Expected: PASS, with every existing `argsForSearch` assertion still passing.

- [ ] **Step 5: Commit**

```bash
git add public/search-query.js tests/search-query.test.mjs
git commit -m "refactor(search): share the search subject for ranking"
```

---

### Task 2: Ranking module

**Files:**
- Create: `public/search-ranking.js`
- Test: `tests/search-ranking.test.mjs`

**Interfaces:**
- Produces: `export function rankResults({subject: string, preferredNames: string[], entries: Array<{tool: {name, serverName, description}, toolLabel: string, data: any}>}): Ranking`
  - `Ranking = {subject, topResults: TopItem[], sections: Section[]}`
  - `TopItem = {toolName, tool, server, score, direct, item}`
  - `Section = {toolName, tool, server, description, direct, single: boolean, matching: object[], nonMatching: object[], facts: object|null}`
  - `tool` is `toolLabel`, the human-readable label. `facts` is the tool's data with its item arrays removed (`null` when `single`), so top-level facts beside a list still render.
- Also exported, for tests: `export function matchScore(text: string, subject: string): 0|1|2|3`

**Rules** (copied from the spec):
- Arrays whose elements are all plain objects are item lists. Item lists are found anywhere in the data, recursively, and their items are combined in the order they appear.
- If there is no item list: a non-empty object, or a non-empty string, is one item (`single: true`). A string becomes `{text: value}` for scoring, but the section's `matching`/`nonMatching` entry holds the original string so `renderRecord` keeps its `<pre>` layout.
- Arrays of strings or numbers are never items.
- The text checked is the string values of `title, name, headline, place, description, summary, snippet, text`. For a single record with none of those, it is all top-level string values. Everything is joined and lowercased.
- Words are split on `/[^\p{L}\p{N}]+/u`. Words of 2 characters or fewer are dropped, unless that leaves none.
- A subject word "is present" when it equals one of the text's words. This is whole-word matching, so "Ros" doesn't match "Rosneft".
- The phrase test is a plain `includes` of the lowercased, trimmed subject in the text, never a `RegExp`.
- An empty subject gives every item a score of 1 and keeps the original order.

- [ ] **Step 1: Write the failing tests**

```js
import {rankResults,matchScore} from '../public/search-ranking.js';
const t=(name,serverName='Open OSINT')=>({name,serverName,description:`${name} description`});
const rank=(entries,subject='Rosneft',preferredNames=[])=>rankResults({subject,preferredNames,entries:entries.map(([name,data])=>({tool:t(name),toolLabel:name,data}))});

test('phrase beats all words beats some words beats none',()=>{
  assert.equal(matchScore('sanctions on bank of america today','Bank of America'),3);
  assert.equal(matchScore('america sued the bank','Bank of America'),2);
  assert.equal(matchScore('a bank in ohio','Bank of America'),1);
  assert.equal(matchScore('unrelated headline','Bank of America'),0);
});
test('direct beats context only when match scores tie',()=>{
  const r=rank([['get_news_rss',{articles:[{title:'Rosneft hit by sanctions'}]}],['get_opensanctions',{results:[{name:'Rosneft'},{name:'Other'}]}]],'Rosneft',['get_opensanctions']);
  assert.deepEqual(r.topResults.map(i=>i.toolName),['get_opensanctions','get_news_rss']);
  const r2=rank([['get_news_rss',{articles:[{title:'Rosneft oil'}]}],['get_opensanctions',{results:[{name:'Ros'}]}]],'Rosneft oil',['get_opensanctions']);
  assert.equal(r2.topResults[0].toolName,'get_news_rss');
});
test('top results stop at 10 and leave out non-matching items',()=>{
  const r=rank([['get_news_rss',{articles:[...Array(15)].map((_,i)=>({title:`Rosneft ${i}`})).concat([{title:'Iran'}])}]]);
  assert.equal(r.topResults.length,10);
  assert.equal(r.sections[0].matching.length,15);
  assert.deepEqual(r.sections[0].nonMatching,[{title:'Iran'}]);
});
test('a record with no item list is one single item',()=>{
  const r=rank([['get_whois',{registrar:'Rosneft Registrar',created:'2001'}]]);
  assert.equal(r.sections[0].single,true);
  assert.equal(r.topResults[0].score,3); // no title-like fields, so all top-level strings are checked
});
test('an empty subject keeps the original order and folds nothing',()=>{
  const r=rank([['get_news_rss',{articles:[{title:'b'},{title:'a'}]}]],'');
  assert.deepEqual(r.sections[0].matching.map(i=>i.title),['b','a']);
  assert.equal(r.sections[0].nonMatching.length,0);
});
test('string arrays are not items and stay in facts',()=>{
  const r=rank([['dns',{domains:['rosneft.ru'],records:[{name:'rosneft.ru A'}]}]]);
  assert.deepEqual(r.sections[0].facts,{domains:['rosneft.ru']});
});
test('sections are ordered by their best item',()=>{
  const r=rank([['a',{items:[{title:'Ros'}]}],['b',{items:[{title:'Rosneft'}]}]],'Rosneft');
  assert.deepEqual(r.sections.map(s=>s.toolName),['b','a']);
});
// Review Focus 1–3
test('subjects with regex characters match literally',()=>{
  assert.equal(matchScore('learning c++ today','C++'),3);
  assert.doesNotThrow(()=>matchScore('x','(USA'));
});
test('non-string fields are ignored, not crashed on',()=>{
  const r=rank([['x',{items:[{title:42,name:null,description:{nested:'Rosneft'}},{title:'Rosneft'}]}]]);
  assert.deepEqual(r.sections[0].matching.map(i=>i.title),['Rosneft']);
});
test('a bare string result is one item scored on its text',()=>{
  const r=rank([['omega_intel','Report\nRosneft owns this']]);
  assert.equal(r.sections[0].single,true);
  assert.equal(r.sections[0].matching[0],'Report\nRosneft owns this');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/search-ranking.test.mjs`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement `rankResults` and `matchScore` in `public/search-ranking.js`**

Use one stable sort with a comparator over `(score desc, direct desc, originalIndex asc)`, where `originalIndex` counts across all entries in plan order. Section order uses each section's first item with the same comparator. A section with no items sorts last.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/search-ranking.test.mjs`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add public/search-ranking.js tests/search-ranking.test.mjs
git commit -m "feat(search): rank results by subject match and direct records"
```

---

### Task 3: Ranking in the search report

**Files:**
- Modify: `public/search-report.js` (`buildSearchReport`)
- Test: `tests/search-report.test.mjs`

**Interfaces:**
- Consumes: `rankResults` from Task 2.
- Produces: `buildSearchReport` takes two new optional arguments, `subject = ''` and `preferredNames = intent?.tools || []`. The returned payload gains `data.ranking: Ranking`, built from the same `data` each report entry shows (after the consolidation step). `entries[].toolLabel = sourceLabel(tool.name)`.

- [ ] **Step 1: Write the failing tests**

```js
test('adds a ranking and leaves every existing field as it was',()=>{
  const outcomes=[done(0,'data',{data:{records:[{name:'other'}]}}),done(1,'data',{data:{records:[{name:'8.8.8.8 route'}]}}),done(2,'empty')];
  const before=parse(buildSearchReport({...base,outcomes}));
  const after=parse(buildSearchReport({...base,outcomes,subject:'8.8.8.8',preferredNames:['get_bgp']}));
  const {ranking,...rest}=after.data;
  assert.deepEqual(rest,(({ranking,...r})=>r)(before.data));
  assert.deepEqual(ranking.sections.map(s=>s.toolName),['get_bgp','get_whois']);
  assert.equal(ranking.topResults[0].server,'Open OSINT');
});
test('sections reorder as later answers arrive',()=>{
  const first=parse(buildSearchReport({...base,subject:'8.8.8.8',outcomes:[done(0,'data',{data:{records:[{name:'8.8 x'}]}})]}));
  assert.deepEqual(first.data.ranking.sections.map(s=>s.toolName),['get_whois']);
  const later=parse(buildSearchReport({...base,subject:'8.8.8.8',outcomes:[done(0,'data',{data:{records:[{name:'8.8 x'}]}}),done(1,'data',{data:{records:[{name:'8.8.8.8'}]}})]}));
  assert.deepEqual(later.data.ranking.sections.map(s=>s.toolName),['get_bgp','get_whois']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/search-report.test.mjs`
Expected: FAIL, because `ranking` is undefined.

- [ ] **Step 3: Call `rankResults` in `buildSearchReport` and add `ranking` to `payload.data`**

Don't change the order or contents of `report`.

- [ ] **Step 4: Run the tests to verify they pass, with the old ones unchanged**

Run: `node --test tests/search-report.test.mjs`
Expected: PASS for all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add public/search-report.js tests/search-report.test.mjs
git commit -m "feat(search): include the result ranking in the search report"
```

---

### Task 4: Results-only view

**Files:**
- Create: `public/search-results-view.js`
- Test: `tests/search-results-view.test.mjs`

**Interfaces:**
- Consumes: the payload `data` from Task 3, meaning `{ranking, report, errors, modulesQueried}`.
- Produces: `export function renderRankedReport(data, helpers): string`
  - `helpers = {escapeHtml, renderArray, renderRecord, renderCategory, renderSources, openKeys: Set<string>|null}`
  - `openKeys === null` means a first render, which uses the defaults. A `Set` means a redraw: a `<details>` is open if and only if its key is in the set.
  - Every `<details>` carries a `data-details-key`: `search-details` for Search details, and `more:<toolName>` for a tool's "Show more".

**Layout** (copied from the spec, in order):
1. `<p class="search-status">`:
   - when finished: `"<N> results from <M> tools"`, where N is the total of `matching` + `nonMatching` across sections and M is the number of sections
   - while running: `"<answered> of <modulesQueried> tools answered…"`, where answered = `modulesQueried` − the length of `report['Still Running'].data.sources`
2. A Top results section. Each item is `renderArray([item.item])` wrapped with `<p class="result-source">${escapeHtml(tool)} · ${escapeHtml(server)}</p>`. It's left out when `topResults` is empty.
3. Per section, a header showing only `tool · server`.
   - `single` sections use `renderRecord(matching[0] ?? nonMatching[0])`.
   - Other sections render `facts` (if not null) with `renderRecord`, then `renderArray(matching)`, then, if there are non-matching items, `<details class="more-results" data-details-key="more:<toolName>"><summary>Show <n> more from <tool></summary>${renderArray(nonMatching)}</details>`.
4. `report['Consolidated Findings']`, if present, via `renderCategory`.
5. `<details class="search-details" data-details-key="search-details">`, open by default only when the ranking has no sections. It contains:
   - `<h3>Search details</h3>`
   - `renderSources(report.Sources)`
   - `renderCategory` for `Still Running`, `Planner Diagnostics` and `Related Links`, each when present
   - errors via `renderArray(errors)`, when there are any
   - a tool-description list built from the sections
6. When there are no sections, a `<p class="empty-copy">No results for this search</p>` comes before Search details.

- [ ] **Step 1: Write the failing tests**

Use stub helpers that return marker strings, for example `renderArray: items=>`[A:${items.length}]``, and the real-looking `escapeHtml`.

```js
test('shows only results by default, with tool and server on each top result',()=>{...
  assert.match(html,/OpenSanctions · Open OSINT/);
  assert.match(html,/<details class="search-details" data-details-key="search-details">/); // closed: no open attribute
  assert.ok(html.indexOf('Top results')<html.indexOf('search-details'));
});
test('folds non-matching items under Show N more',()=>{ assert.match(html,/<details class="more-results" data-details-key="more:get_news_rss"><summary>Show 38 more from News RSS<\/summary>/); });
test('opens Search details and says so when there are no results',()=>{ assert.match(html,/No results for this search/); assert.match(html,/data-details-key="search-details" open/); });
test('reports progress while tools are still running',()=>{ assert.match(html,/3 of 6 tools answered…/); });
test('a redraw keeps open exactly the details that were open',()=>{
  const html=renderRankedReport(data,{...helpers,openKeys:new Set(['more:get_news_rss'])});
  assert.match(html,/data-details-key="more:get_news_rss" open/);
  assert.doesNotMatch(html,/data-details-key="search-details" open/);
});
// Review Focus 4
test('escapes HTML in tool labels and server names',()=>{ assert.doesNotMatch(html,/<img/); assert.match(html,/&lt;img/); });
```

Each `...` is a `data` fixture made by calling `buildSearchReport` from Task 3 and parsing the result. Real payloads keep this test honest.

- **Main fixture:**
  - The plan is `get_opensanctions` (preferred, label `OpenSanctions`, returns `{results:[{name:'Rosneft'}]}`) and `get_news_rss` (label `News RSS`, returns `{articles:[...]}` with 40 items, 2 of whose titles contain "Rosneft").
  - `subject:'Rosneft'`, `preferredNames:['get_opensanctions']`, and both answered.
  - `sourceLabel` maps the names to those labels.
- **No-results fixture:** both tools return `empty`.
- **Running fixture:** a plan of 6 tools, where 3 have answered.
- **Escaping fixture:** the main fixture with `serverName:'<img src=x onerror=1>'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/search-results-view.test.mjs`
Expected: FAIL, because the module was not found.

- [ ] **Step 3: Implement `renderRankedReport`**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/search-results-view.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add public/search-results-view.js tests/search-results-view.test.mjs
git commit -m "feat(search): results-only view with collapsed search details"
```

---

### Task 5: Wire the view into the app

**Files:**
- Modify: `public/app.js`:
  - the imports at lines 3 and 7
  - `renderReadableResult` (line 422)
  - `showResult` (line 434)
  - the search run (around lines 499–517)
- Modify: `public/results.css`
- Test: `tests/ui-polish.test.mjs` (source-level checks, following the file's pattern)

**Interfaces:**
- Consumes: `searchSubjectFor` (Task 1), `buildSearchReport`'s `subject`/`preferredNames` (Task 3), and `renderRankedReport` (Task 4).

**Changes:**
- **Imports:**
  - `search-report.js?v=3`
  - `search-query.js?v=1`
  - `import {renderRankedReport} from './search-results-view.js?v=1'`
- **The search run:** `reportOptions` gains `subject: searchSubjectFor(query)` and `preferredNames: intent.tools`.
- **`renderReadableResult(result, openKeys = null)`:** if `payload?.ranking` is present, return `renderRankedReport(payload, {escapeHtml, renderArray, renderRecord, renderCategory, renderSources, openKeys})`. Otherwise use the existing code, unchanged.
- **`showResult`:** on a refresh, collect the open keys before replacing `innerHTML`, as `new Set([...$('#resultBody').querySelectorAll('details[data-details-key][open]')].map(el => el.dataset.detailsKey))`, and pass them in. On the first open, pass `null`.
- **CSS:** add `.search-status`, `.result-source` (small muted tag), `.more-results > summary` and `.search-details > summary`, using the existing theme tokens in `theme.css`.

- [ ] **Step 1: Write the failing tests**

```js
test('the main search passes its subject and preferred tools to the report',()=>{
  assert.match(app,/subject:searchSubjectFor\(query\)/);
  assert.match(app,/preferredNames:intent\.tools/);
});
test('ranked reports use the results-only view; older saved reports keep the old layout',()=>{
  assert.match(app,/payload\?\.ranking\)return renderRankedReport\(/);
});
test('a live redraw keeps open details open',()=>{
  assert.match(app,/details\[data-details-key\]\[open\]/);
});
test('changed and new modules are imported with a version',()=>{
  assert.match(app,/search-report\.js\?v=3/);
  assert.match(app,/search-results-view\.js\?v=1/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/ui-polish.test.mjs`
Expected: FAIL on the 4 new tests.

- [ ] **Step 3: Make the `app.js` and `results.css` changes above**

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: 0 failed. The total is 249 plus the new tests.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/results.css tests/ui-polish.test.mjs
git commit -m "feat(search): show ranked results first in the main search"
```

---

### Task 6: Live verification

No code changes unless this check finds a problem.

- [ ] **Step 1:** Start the app with `zsh "Start Public Desk.command"` from this checkout. It should open the UI with the launch token.
- [ ] **Step 2:** Search `OFAC sanctions on Rosneft`. Check the following:
  - The status line appears.
  - Top results lists items that mention Rosneft, each tagged with its tool and server.
  - Sanctions sections come before news.
  - Non-matching news sits behind "Show N more".
  - Search details is closed and contains Sources and Related Links.
- [ ] **Step 3:** While tools are still answering, open a "Show more". When the next tool answers, it should stay open.
- [ ] **Step 4:** Open a case item saved before this change. It should render with the old layout.
- [ ] **Step 5:** Use passive tools only. Do not run Deep Search or active tools. Record what you saw in the PR description.
