# Design Overhaul, Phase 4: MCP servers, Tool library and Deep Search, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three technical pages understandable to a non-technical person without weakening any safety step. On each page:
- **MCP servers:** each server card says what the server is for and what state it's in, in words. The Add MCP server form shows its hints and errors next to the fields.
- **Data sources:** each card leads with what the key improves.
- **Tool self-check:** results are written as text with an icon, not shown by color alone.
- **Tool library:** filters work as toggles and explain each tier, and tool cards say where each tool is used.
- **Deep Search:** the page becomes three numbered steps.

**Architecture:** Server cards and tool cards move into small DOM-free view modules (`public/servers-view.js` and `public/tools-view.js`), unit-tested like the phase 3 views. `app.js` keeps the event handling and safety logic (run grants, confirmations, typed names) and changes only the markup it produces. Every safety check is unchanged.

**Tech Stack:** Plain HTML, CSS and ES modules, with `node --test` on Node ≥ 22. axe-core is used only in the test browser.

**Spec:** `docs/superpowers/specs/2026-11-12-design-overhaul-design.md`, section "4. Technical pages" (release phase 4).

## Global Constraints

- Plain HTML, CSS and ES modules. No framework, no build step, no new runtime dependencies.
- Text sizes (px): 13 / 16 / 18 / 22 / 28 / 34. Nothing below 13.
- Contrast: text 4.5:1; icons, borders and focus 3:1; both themes.
- Focus is a 3 px `:focus-visible`; there is never an `outline:0`. Motion is 150 ms or less, and none under reduced motion.
- **These names stay:** "MCP server", "Tool library", the tier names Passive / Light touch / Active / Intrusive, and "Pivot". "Run grant" is never shown.
- **Safety behavior is unchanged:**
  - run confirmations (acknowledge, authorize, typed name, credits, side effects)
  - the Deep Search typed-target check and authorization checkbox
  - risk tiers, run grants, and the planner's auto-search rules

  Only wording and layout change. The existing tests for tool tiers, run grants, Deep Search, the planner and self-check must pass unchanged.
- **Focus:** after any action that removes or replaces the element the user pressed, focus goes to a sensible element. Phases 1–3 kept finding this gap.
- **Escaping and versions:** every value the view modules interpolate goes through `escapeHtml`. Bump `?v=` on every changed stylesheet or module.

## Review Focus

1. **A custom server or tool whose name or description contains HTML** is escaped on server cards, tool cards and the Deep Search plan. Covered in Tasks 1, 4 and 5.
2. **Add MCP server with a bad endpoint** (empty, `http://` for a custom server, or not a URL): the error appears next to the field, the field gets `aria-invalid`, focus moves to it, and nothing is saved. A bundled loopback address is still accepted. Covered in Task 2.
3. **Disconnect, Disable and Remove on a server card replace or remove the card.** Focus must not be lost: it moves to the same server's new primary button, or to "Add server" when the card is gone. Covered in Task 1.
4. **Tier filter chips:** exactly one chip is `aria-pressed="true"`, and pressing a chip keeps focus on it after the re-render. Covered in Task 4.
5. **Deep Search at the Intrusive level:** the typed-target field still shows and is still required. Moving to the steps layout must not hide or bypass it. Covered in Task 5, whose test runs the existing safety tests together with the new layout assertions.

---

### Task 1: Server cards (`servers-view.js`)

**Files:**
- Create: `public/servers-view.js`, `tests/servers-view.test.mjs`
- Modify: `public/app.js`
  - `renderServers` (line 243) uses `serverCard`.
  - Add focus handling after Disconnect, Disable and Remove.

**Interfaces:**
- **Produces:** `SERVER_PURPOSES`, keyed by bundled endpoint, with the copy from the spec:

  | Server | Purpose |
  |---|---|
  | Open OSINT | Public databases and news feeds; never contacts your target. |
  | OSINT Toolbox | Well-known open-source lookup tools. |
  | Omega MCP | A large toolkit; some tools contact the target and need confirmation. |
  | Consensus | Search published research papers. |

- **Produces:** `serverStatusText(server, toolCount): string`

  | Server state | Text |
  |---|---|
  | `connected` | `Connected · <n> tool(s)` |
  | `needsAuth` | `Needs sign-in` |
  | `connecting` | `Connecting…` |
  | `disconnected` | `Disconnected` |
  | `error` | `Not running` |
  | anything else | `Not connected` |

- **Produces:** `serverCard(server, {bundled, toolCountText}): string`
  - An `<article class="server-card" data-server-card="<id>">` containing:
    - the name as `<h3>`
    - the purpose in `<p class="server-purpose">`, if the server is bundled
    - the status as text in `<p class="server-status">`. The status dot gets `aria-hidden="true"`.
    - the endpoint in small print, as `<p class="endpoint"><span class="visually-hidden">Address: </span>…</p>`
    - the existing caution note
  - **Actions** (same `data-*` hooks as today):

    | State | Buttons |
    |---|---|
    | Connected | `Reconnect` (`data-connect`) and `Disconnect` (`data-disconnect`) |
    | Needs sign-in | `Sign in to Consensus` (`data-consensus-sign-in`) |
    | Otherwise | `Connect`, or `Connecting…` while connecting |

    In every state the card also has `Disable` (bundled) or `Remove` (custom), via `data-remove`.
  - The "STREAMABLE HTTP" badge is removed.
- **App behavior:** after Disconnect or Reconnect re-renders, focus moves to the same card's primary button, found by `data-server-card`. After Disable or Remove, focus moves to `#addServer`.

- [ ] **Step 1: Write the failing tests**

```js
import {serverCard,serverStatusText,SERVER_PURPOSES} from '../public/servers-view.js';
test('bundled servers say what they are for',()=>{
  const html=serverCard({id:'osint-local',name:'Open OSINT',endpoint:'http://127.0.0.1:8892/mcp',status:'connected'},{bundled:true,toolCountText:'107 tools'});
  assert.match(html,/Public databases and news feeds; never contacts your target\./);
  assert.match(html,/Connected · 107 tools/);
  assert.match(html,/data-connect="osint-local">Reconnect</);assert.match(html,/data-disconnect="osint-local">Disconnect</);
  assert.match(html,/data-remove="osint-local">Disable</);
  assert.doesNotMatch(html,/STREAMABLE HTTP/);
  assert.equal(Object.keys(SERVER_PURPOSES).length,4);
});
test('status reads as words',()=>{
  assert.equal(serverStatusText({status:'offline',error:'x'}),'Not running');
  assert.equal(serverStatusText({needsAuth:true}),'Needs sign-in');
  assert.equal(serverStatusText({status:'connecting'}),'Connecting…');
  assert.equal(serverStatusText({status:'offline'}),'Not connected');
});
test('custom servers are escaped and removable',()=>{
  const html=serverCard({id:'c1',name:'<img src=x>',endpoint:'https://e.com/mcp',status:'offline'},{bundled:false});
  assert.doesNotMatch(html,/<img src=x>/);assert.match(html,/data-remove="c1">Remove</);assert.doesNotMatch(html,/server-purpose/);
});
```

  Also, in `tests/ui-polish.test.mjs` or a new `tests/servers-page.test.mjs`, check `app.js` source for the focus moves:
  - `data-server-card` lookup followed by `.focus()` after connect and disconnect
  - `$('#addServer').focus()` after remove
- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/servers-view.test.mjs`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement the module and wire it in.** Use `toolCountHtml(server)` from `app.js` for `toolCountText` (the existing label with health info). Pass it in as text; the view escapes it.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `feat(servers): server cards that say what each server is for and its state in words`.

---

### Task 2: Add MCP server form

**Files:**
- Modify: `public/index.html` (`#serverDialog`). Each field becomes a visible label, an input, a hint and an error:

  | Field | Hint (`aria-describedby`) | Error slot |
  |---|---|---|
  | Name (`#serverName`) | `A name you'll recognize.` | `#serverName-error` |
  | Endpoint (`#serverEndpoint`) | `Must start with https://` | `#serverEndpoint-error` |
  | Bearer token (`#serverToken`) | `Kept only until you close this tab.` | (none) |

  Each error `<p class="field-error" role="alert">` starts empty. The existing form note stays.
- Modify: `public/app.js`, the `#saveServer` handler (line 696). Add `validateServerForm({name, endpoint}): {field, message} | null`:
  - No name: `{field:'serverName', message:'Enter a name for this server.'}`
  - No endpoint: `{field:'serverEndpoint', message:'Enter the server address.'}`
  - An endpoint that isn't a URL: `{field:'serverEndpoint', message:"That isn't a web address. It should look like https://example.com/mcp."}`
  - A non-`https:` endpoint that isn't one of the three bundled loopback URLs: `{field:'serverEndpoint', message:'Custom servers must use https://.'}`
  - Otherwise `null`.

  On an error, the handler writes the message into the field's error slot, sets `aria-invalid="true"` on the field, focuses it, and saves nothing. The errors and `aria-invalid` are cleared each time the dialog opens and each time a field is edited.
- Export `validateServerForm` for testing by moving it into `servers-view.js`; `app.js` imports it.
- Test: `tests/servers-view.test.mjs`, `tests/a11y-structure.test.mjs` (the label check already covers new inputs)

- [ ] **Step 1: Write the failing tests**

```js
import {validateServerForm} from '../public/servers-view.js';
test('the add-server form explains what is wrong, field by field',()=>{
  assert.deepEqual(validateServerForm({name:'',endpoint:'https://e.com/mcp'}),{field:'serverName',message:'Enter a name for this server.'});
  assert.deepEqual(validateServerForm({name:'x',endpoint:''}),{field:'serverEndpoint',message:'Enter the server address.'});
  assert.equal(validateServerForm({name:'x',endpoint:'not a url'}).field,'serverEndpoint');
  assert.deepEqual(validateServerForm({name:'x',endpoint:'http://e.com/mcp'}),{field:'serverEndpoint',message:'Custom servers must use https://.'});
  assert.equal(validateServerForm({name:'x',endpoint:'http://127.0.0.1:8893/mcp'}),null);
  assert.equal(validateServerForm({name:'x',endpoint:'https://e.com/mcp'}),null);
});
```

  Add a source test that `index.html` has `id="serverEndpoint" … aria-describedby="serverEndpoint-hint serverEndpoint-error"` and the hint text `Must start with https://`.
- [ ] **Step 2: Run the tests to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement as above.**
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `feat(servers): the add-server form shows hints and errors next to each field`.

---

### Task 3: Data sources and Tool self-check

**Files:**
- Modify: `public/app.js`
  - `renderDataSources` (line 256)
    - Each card starts with `<h3>` name, then the improvement as `<p class="source-improves">` with the source's `improves` text (it now leads), then the status in words.
    - The status in words comes from `SOURCE_STATUS`. The status dot gets `aria-hidden`.
    - "Feeds …" moves to small print.
    - "Get a key ↗" gets `<span class="visually-hidden"> (opens in a new tab)</span>` and an `aria-hidden` arrow.
    - The "API KEY" badge is removed.
  - `renderSelfCheck` (line 325)
    - The result cell becomes an icon plus text. The icons are aria-hidden:

      | Result | Cell |
      |---|---|
      | Working | `✓ Working` |
      | Returned nothing | `○ Returned nothing` |
      | Failing | `✕ Failing` |
      | Skipped | `– Skipped` |

    - Every `<th>` gets `scope="col"`.
  - `loadDeepHistory`: every `<th>` gets `scope="col"`.
- Modify: `public/index.html`: the self-check heading reads `Tool self-check: test that each search tool still works`.
- Test: `tests/servers-page.test.mjs` (source checks)

- [ ] **Step 1: Write the failing tests**

```js
test('data source cards lead with what the key improves',()=>{
  const fn=app.match(/function renderDataSources\(\)\{[\s\S]*?\n\}/)[0];
  assert.ok(fn.indexOf('source-improves')<fn.indexOf('SOURCE_STATUS'),'improvement before status');
  assert.doesNotMatch(fn,/API KEY/);
  assert.match(fn,/\(opens in a new tab\)/);
});
test('self-check results are words with an icon, and tables have column headers',()=>{
  assert.match(app,/✓ Working|'✓','Working'/);
  assert.doesNotMatch(app,/<th>(?!<)/,'every th has scope');
  assert.match(html,/Tool self-check: test that each search tool still works/);
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement as above.**
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures, including `tests/self-check.test.mjs` unchanged.
- [ ] **Step 5: Commit** `feat(servers): data sources lead with their benefit; self-check results in words`.

---

### Task 4: Tool library (`tools-view.js`)

**Files:**
- Create: `public/tools-view.js`, `tests/tools-view.test.mjs`
- Modify: `public/app.js` (`renderTools` at line 290 uses the module; its chip click handler restores focus).
- Modify: `public/search-planner.js` `toolUsage`: the wording becomes `Used by the main search` / `Tool library only`. Update `tests/tool-tiers.test.mjs`'s two `toolUsage` assertions to the new wording.

**Interfaces:**
- **Produces:** `tierChips(chips, active): string`
  - `chips` is `[{key, label, count, explain}]`.
  - Each chip is a `<button type="button" class="tier-chip" data-tier-filter="<key>" aria-pressed="<key===active>">` holding `<span class="tier-chip-label">label</span> <span class="tier-chip-count">count</span>` and `<span class="tier-chip-explain">explain</span>`.
  - The "All" chip's explanation is `Every tool from your connected MCP servers.` The tier chips use `GLOSSARY[tier.key].explain`, i.e. the `TIERS` text.
- **Produces:** `toolCard(tool, {risk, usage}): string`. It returns `<article class="tool-card">` with:
  - `<h3><code>name</code></h3>`
  - the tier as `badge({text: risk.label, tone})`, where `tone` is `safe` for Passive, `warn` for Light touch and Active, and `danger` for Intrusive or unreviewed
  - `<p class="tool-meta">server · usage</p>`
  - the description, keeping the existing line clamp and its `title` attribute holding the full text
  - each flag written out in a `<p class="tool-flag">`:
    - `credits`: `Uses paid AI credits`
    - `side-effects`: `Has side effects: it may send, store, schedule or change data`
  - the existing run button
- **App behavior:** after a chip press re-renders, focus moves to the chip with the same `data-tier-filter`.
- Modify: `public/index.html`, run dialog: the arguments label becomes `Tool settings (JSON)`, with a hint `<p id="runArgs-hint" class="field-hint">Leave as {} to use the defaults.</p>` referenced by `aria-describedby`.

- [ ] **Step 1: Write the failing tests**

```js
import {tierChips,toolCard} from '../public/tools-view.js';
test('tier chips are toggles that explain each tier',()=>{
  const html=tierChips([{key:'all',label:'All',count:10,explain:'Every tool from your connected MCP servers.'},{key:'active',label:'Active',count:2,explain:'Probing …'}],'active');
  assert.match(html,/data-tier-filter="all" aria-pressed="false"/);assert.match(html,/data-tier-filter="active" aria-pressed="true"/);
  assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
  assert.match(html,/Every tool from your connected MCP servers\./);
});
test('tool cards say where a tool is used and write out its flags',()=>{
  const html=toolCard({name:'omega_aisummary',serverName:'Omega MCP',description:'<b>d</b>'},{risk:{label:'Passive',key:'passive',flags:['credits']},usage:'Tool library only'});
  assert.match(html,/Omega MCP · Tool library only/);assert.match(html,/Uses paid AI credits/);
  assert.match(html,/class="ui-badge ui-badge-safe"/);assert.doesNotMatch(html,/<b>d<\/b>/);
});
```

  Add a source test that the run dialog has `Tool settings (JSON)` and `aria-describedby="runArgs-hint"`.
- [ ] **Step 2: Run the tests to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement and wire in.** Keep the existing run-button `data-*` hook and everything in the run dialog's safety logic.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures, including `tool-tiers` with its two updated `toolUsage` strings.
- [ ] **Step 5: Commit** `feat(tools): tier filters explain themselves; tool cards say where each tool is used`.

---

### Task 5: Deep Search in three steps

**Files:**
- Modify: `public/index.html`, `#deep`, regrouped into three `<section class="deep-step" aria-labelledby="deep-step-<n>">`, each with an `<h2 id="deep-step-<n>">`:
  1. **`1. Choose a target and level`:** the existing target input and level select, plus `<p id="deepLevelExplain" class="field-hint" aria-live="polite">` showing the selected level's explanation (from `TIERS[level].targetSees`), plus Build plan.
  2. **`2. Review the plan`:** the existing `#deepPlan`.
  3. **`3. Confirm and run`:** the existing `#deepConfirmations` block, unchanged inside: the authorization checkbox, the typed-target field, the error, Cancel and Run.

  The run log (`#deepLog`, `aria-live="polite"`) and Run history stay below.
- Modify: `public/app.js`. On load and on `#deepLevel` change, set `#deepLevelExplain` to that level's `TIERS` text. The existing `#deepTypedWrap` visibility logic stays exactly as it is.
- Test: `tests/deep-page.test.mjs` (new). Also run the existing `tests/deep-search.test.mjs` and `tests/run-grants.test.mjs` unchanged.

- [ ] **Step 1: Write the failing tests**

```js
const deep=html.match(/<section id="deep"[\s\S]*?<\/section>\s*<section id="news"/)?.[0]||html.match(/<section id="deep"[\s\S]*?<div class="deep-history"/)[0];
test('Deep Search reads as three numbered steps',()=>{
  for(const [n,title] of [[1,'1. Choose a target and level'],[2,'2. Review the plan'],[3,'3. Confirm and run']])
    assert.match(deep,new RegExp(`aria-labelledby="deep-step-${n}"[\\s\\S]*?<h2 id="deep-step-${n}">${title.replace('.','\\.')}</h2>`));
});
test('the safety steps are still all there',()=>{
  for(const id of ['deepAuthorize','deepTypedWrap','deepTypedTarget','runDeepSearch','cancelDeepRun'])assert.match(deep,new RegExp(`id="${id}"`),id);
  assert.match(app,/\$\('#deepTypedWrap'\)\.hidden=Number\(\$\('#deepLevel'\)\.value\)!==3/);
});
test('the chosen level is explained',()=>{
  assert.match(deep,/id="deepLevelExplain"[^>]*aria-live="polite"/);
  assert.match(app,/#deepLevelExplain[\s\S]{0,120}TIERS\[/);
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Regroup the markup and add the explanation.** Use `ui.css` for `.deep-step` (a card with a step heading at `--text-lg`).
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures, including `deep-search` and `run-grants` unchanged.
- [ ] **Step 5: Commit** `feat(deep): Deep Search as three numbered steps with each level explained`.

---

### Task 6: Browser audit and keyboard pass (verification)

- [ ] **Step 1: Set up.** Start the server on port 4174 with a throwaway token, opening it as `http://127.0.0.1:4174/#access=<token>`. Load axe from an untracked `public/__axe-test.js` and delete it at the end. Wait at least 600 ms after each theme switch before measuring: theme transitions run 150 ms, and phase 3 showed that measuring mid-transition gives false contrast failures.
- [ ] **Step 2: Audit with axe in both themes.** Expected: zero violations at any impact on each of these:
  - MCP servers. Without the launcher the bundled servers can't connect, so cards show "Not running" or "Not connected", which still exercises the layout.
  - Data sources, and the open key dialog.
  - Tool self-check results. Without tools it shows its empty message.
  - Tool library. With no servers connected it shows its empty state.
  - The Add MCP server dialog with an endpoint error showing.
  - Deep Search at Passive and at Intrusive level, with a typed target.
- [ ] **Step 3: Keyboard pass.**
  - **Add MCP server:** submitting a bad endpoint focuses the field and the error is announced. Escape closes the dialog and returns focus to Add server.
  - **Server card:** Disable moves focus to Add server. Re-adding a bundled server uses its address.
  - **Deep Search:** level changes update the explanation, Intrusive shows the typed-target field, and Build plan shows the plan.
  - **Tier chips** are reachable and keep focus when pressed. This needs tools, so check it with a fake tool list in the test browser if no servers connect.
- [ ] **Step 4: Visual check at 1280 px and 375 px** of all three pages.
- [ ] **Step 5: Leave your servers and data as they were.** The audit uses the browser's localStorage for this origin only. Remove any server added during the test with its Remove button. Leave `work/api-keys.env` untouched: don't connect or remove a data source during the audit, only open and cancel the key dialog.
- [ ] **Step 6: Fix and record.** Fix any finding with a test that fails first, then commit.
