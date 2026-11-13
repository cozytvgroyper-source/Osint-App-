# Deep Search Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Deep Search into a one-box search that runs every fitting reviewed tool for the chosen level, follows leads for people, shows a live progress page, and ends on a results page that shows only linked, sourced findings.

**Architecture:**
- Three DOM-free modules do the work: `deep-search.js` (detection and tool choice), `deep-adapters.js` (reads raw answers into findings) and `deep-linking.js` (decides linked, possible or dropped, plus leads).
- `deep-engine.js` drives the run inside the page, using injected `callTool` and `requestGrant` functions.
- Two DOM-free view modules render the progress and results pages; `app.js` only wires events and focus.
- The server gains long-call and grant rules for Deep Search, and a run store.

**Tech Stack:** Plain HTML, CSS and ES modules; Node ≥ 22 `node --test`; no framework, no build step, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-13-deep-search-redesign-design.md` (approved 2026-11-13). Section numbers below (§) refer to it.

## Global Constraints

- **No new tech:** no new runtime dependencies, no build step, no framework. The CSP stays `script-src 'self'; style-src 'self'`, so there is no inline script or style.
- **View modules** are DOM-free and return escaped HTML strings built with `ui.js` (`escapeHtml`, `button`, `card`, `badge`, `emptyState`, `term`).
- **Accessibility:** WCAG 2.2 AA in both themes at 1280 and 375 px.
  - 3 px `:focus-visible`
  - `<details>` for folds
  - polite status lines written only when their text changes
  - `prefers-reduced-motion` respected
  - colour never the only signal
- **Heading order** in every Deep Search view:
  - h1: page
  - h2: card or section
  - h3: group
  - h4: item
- **Words:**
  - Keep "MCP server", "Tool library", "Passive", "Light touch", "Active", "Intrusive" and "Pivot".
  - Never show "Run grant".
  - Pivot button names start with "Pivot".
  - External links say "(opens in a new tab)".
- **Safety:**
  - Unreviewed tools count as Intrusive.
  - Tools flagged `credits` or `side-effects`, or annotated `readOnlyHint:false` or `destructiveHint:true`, never run in Deep Search.
  - Person lookups are Passive only.
  - Websites discovered in a person search get at most Light touch.
  - Active needs "I own this target or have written permission"; Intrusive also needs the typed target.
- **Limits:**
  - Passive concurrency: 4.
  - Light touch and higher: one at a time.
  - Per-tool timeout: 120 000 ms by default, never above 600 000 ms.
  - Lead rounds: 3. Identifiers per run: 25.
  - Grant lifetime: at most 30 min; at most 25 calls per grant.
  - Raw answer: 1 MB per tool and 20 MB per run.
- **Git:**
  - Work on branch `deep-search/redesign`.
  - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Stage explicit paths only.
  - Never commit `public/__*`, `.superpowers/` or anything under `tests/fixtures/deep/raw/`.
- **Cache-busting:** bump `?v=` on every changed module and its importers, and on `ui.css` and `app.js` in `index.html`. One version per module everywhere it's imported.

## Review Focus

1. **The same account found by several tools or rounds** (Maigret and Sherlock both report `github.com/ownername88`, once with a trailing slash) is shown **once**, with every source. *Test: Task 5, `the same profile from two tools is one finding with both sources`.*
2. **Lead loops and repeats.**
   - A profile links back to the seed, or the seed comes back as `@OwnerName88`.
   - Two profiles link to each other.

   Nothing is searched twice, and the run ends after round 3. *Tests: Task 5, `normalised identifiers are never searched twice`; Task 6, `a lead loop ends without repeating calls`.*
3. **Messy input.** Each of these is detected and normalised correctly:
   - `Owner.Name+news@Example.COM ` → email `owner.name+news@example.com`
   - `@OwnerName88` → username `ownername88`
   - `https://Example.com/about` → domain `example.com`
   - `owner example` → unsupported

   *Test: Task 2, `detects and normalises messy input`.*
4. **A tool answers with something huge or malformed** (a 3 MB string, invalid JSON, a server that drops mid-call). The run continues: the answer is trimmed with a note, and the tool is listed as failed or trimmed under Search details. *Tests: Task 4, `malformed answers become one dropped finding, not a crash`; Task 6, `a failing and an oversized tool do not stop the run`.*
5. **Leaving Deep Search mid-run and coming back**, or pressing Start again. The same run's progress shows and no second run starts. *Test: Task 9, `a second start while a run is going is refused and the progress view returns`.*

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/record-deep-fixtures.mjs` (new) | Dev-only recorder: calls every Deep Search tool through the local server on owner identifiers, writes raw answers to `tests/fixtures/deep/raw/` and sanitized copies to `tests/fixtures/deep/`. |
| `docs/deep-tool-review.md` (new) | Per-tool record of real input and output, the corrected `DEEP_TOOLS` table, the severity table and the account-kind table. |
| `public/deep-search.js` (rewrite) | `detectDeepTarget`, `normalizeIdentifier`, `DEEP_TOOLS`, `deepToolsFor`, `deepRunBlocked`. |
| `public/deep-adapters.js` (new) | `adaptToolResult`: one tool answer to findings, with per-tool adapters and a generic fallback, severity and account kind. |
| `public/deep-linking.js` (new) | `linkFindings`: statuses, reasons, trails, merged duplicates, leads. |
| `public/deep-engine.js` (new) | `runDeepSearch`: rounds, scheduling, grants, cancel, events, the run record. |
| `public/deep-progress.js` (new) | Progress state reducer, time estimate, progress view HTML. |
| `public/deep-results-view.js` (new) | Person and site results HTML, and the evidence record. |
| `scripts/run-grants.mjs` (modify) | Deep Search ttl cap, acknowledgement-only grants at Light touch and below, run ids, eviction order, release. |
| `scripts/deep-call-timeout.mjs` (new) | `deepCallTimeout`: the server-side allow-list for long calls. |
| `scripts/deep-search-runs.mjs` (new) | `DeepRunStore`: save and read run files. |
| `scripts/deep-search-audit.mjs` (modify) | Audit entries take `runId` and `toolCount`. |
| `server.mjs` (modify) | Wires the timeout rule, the release route and the run routes. |
| `public/index.html`, `public/app.js`, `public/ui.css` (modify) | The new Deep Search page, progress and results wiring, and styles. |

### Shared data shapes (used across tasks)

```js
// Identifier
{type:'email'|'username'|'phone'|'domain'|'ip'|'cve'|'hash', value:string}
// Finding (from adapters; linking adds status/reason/trail/sources)
{id:string, kind:'account'|'breach'|'fact'|'host'|'problem'|'lead',
 subject:Identifier,            // what the tool was asked about
 tool:{name:string, serverName:string},
 evidence:{emails:string[], usernames:string[], phones:string[], urls:string[], names:string[], places:string[]},
 account?:{site:string, url:string, displayName?:string, category:'social'|'developer'|'forums'|'shopping'|'other', verified:boolean},
 breach?:{name:string, date?:string},
 fact?:{label:string, value:string, group:'owner'|'hosting'|'tech'|'email'|'certificate'|'history'|'other'},
 host?:{value:string, relation:'subdomain'|'ip'|'related'|'lookalike'|'mx'|'archive'},
 problem?:{severity:'high'|'medium'|'low', title:string, meaning:string, fix:string},
 lead?:Identifier}
// Linked finding
Finding & {status:'linked'|'possible'|'dropped', reason:string,
           trail:{from:Identifier, tool:string, note:string}[], sources:{name:string, serverName:string}[]}
// Run record (engine output, stored by the server, read by the results view)
{id:string, target:Identifier, level:0|1|2|3, startedAt:string, finishedAt:string,
 outcome:'completed'|'stopped'|'failed', rounds:number,
 calls:{tool:string, serverName:string, identifier:Identifier, outcome:'data'|'empty'|'error'|'trimmed', error?:string, ms:number}[],
 findings:LinkedFinding[], leadsNotFollowed:Identifier[], raw:{[callKey:string]:string}}
```

`callKey` is `` `${serverName}::${tool}::${identifier.type}:${identifier.value}` ``. `account.verified` is `true` only when the tool itself checked the identifier, as for Holehe, GHunt and breach lists (§7.1 rule 1).

---

## PR 1: engine, answer reading and server

### Task 1: Record real tool answers and correct the tool table

**Needs the owner.** Ask for:
- their email, a username and optionally a phone number
- a website and an IP address they own

Also ask them to start the app from `Start Public Desk.command`, so the MCP servers on 8892, 8893 and 8894 are running. Read the access token from `work/runtime/public-desk-token`; never print it.

**Files:**
- Create: `scripts/record-deep-fixtures.mjs`, `docs/deep-tool-review.md`, `tests/fixtures/deep/*.json`
- Modify: `.gitignore` (add `tests/fixtures/deep/raw/`)

**Interfaces:**
- Produces: `tests/fixtures/deep/<tool>.json`, each holding `{tool, serverName, identifier, args, ms, result}`. The MCP `result` is kept as returned, with owner values replaced by the stand-ins `owner@example.com`, `ownername`, `+15555550100`, `owner-site.example` and `192.0.2.10`. Later tasks read these.
- Produces: `docs/deep-tool-review.md`, with:
  - the tool table (type, level, input field, a 2–3 line summary of output shape, a notes column)
  - the severity table (tool, condition, severity, plain meaning, fix)
  - the account-kind table (site → category)

- [ ] **Step 1: Write the recorder.**
  - **Usage:** `node scripts/record-deep-fixtures.mjs --email E --username U [--phone P] --domain D --ip I --level 3`
  - **Which tools:**
    - It calls `tools/list` on the three local endpoints through `POST /api/mcp`, with header `x-public-desk-token` and `origin: http://127.0.0.1:4173`.
    - Every tool named in spec §6.6, and every other reviewed, unflagged Passive tool whose description fits a type, gets called once.
  - **Arguments and permissions:**
    - Arguments come from `argsForSearch` plus the §6.2 overrides.
    - Calls above Passive get a `deep-search` grant with `confirmation:{acknowledged:true,authorization:true,typedTarget:<target>}`.
    - Grant calls request `deepSearch:true` with `timeoutMs:600000`. *(Task 3 adds server support. Until then, run the recorder after Task 3, or accept timeouts for slow tools and re-record them.)*
  - **Output:**
    - Raw answers go to `tests/fixtures/deep/raw/`.
    - Sanitized copies go to `tests/fixtures/deep/`.
    - The script prints a summary table (tool, ms, bytes, outcome) and never prints the token or the identifiers.
- [ ] **Step 2: Run it with the owner's identifiers.** Check `git status`: `raw/` must be ignored. Spot-check that no owner value appears in the committed copies:

  ```bash
  grep -rniF "<owner value>" tests/fixtures/deep/*.json
  ```

  Expected: no output. The owner's values come only from chat; put them in a scratchpad file, never in the repo.
- [ ] **Step 3: Write `docs/deep-tool-review.md` from the recordings.** Correct the §6.6 table: move or remove tools whose real input or output doesn't fit, with the reason. Write the severity and account-kind tables. **Show the owner the changes to the tool table** before committing; it is their reviewed list.
- [ ] **Step 4: Commit.**

  ```bash
  git add scripts/record-deep-fixtures.mjs docs/deep-tool-review.md tests/fixtures/deep/*.json .gitignore
  git commit -m "test: record real Deep Search tool answers and review the tool table"
  ```

### Task 2: Target detection and tool choice

**Files:**
- Rewrite: `public/deep-search.js`
- Test: `tests/deep-search.test.mjs` (replace its tests; keep the checks that every listed tool exists in `tests/fixtures/mcp-tools.json`, is unflagged and is read-only)

**Interfaces:**
- Consumes: `extractTarget` (`search-query.js`), `toolRisk` (`tool-tiers.js`), the corrected table from Task 1.
- Produces:
  - `detectDeepTarget(text:string) -> Identifier|null`
  - `normalizeIdentifier(id:Identifier) -> Identifier`
  - `isPersonType(type) -> boolean` (email, username, phone)
  - `DEEP_TOOLS: {[type]: {name:string, timeoutMs?:number, args?:object}[]}`
  - `deepToolsFor(tools, {type, level, excluded=new Set()}) -> {tool, args, risk, timeoutMs}[]`
  - `deepArgs(tool, identifier) -> object`
  - `deepRunBlocked({target, level, authorization, typedTarget, person}) -> string`

- [ ] **Step 1: Write the failing tests.**

  ```js
  test('detects and normalises messy input',()=>{
    assert.deepEqual(detectDeepTarget(' Owner.Name+news@Example.COM '),{type:'email',value:'owner.name+news@example.com'});
    assert.deepEqual(detectDeepTarget('@OwnerName88'),{type:'username',value:'ownername88'});
    assert.deepEqual(detectDeepTarget('ownername88'),{type:'username',value:'ownername88'});
    assert.deepEqual(detectDeepTarget('https://Example.com/about'),{type:'domain',value:'example.com'});
    assert.deepEqual(detectDeepTarget('8.8.8.8'),{type:'ip',value:'8.8.8.8'});
    assert.deepEqual(detectDeepTarget('+1 (415) 555-2671'),{type:'phone',value:'+14155552671'});
    assert.deepEqual(detectDeepTarget('cve-2024-3094'),{type:'cve',value:'CVE-2024-3094'});
    assert.deepEqual(detectDeepTarget('D41D8CD98F00B204E9800998ECF8427E'),{type:'hash',value:'d41d8cd98f00b204e9800998ecf8427e'});
    assert.equal(detectDeepTarget('owner example'),null);
    assert.equal(detectDeepTarget('a'),null);
  });
  test('person searches use Passive tools only, at any level',()=>{
    const picked=deepToolsFor(FIXTURE_TOOLS,{type:'email',level:3});
    assert.ok(picked.length>=Object.keys(DEEP_TOOLS.email).length-1);
    assert.ok(picked.every(p=>p.risk.level===0));
  });
  test('website tools grow with the level and are never capped',()=>{
    const counts=[0,1,2,3].map(level=>deepToolsFor(FIXTURE_TOOLS,{type:'domain',level}).length);
    assert.ok(counts[0]<counts[1]&&counts[1]<counts[2]&&counts[2]<counts[3]);
    assert.equal(counts[3],DEEP_TOOLS.domain.filter(e=>FIXTURE_TOOLS.some(t=>t.name===e.name)).length);
  });
  test('flagged, unreviewed, write-annotated and excluded tools never appear',()=>{
    const tools=[...FIXTURE_TOOLS,{name:'omega_ports',serverName:'Custom',serverId:'x'},{...FIXTURE_TOOLS.find(t=>t.name==='omega_headers'),annotations:{readOnlyHint:false}}];
    const names=deepToolsFor(tools,{type:'domain',level:3,excluded:new Set(['omega_ssl'])}).map(p=>`${p.tool.serverName}:${p.tool.name}`);
    assert.ok(!names.includes('Custom:omega_ports'));assert.ok(!names.some(n=>n.endsWith(':omega_ssl')));
    assert.equal(names.filter(n=>n.endsWith(':omega_headers')).length,1);
    for(const n of ['omega_firmware','omega_mobile','omega_ioc','omega_wordlist','omega_auto','omega_chain'])assert.ok(!names.some(x=>x.endsWith(`:${n}`)),n);
  });
  test('order is Passive first, then each higher tier, then table order',()=>{
    const levels=deepToolsFor(FIXTURE_TOOLS,{type:'domain',level:3}).map(p=>p.risk.level);
    assert.deepEqual(levels,[...levels].sort((a,b)=>a-b));
  });
  test('deep arguments apply the overrides',()=>{
    const maigret=FIXTURE_TOOLS.find(t=>t.name==='maigret_username_search');
    assert.equal(deepArgs(maigret,{type:'username',value:'ownername88'}).all_sites,true);
  });
  test('confirmations: none for people, ownership for sites, typed target at Intrusive',()=>{
    assert.equal(deepRunBlocked({target:'a@b.co',level:0,person:true}),'');
    assert.match(deepRunBlocked({target:'example.com',level:1,authorization:false}),/own this target/);
    assert.match(deepRunBlocked({target:'example.com',level:3,authorization:true,typedTarget:'exampel.com'}),/example\.com/);
  });
  ```

  The second test filters `.length-1` because a fixture may lack one tool; adjust after Task 1 to the exact count.
- [ ] **Step 2: Run them and confirm they fail.** Run `node --test tests/deep-search.test.mjs`. Expected: FAIL (exports missing).
- [ ] **Step 3: Implement.**
  - **`detectDeepTarget`:**
    - Use `extractTarget` first. Accept it only when the whole trimmed text is that target, or a URL whose host is the target.
    - Otherwise, `/^@?[a-z0-9_.-]{2,32}$/i` is a username.
    - Normalise through `normalizeIdentifier`:
      - lower-case emails, usernames, domains and hashes
      - strip a leading `@`
      - phones to `+` and digits only
      - CVE upper-cased
  - **`DEEP_TOOLS`:** from `docs/deep-tool-review.md`, with `timeoutMs`:
    - 600 000 for `maigret_username_search` and `spiderfoot_scan`
    - 300 000 for `sherlock_username_search` and `blackbird_username_search`
    - otherwise unset, meaning 120 000
  - **`deepToolsFor`:**
    - Apply the §6.1 filters. A person type uses level 0, whatever level is given.
    - Sort by `risk.level`, then table index.
    - De-duplicate identical tool names from different servers by keeping both. They are separate reviewed tools.
- [ ] **Step 4: Run the tests and confirm they pass,** then run `npm test`. `tests/deep-page.test.mjs` may fail now; it is rewritten in Task 9. Mark its failing tests `test.skip` with the reason `'rewritten in Task 9'`.
- [ ] **Step 5: Commit.**

  ```bash
  git add public/deep-search.js tests/deep-search.test.mjs tests/deep-page.test.mjs
  git commit -m "feat(deep): detect any target and choose every fitting tool"
  ```

### Task 3: Server rules for long runs

**Files:**
- Modify: `scripts/run-grants.mjs`, `server.mjs`
- Create: `scripts/deep-call-timeout.mjs`
- Test: `tests/run-grants.test.mjs` (extend), `tests/deep-call-timeout.test.mjs` (new)

**Interfaces:**
- Consumes: `DEEP_TOOLS` (Task 2).
- Produces:
  - `createRunGrant(request, grants, {now, ttl, token})`. A `deep-search` request may carry `runId` and `ttlMs` (capped at 1 800 000).
  - `releaseRunGrants(grants, runId) -> number`
  - `deepCallTimeout({name, serverName, deepSearch, timeoutMs}, authorization) -> number`
  - Route `POST /api/run-grants/release`, body `{runId}`.
  - `/api/mcp` accepts `deepSearch` and `timeoutMs`.

- [ ] **Step 1: Write the failing tests** (in `tests/run-grants.test.mjs`).

  ```js
  test('Deep Search grants at Light touch or below need only the acknowledgement',()=>{
    const grants=new Map();
    const req={purpose:'deep-search',target:'blog.example',level:1,runId:'r1',tools:[{endpoint:omega,name:'omega_headers',arguments:{target:'blog.example'}}],confirmation:{acknowledged:true}};
    assert.ok(createRunGrant(req,grants,{token:'lt'}).token);
    assert.throws(()=>createRunGrant({...req,level:2,tools:[{endpoint:omega,name:'omega_ports',arguments:{target:'blog.example'}}]},grants),/own this target/);
    assert.throws(()=>createRunGrant({...req,confirmation:{}},grants),/notice/);
  });
  test('an Active call is refused under an acknowledgement-only grant',()=>{
    const grants=new Map();
    createRunGrant({purpose:'deep-search',target:'blog.example',level:1,runId:'r1',tools:[{endpoint:omega,name:'omega_headers',arguments:{target:'blog.example'}}],confirmation:{acknowledged:true}},grants,{token:'lt'});
    assert.throws(()=>authorizeMcpToolCall({endpoint:omega,method:'tools/call',params:{name:'omega_ports',arguments:{target:'blog.example'}},runGrant:'lt',runTarget:'blog.example'},grants),/tier|match/);
  });
  test('Deep Search grant lifetime is capped at 30 minutes',()=>{
    const grants=new Map();const now=0;
    const g=createRunGrant({...activeDeep,ttlMs:99*60_000},grants,{now,token:'t'});
    assert.equal(g.expiresAt,30*60_000);
  });
  test('eviction keeps grants of a run in progress',()=>{
    const grants=new Map();
    createRunGrant({...activeDeep,runId:'live'},grants,{token:'keep',now:0});
    for(let i=0;i<120;i++)createRunGrant({...toolLibraryGrant},grants,{token:`x${i}`,now:0});
    assert.ok(grants.has('keep'));
  });
  test('releasing a run removes its grants only',()=>{
    const grants=new Map();
    createRunGrant({...activeDeep,runId:'a'},grants,{token:'a1'});createRunGrant({...activeDeep,runId:'b'},grants,{token:'b1'});
    assert.equal(releaseRunGrants(grants,'a'),1);assert.ok(grants.has('b1'));assert.ok(!grants.has('a1'));
  });
  ```

  Define `activeDeep` at Active with full confirmations, and `toolLibraryGrant` at Light touch, at the top of the file. In `tests/deep-call-timeout.test.mjs`:

  ```js
  test('long timeouts only for listed Deep Search tools, never above 10 minutes',()=>{
    assert.equal(deepCallTimeout({name:'maigret_username_search',serverName:'OSINT Toolbox',deepSearch:true,timeoutMs:600_000},{}),600_000);
    assert.equal(deepCallTimeout({name:'maigret_username_search',serverName:'OSINT Toolbox',deepSearch:true,timeoutMs:9e9},{}),600_000);
    assert.equal(deepCallTimeout({name:'get_wikidata',serverName:'Open OSINT',deepSearch:true,timeoutMs:600_000},{}),45_000);
    assert.equal(deepCallTimeout({name:'whois_lookup',serverName:'OSINT Toolbox',deepSearch:true,timeoutMs:120_000},{}),120_000);
    assert.equal(deepCallTimeout({name:'whois_lookup',serverName:'OSINT Toolbox'},{}),45_000);
    assert.equal(deepCallTimeout({name:'omega_ports',serverName:'Omega MCP'},{grant:{purpose:'deep-search'}}),120_000);
  });
  ```

  The rules behind it:
  - A tool in `DEEP_TOOLS` may ask for up to its own `timeoutMs`, or 120 000 if it has none.
  - A tool not in `DEEP_TOOLS` gets 45 000.
  - Grant-backed Deep Search calls get at least 120 000, as today.
  - The server name comes from `serverNameForEndpoint`.
- [ ] **Step 2: Run them and confirm they fail.** Run `node --test tests/run-grants.test.mjs tests/deep-call-timeout.test.mjs`.
- [ ] **Step 3: Implement.**
  - **`createRunGrant`:**
    - For `deep-search`, require `authorization` only when `level >= 2`, and keep the typed-target rule at 3.
    - Store `runId`.
    - `ttl = min(request.ttlMs || 15*60_000, 30*60_000)`.
  - **`pruneRunGrants(grants, now, liveRunIds=new Set())`:** delete expired grants first. Then, while the limit is reached, delete the oldest grant whose `runId` isn't live. A grant becomes live when created with a `runId`, until it's released.
  - **`releaseRunGrants(grants, runId)`:** delete that run's grants and return how many were deleted.
  - **`server.mjs`:**
    - Replace the fixed `ttl:15*60_000` with the request's `ttlMs`.
    - Pass `deepCallTimeout({...payload.params, serverName:serverNameForEndpoint(payload.endpoint), deepSearch:payload.deepSearch, timeoutMs:payload.timeoutMs}, authorization)` into `mcpRequest`.
    - Add the release route.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures. The old `'Deep Search grants require authorization…'` test stays true at level 3.
- [ ] **Step 5: Commit.**

  ```bash
  git add scripts/run-grants.mjs scripts/deep-call-timeout.mjs server.mjs tests/run-grants.test.mjs tests/deep-call-timeout.test.mjs
  git commit -m "feat(server): long Deep Search calls and run-scoped grants, safety kept"
  ```

### Task 4: Adapters, severities and account kinds

**Files:**
- Create: `public/deep-adapters.js`
- Test: `tests/deep-adapters.test.mjs`

**Interfaces:**
- Consumes: `classifyToolResult` (`result-classifier.js`), `extractIndicatorLists` (`search-dedup.js`), the Task 1 fixtures and tables.
- Produces:
  - `adaptToolResult(tool:{name,serverName}, mcpResult, subject:Identifier) -> Finding[]`. It never throws; malformed input gives `[]`.
  - `ADAPTERS` (a map by tool name, exported for tests).
  - `accountCategory(site:string) -> category`
  - `trimRaw(text:string, maxBytes=1_000_000) -> {text, trimmed:boolean}`

- [ ] **Step 1: Write the failing tests.**
  - **One test per fixture file**, generated by looping over `tests/fixtures/deep/*.json`. Each asserts that `adaptToolResult` returns an array, that every finding has `tool.name === fixture.tool`, a valid `kind`, and `subject` equal to the fixture identifier, and that no finding is a bare echo of the query. Add, by tool:
    - **Holehe:** each registered site becomes `kind:'account'` with `verified:true` and `evidence.emails` containing the subject.
    - **Sherlock and Blackbird:** accounts with `verified:false` and empty `evidence` apart from the URL.
    - **Maigret:** accounts whose extracted fields (names, links, emails) are in `evidence`.
    - **GHunt:** a `fact` for the name with `evidence.names`, and an `account` for the Google profile with `verified:true`.
    - **Breach tools:** `kind:'breach'` with the breach name.
    - **`omega_ports`, `omega_headers`, `omega_ssl`, `omega_mailsec`:** `kind:'problem'` findings whose severities match `docs/deep-tool-review.md`, and no problem without `tool`.
  - **Separate tests:**

    ```js
    test('malformed answers become one dropped finding, not a crash',()=>{
      for(const bad of [null,{content:[{type:'text',text:'{not json'}]},{isError:true,content:[{type:'text',text:'boom'}]},{content:[{type:'text',text:'x'.repeat(3_000_000)}]}])
        assert.doesNotThrow(()=>adaptToolResult({name:'omega_social',serverName:'Omega MCP'},bad,{type:'username',value:'u'}));
    });
    test('trimRaw keeps at most 1 MB and says so',()=>{
      const r=trimRaw('é'.repeat(1_000_000));assert.ok(Buffer.byteLength(r.text)<=1_000_000);assert.equal(r.trimmed,true);
    });
    test('unknown tools fall back to indicators and plain facts',()=>{
      const out=adaptToolResult({name:'new_tool',serverName:'Open OSINT'},{content:[{type:'text',text:JSON.stringify({emails:['a@b.co'],country:'UK'})}]},{type:'domain',value:'b.co'});
      assert.ok(out.some(f=>f.kind==='lead'&&f.lead.value==='a@b.co'));assert.ok(out.some(f=>f.kind==='fact'&&f.fact.value==='UK'));
    });
    ```
- [ ] **Step 2: Run them and confirm they fail.** Run `node --test tests/deep-adapters.test.mjs`.
- [ ] **Step 3: Implement.**
  - Write one adapter per tool in the corrected table, following that tool's real output shape as documented in `docs/deep-tool-review.md`. Unlisted tools go through the generic adapter.
  - Severity, meaning and fix text come from the severity table. Category comes from the account-kind table, with a default of `'other'`.
  - Finding `id` is a stable hash: the tool, kind, and the main value (URL, host, breach name or problem title).
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.**

  ```bash
  git add public/deep-adapters.js tests/deep-adapters.test.mjs
  git commit -m "feat(deep): read every tool's answer into sourced findings"
  ```

### Task 5: Linking, merging and leads

**Files:**
- Create: `public/deep-linking.js`
- Test: `tests/deep-linking.test.mjs`

**Interfaces:**
- Consumes: Finding (Task 4), `normalizeIdentifier` (Task 2).
- Produces:
  - `linkFindings(findings:Finding[], seed:Identifier, {searched:Identifier[]}) -> {findings:LinkedFinding[], leads:Identifier[]}`. `leads` are new, normalised, not in `searched`, and taken only from linked findings.
  - `normalizeUrl(url) -> string`: lower-case host, no `www.`, no trailing slash, no query or fragment.

- [ ] **Step 1: Write the failing tests.** Use the Task 1 fixtures through `adaptToolResult` where possible, and small hand-built findings for the rule edges.

  ```js
  test('rule 1: a verified account for the searched email is linked with its reason',()=>{/* holehe fixture → status 'linked', reason /Registered with/ */});
  test('rule 2: a profile showing a known identifier is linked',()=>{/* maigret finding with evidence.emails=[seed] → linked, reason /Profile shows/ */});
  test('rule 3: a profile linking to a linked account is linked',()=>{/* evidence.urls contains a linked account URL → linked, /Links to/ */});
  test('rule 4: chains record every step',()=>{/* seed→A (rule1) → B (rule3 via A): B.trail.length===2 and names A */});
  test('username-only and display-name-only matches are possible, with the reason',()=>{/* sherlock → 'possible', /Same username/ */});
  test('empty, error and echo findings are dropped',()=>{});
  test('the same profile from two tools is one finding with both sources',()=>{
    // maigret github.com/ownername88/ + sherlock https://github.com/OwnerName88 → one finding, sources.length===2, linked if either is
  });
  test('normalised identifiers are never searched twice',()=>{
    const {leads}=linkFindings([leadFinding('@OwnerName88','username'),leadFinding('Owner@Example.com','email')],{type:'username',value:'ownername88'},{searched:[{type:'email',value:'owner@example.com'}]});
    assert.deepEqual(leads,[]);
  });
  test('leads come only from linked findings',()=>{/* a lead inside a possible finding is not returned */});
  test('a name reaches sanctions only from two linked sources, and a hit stays possible',()=>{});
  ```

  The test bodies are the implementer's, with the stated assertions.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
  - Iterate to a fixed point: the seed and verified identifiers start the linked set.
  - Repeat until nothing changes:
    - mark findings linked by rules 2 and 3
    - add their identifiers and URLs to the linked set
    - record the trail
  - Then merge by `normalizeUrl` (accounts) or by `kind`+value (others), joining sources and keeping the strongest status.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.**

  ```bash
  git add public/deep-linking.js tests/deep-linking.test.mjs
  git commit -m "feat(deep): link findings only by evidence, with trails and leads"
  ```

### Task 6: The engine

**Files:**
- Create: `public/deep-engine.js`
- Test: `tests/deep-engine.test.mjs`

**Interfaces:**
- Consumes: `deepToolsFor`, `deepArgs`, `isPersonType` (Task 2); `adaptToolResult`, `trimRaw` (Task 4); `linkFindings` (Task 5).
- Produces:
  - **`runDeepSearch(options) -> Promise<RunRecord>`**, with these options:
    - `target:Identifier`, `level:number`, `tools` (all connected tools), `excluded:Set<string>`
    - `confirmation` (Task 3 shape)
    - `callTool(tool, args, {grant, deepSearch:true, timeoutMs, signal}) -> Promise<{result?, error?}>`
    - `requestGrant({target, level, runId, ttlMs, tools:{tool,args}[], confirmation}) -> Promise<{token, expiresAt}>`
    - `releaseGrants(runId)`, `signal:AbortSignal`, `onEvent(event)`
    - `now=()=>Date.now()`, `id`
  - **Events:**
    - `{type:'stage', stage:'start'|'leads'|'sites'|'finish', round}`
    - `{type:'tool-start', tool, identifier}` and `{type:'tool-end', tool, identifier, outcome, ms}`
    - `{type:'lead', identifier, from}`
    - `{type:'counts', linked, possible, done, total}`
    - `{type:'done', outcome}`
  - **Constants:** `MAX_ROUNDS=3`, `MAX_IDENTIFIERS=25`, `PASSIVE_CONCURRENCY=4`.

- [ ] **Step 1: Write the failing tests.** A fake `callTool` returns Task 1 fixtures by tool name after a short delay; a fake `requestGrant` records its requests.

  ```js
  test('a person search runs every fitting Passive tool, follows leads for up to 3 rounds, and ends linked',async()=>{});
  test('Light touch and higher calls never overlap; Passive runs at most 4 at a time',async()=>{/* track in-flight counts in fake callTool */});
  test('grants are requested per round in chunks of at most 25, with runId and ttlMs, and released at the end',async()=>{});
  test('discovered websites in a person search get Passive and Light touch only, with an acknowledgement-only grant',async()=>{});
  test('an expired grant is renewed once for the remaining calls with the same confirmation',async()=>{});
  test('a lead loop ends without repeating calls',async()=>{/* no callKey twice; rounds<=3 */});
  test('more than 25 identifiers: the rest are listed in leadsNotFollowed',async()=>{});
  test('a failing and an oversized tool do not stop the run',async()=>{/* error → calls[].outcome 'error'; 3 MB → 'trimmed', raw ≤1 MB */});
  test('cancel stops scheduling, aborts the call in flight, and returns outcome "stopped" with what was found',async()=>{});
  test('events arrive in order and counts match the final record',async()=>{});
  test('website searches have one round and list other hosts without searching them',async()=>{});
  ```
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
  - **Per round:** compute the calls with `deepToolsFor` for each identifier in the round, excluding calls already made.
    - Discovered sites in a person search: `type:'domain'` at `min(level,1)`.
    - Grant confirmation for those sites: `{acknowledged:true}`.
  - **Scheduling:** run two queues at once, a Passive pool of 4 and one serial queue for higher tiers.
    - Before a chunk of the higher-tier queue, call `requestGrant` with that chunk, `ttlMs:30*60_000` and `runId`.
    - If a call fails with a grant error, renew once for the calls left.
  - **After each round:**
    - adapt every answer
    - run `linkFindings` over all findings so far
    - take new leads, up to `MAX_IDENTIFIERS` overall
  - **Recording calls:** store `raw[callKey]` through `trimRaw`, keeping the total at or under 20 MB (stop storing raw text past it, and mark it `trimmed`).
  - **At the end:** `releaseGrants` runs in a `finally`.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.**

  ```bash
  git add public/deep-engine.js tests/deep-engine.test.mjs
  git commit -m "feat(deep): engine that runs every fitting tool and follows leads"
  ```

### Task 7: Run storage and audit

**Files:**
- Create: `scripts/deep-search-runs.mjs`
- Modify: `scripts/deep-search-audit.mjs`, `server.mjs`
- Test: `tests/deep-search-runs.test.mjs`, `tests/deep-search-audit.test.mjs` (extend)

**Interfaces:**
- Produces:
  - `DeepRunStore(dir)` with `save(run) -> {id}` and `read(id) -> run`.
    - `save` rejects a run over 25 MB, or with an `id` not matching `/^[a-z0-9-]{8,64}$/`.
    - Files are `0600` in a `0700` directory, written atomically like `CaseStore.write`.
  - Routes:
    - `POST /api/deep-search/runs`: body limit 25 MB; response `{id}`.
    - `GET /api/deep-search/runs/:id`: a missing run gives `404`.
  - `auditEntry` accepts `runId` and `toolCount`, and allows `outcome:'started'`.
  - The directory is `work/deep-search-runs/`.

- [ ] **Step 1: Write the failing tests.** Cover:
  - save and read round-trip
  - file and directory modes
  - a bad id is rejected
  - over-size is rejected
  - a missing run gives a not-found error code
  - an audit entry keeps `runId` and `toolCount`, while tool names stay capped at 25
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement. Wire the routes in `server.mjs`** next to the audit routes.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit.**

  ```bash
  git add scripts/deep-search-runs.mjs scripts/deep-search-audit.mjs server.mjs tests/deep-search-runs.test.mjs tests/deep-search-audit.test.mjs
  git commit -m "feat(server): keep Deep Search results so they can be reopened"
  ```

**PR 1 checkpoint:** run `npm test`, then a whole-branch review of Tasks 1–7. Open PR 1 only when the owner says "Push and open PR".

---

## PR 2: pages

### Task 8: Results views

**Files:**
- Create: `public/deep-results-view.js`
- Test: `tests/deep-results-view.test.mjs`

**Interfaces:**
- Consumes: RunRecord (Task 6); `ui.js` helpers; `TIERS`; `isPersonType`.
- Produces:
  - `renderDeepResults(run:RunRecord, {now}={}) -> string`. It dispatches to `renderPersonResults` or `renderSiteResults`, both exported.
  - `deepEvidenceRecord(run) -> {title, result, time, server}`, the same shape as `state.lastResult` in `app.js`. `result.content[0].text` is JSON of `{target, level, outcome, findings:[{kind, status, reason, sources, …}]}` without `raw`.
  - **Button hooks:**
    - `data-deep-target="<value>"` for Deep Search this site / lead
    - `data-pivot="<value>"` with name `Pivot: …`
    - `data-deep-save` and `data-deep-new`

- [ ] **Step 1: Write the failing tests.** Build two RunRecords from the Task 6 simulated runs (save them as `tests/fixtures/deep/run-person.json` and `run-site.json`).
  - **Person:**
    - an h2 "What we know" card holding only linked values, with sources
    - h2 "Linked accounts (N)" with h3 groups by category, and an h4 per account
    - each account has `Why linked:`, tool · server, and `<details>` "How we found this" with every trail step
    - "Websites found" with a `data-deep-target` button
    - "More leads we didn't follow", only when `leadsNotFollowed` is non-empty, each with a `data-deep-target` button
    - "Show N possible matches" `<details>` (not open)
    - "Search details" `<details>` listing every call and its outcome
    - Save and New search buttons
    - a "Stopped early" note when `outcome==='stopped'`
  - **Site:**
    - an h2 "Overview" card with "N things to fix (see below)"
    - section `<details>` with the first two open
    - "Things to fix (N)" sorted high, then medium, then low, each with meaning, fix and source
    - at level ≤ 1 with no problems, the sentence about what higher levels check
    - "Other hosts found", each with a `data-deep-target` button
  - **Both:**
    - every hostile string is escaped
    - no "Run grant"
    - external links say "(opens in a new tab)"
    - headings never skip a level
    - no possible finding appears outside its fold
    - every finding shows a tool and a server
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement** with `ui.js` blocks. Copy follows spec §9.1 and §9.2.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.**

  ```bash
  git add public/deep-results-view.js tests/deep-results-view.test.mjs tests/fixtures/deep/run-person.json tests/fixtures/deep/run-site.json
  git commit -m "feat(deep): results pages that show only linked, sourced findings"
  ```

### Task 9: Search page, progress page and wiring

**Files:**
- Create: `public/deep-progress.js`
- Modify: `public/index.html` (the `#deep` section), `public/app.js` (replace `buildDeepPlan`, `renderDeepPlan`, `runDeepSearch` and the step handlers), `public/ui.css`
- Test: `tests/deep-progress.test.mjs`, `tests/deep-page.test.mjs` (rewrite; remove the Task 2 skips)

**Interfaces:**
- Consumes: Tasks 2, 6, 7 and 8; `confirmAction`, `openDialog`, `switchView`, `callTool`, `api`, `loadDeepHistory`, `saveLastResultToCase` in `app.js`.
- Produces:
  - `initialProgress(target, level) -> state`
  - `reduceProgress(state, event) -> state`
  - `minutesLeft(state, now) -> number|null`: null until 5 tools have finished; otherwise remaining tools × the average ms so far, rounded up to whole minutes, never shown as 0 before done.
  - `renderProgress(state) -> string`
  - `deepStatusLine(text) -> {message, kind:'person'|'site'|'other'|'unsupported'|'empty'}`

- [ ] **Step 1: Write the failing tests.**
  - **`tests/deep-progress.test.mjs`:**
    - The reducer goes through stages in order, adds leads under their stage, and counts match.
    - `minutesLeft` is null before 5 tools and rounds up.
    - `renderProgress` has:
      - an h2 with the target
      - a `<progress>` with an accessible name and `max` equal to total
      - four stages with text ticks
      - the line "You can switch to other pages in the app. Keep this tab open until it finishes."
      - a `data-deep-cancel` button
  - **`tests/deep-page.test.mjs` (markup and wiring, read as text, like the phase 1–5 tests):**
    - The heading is "Find everything about one email, username, website or IP".
    - There is one `#deepTarget` and a `#deepStatus` with `role="status"`.
    - The level picker (`#deepLevel`) sits inside a wrapper that starts `hidden`, and the confirmation fields keep their ids (`#deepAuthorize`, `#deepTypedTarget`).
    - There is one `#startDeepSearch` button, and a `<details>` "Choose tools".
    - For unsupported input, the status line reads "Deep Search needs an email, username, website or IP. To search a name, use Search." with a button that opens Search, and `#startDeepSearch` is disabled.
    - In `app.js`:
      - `beforeunload` is set only while a run is going
      - `a second start while a run is going is refused and the progress view returns` (a guard on `state.deepRun`)
      - focus moves to `#deepProgressHeading` on start, `#deepResultsHeading` on done or stop, and `#deepTarget` on New search and on Deep Search this site
      - Cancel uses `confirmAction` with "Stop the search? What's been found so far will be kept."
      - an audit `started` entry is written before the first call
      - the run is posted to `/api/deep-search/runs` in a `finally`
      - Run history rows with a `runId` show **Open results**
  - **`tests/a11y-structure.test.mjs`:** Deep Search status lines are written only when their text changes.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
  - **The `#deep` section** becomes the §5 page: the box, status line, level wrapper, confirmations, Start, the Choose tools fold, the progress and results containers, and Run history.
  - **Status line and Start:** `input` on `#deepTarget` updates the status line through `deepStatusLine`, shows or hides the level wrapper and confirmations, and enables Start.
  - **Naming:** `app.js` already has a `runDeepSearch` function. Delete it with the old step handlers, name the new click handler `startDeepSearch`, and import the engine as `import {runDeepSearch as runDeepEngine} from './deep-engine.js?v=1'`.
  - **Start:** builds `confirmation`, checks `deepRunBlocked`, creates a run id with `crypto.randomUUID()`, writes the audit `started` entry, then calls `runDeepSearch` with:
    - `callTool` adapted to pass `deepSearch`, `timeoutMs` and `grant`
    - `requestGrant`, which posts to `/api/run-grants`
    - `releaseGrants`, which posts to `/api/run-grants/release`
  - **Progress rendering:** at most every 250 ms via `requestAnimationFrame`.
  - **On done:** render `renderDeepResults`, post the run, write the final audit entry, refresh history.
  - **Choose tools** lists `deepToolsFor` for every type the run may use, grouped by type with headings, as checkboxes (all ticked). Unticked names go into `excluded`.
  - **Styles** in `ui.css` use only existing tokens. Contrast is tested by the existing token tests.
- [ ] **Step 4: Run `npm test`,** then run the whole flow in the browser with a fake run, injected through a git-excluded `public/__deep-fake.js` that swaps `callTool` for fixtures. Check:
  - the progress page updates
  - leaving for Evidence and returning shows the same run
  - Start again is refused
  - Cancel keeps what was found
  - results render
  - Save to evidence adds a finding
  - Open results from history reopens it
- [ ] **Step 5: Commit.**

  ```bash
  git add public/deep-progress.js public/index.html public/app.js public/ui.css tests/deep-progress.test.mjs tests/deep-page.test.mjs tests/a11y-structure.test.mjs
  git commit -m "feat(deep): one-box search, live progress and results in the app"
  ```

### Task 10: Reopen, Deep Search this site, and evidence

**Files:**
- Modify: `public/app.js`
- Test: `tests/deep-page.test.mjs` (extend)

**Interfaces:**
- Consumes: Task 7 routes, Task 8 hooks.
- Produces: none new.

- [ ] **Step 1: Write the failing tests.**
  - **Open results** fetches `/api/deep-search/runs/<id>`, re-adapts `raw` with the current adapters and re-links before rendering. This is the "later adapter fix improves old runs" rule.
  - A history row without `runId` says "Results weren't kept for this run".
  - **`data-deep-target`** fills `#deepTarget`, triggers the status line, scrolls to the top and focuses the box. The level picker is visible for a site.
  - **`data-deep-save`** sets `state.lastResult = deepEvidenceRecord(run)` and calls `saveLastResultToCase`.
  - **`data-pivot`** in Deep Search results uses the existing Pivot handler.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.**
- [ ] **Step 5: Commit.**

  ```bash
  git add public/app.js tests/deep-page.test.mjs
  git commit -m "feat(deep): reopen past results, search found sites, save to evidence"
  ```

### Task 11: Final audit

**Files:** fixes only, each with a test that fails first.

- [ ] **Step 1: Run axe-core 4.10.2** (git-excluded `public/__axe-test.js`, at least 600 ms after each theme switch) with `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa` and `best-practice`. Cover both themes at 1280 and 375 px, on:
  - the box: empty, a person, a website at Intrusive, and an unsupported input
  - the progress page
  - person results with every fold open
  - site results with every fold open
  - Stopped early

  Expected: 0 violations.
- [ ] **Step 2: Do a keyboard pass of the whole flow:** type, Start, Choose tools, Cancel (with Cancel and with Stop), results folds, Deep Search this site, Pivot, Save, New search and Open results.
- [ ] **Step 3: The owner runs one real person search and one real website search** from the launcher. Compare each against its recording. Every linked finding must be explainable from its trail; anything wrong is fixed with a test that fails first.
- [ ] **Step 4: Clean up.** Remove the `public/__*` files, the test cases and runs made during checks, and the scratch identifier file.
- [ ] **Step 5: Whole-branch review** on the strongest model. Fix the findings with tests, then follow the finishing-a-development-branch steps. Open PR 2 only when the owner says "Push and open PR".
