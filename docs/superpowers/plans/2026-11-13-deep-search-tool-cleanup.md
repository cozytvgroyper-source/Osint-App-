# Deep Search Tool Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop running `omega_asn` in Deep Search, and skip `get_greynoise` (visibly) for private or reserved IPs.

**Architecture:** `public/deep-search.js` owns the tool table. `omega_asn` leaves the IP list, `get_greynoise` gets `publicIpOnly:true`, a new `isReservedIp(value)` helper is exported, and `deepToolsFor` passes `publicIpOnly` through. `public/deep-engine.js` records a `skipped` call, instead of calling the tool, when a `publicIpOnly` tool meets a reserved IP. The results view already prints `outcome: error` per call, so it needs only a test.

**Tech Stack:** browser ES modules, `node --test`, no dependencies.

**Spec:** [docs/superpowers/specs/2026-11-13-deep-search-tool-cleanup-design.md](../specs/2026-11-13-deep-search-tool-cleanup-design.md)

## Global Constraints

- Work on branch `deep-search/tool-cleanup` (from `main` at `90d3261`). Stage explicit paths only. One commit per task. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Main Search (`search-query.js`, `search-planner.js`) is not changed.
- Skip reason, exact text: `Only covers public internet addresses.`; outcome value: `skipped`.
- Cache-busting: `deep-search.js?v=3` → `4` and `deep-engine.js?v=1` → `2` in `public/app.js`; `app.js?v=58` → `60` in `public/index.html`. Use **60**, not 59: open PR 92 already takes 59, so whichever merges second resolves a one-line conflict to 60.
- Never commit `work/`, `public/__*`, `.superpowers/`.

## Review Focus

1. **Range edges of the reserved check** (`172.31.255.255` vs `172.32.0.1`, `100.63.255.255` vs `100.64.0.0`, `198.17.255.255` vs `198.18.0.0`). Expect exact standard boundaries. Test: Task 1.
2. **Malformed or odd input to `isReservedIp`** (`''`, `'999.1.1.1'`, `'01.2.3.4'`, `'not an ip'`). Expect `false`, never a throw, so the tool runs and fails or works on its own. Test: Task 1.
3. **Progress with skipped calls.** Expect `done` to reach `total`, so the progress bar finishes. Test: Task 2.
4. **A person search that finds a private IP as a lead.** This can't happen today, because person rounds don't search IPs; IP is website/IP-only. No test is needed, but the skip lives in the shared task builder, so it would apply anyway.
5. **A skip reason containing markup.** Expect it escaped in Search details. Test: Task 2 (view test with a hostile `error`).

---

### Task 1: Tool table and reserved-address helper

**Files:**
- Modify: `public/deep-search.js` (IP list in `DEEP_TOOLS`; new export; `deepToolsFor` return shape)
- Modify: `public/app.js` (`deep-search.js?v=3` → `?v=4`)
- Modify: `docs/deep-tool-review.md`:
  - drop `omega_asn` from the IP Passive row
  - add a "Changes approved after recording" row: `Remove omega_asn | Its data source, api.bgpview.io, no longer exists (DNS NXDOMAIN on 2026-11-13); get_bgp covers network owner and routing.`
  - add the sentence `get_greynoise is skipped for private and reserved IPs; it only covers public internet addresses.` under the table
- Test: `tests/deep-search.test.mjs`

**Interfaces:**
- Produces: `isReservedIp(value: string): boolean`. It is true for IPv4 in `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4` and `240/4`, and for IPv6 `::`, `::1`, `fe80::/10`, `fc00::/7`, `2001:db8::/32` and `ff00::/8`. Anything that isn't a well-formed address (IPv4 octets 0–255, no leading zeros) returns `false`.
- Produces: each item from `deepToolsFor` gains `publicIpOnly: boolean` (from the table entry, default `false`).

- [ ] **Step 1: Write failing tests** in `tests/deep-search.test.mjs`:
  - `omega_asn is no longer an IP tool and GreyNoise is public-only`:
    - `DEEP_SEARCH_TOOLS.ip` does not include `'omega_asn'`, and does include `'get_greynoise'`
    - `DEEP_TOOLS.ip.find(entry=>entry.name==='get_greynoise').publicIpOnly === true`
    - `deepToolsFor` over `[get_greynoise, get_bgp]` tool definitions (reviewed, as the existing tests build them) for `{type:'ip'}` returns `publicIpOnly:true` for GreyNoise and `false` for get_bgp
  - `isReservedIp knows the private and reserved ranges exactly`:
    - true: `10.0.0.1`, `172.16.0.1`, `172.31.255.255`, `192.168.1.1`, `127.0.0.1`, `169.254.1.1`, `100.64.0.0`, `100.127.255.255`, `198.18.0.0`, `198.19.255.255`, `192.0.2.10`, `198.51.100.1`, `203.0.113.5`, `0.1.2.3`, `224.0.0.1`, `255.255.255.255`, `::1`, `::`, `fe80::1`, `fd00::1`, `2001:db8::1`, `ff02::1`
    - false: `8.8.8.8`, `1.1.1.1`, `172.32.0.1`, `172.15.255.255`, `100.63.255.255`, `100.128.0.0`, `198.17.255.255`, `198.20.0.0`, `2606:4700::1111`
  - `isReservedIp never throws on odd input`: `''`, `'999.1.1.1'`, `'01.2.3.4'`, `'1.2.3'`, `'not an ip'`, `undefined` all return `false`
- [ ] **Step 2: Run** `node --test tests/deep-search.test.mjs`. Expected: the 3 new tests FAIL.
- [ ] **Step 3: Implement.**
  - Remove `tool('omega_asn')` from the IP list.
  - Change to `tool('get_greynoise',{publicIpOnly:true})`.
  - Add `export function isReservedIp(value)`. IPv4: parse into four octets, compare as a 32-bit number against the ranges. IPv6: lower-case it, expand `::`, and check the first hextets. Wrap in `try` → `false`.
  - In `deepToolsFor`'s final `map`, add `publicIpOnly:Boolean(entry.publicIpOnly)`.
  - Update the provisional comment above `DEEP_TOOLS` (it still says "Provisional table… Task 1 replaces this") to: `The reviewed tool table; see docs/deep-tool-review.md for why each tool is here or was removed.`
  - Bump `deep-search.js?v=4` in `app.js`, and make the doc edits above.
- [ ] **Step 4: Run** `node --test tests/deep-search.test.mjs tests/deep-page.test.mjs`. Expected: all PASS.
- [ ] **Step 5: Commit** `public/deep-search.js public/app.js docs/deep-tool-review.md tests/deep-search.test.mjs` with message `feat(deep): drop the dead ASN tool and mark GreyNoise public-only`.

### Task 2: Engine records skipped calls

**Files:**
- Modify: `public/deep-engine.js` (task building at ~line 107–113, and the counts)
- Modify: `public/app.js` (`deep-engine.js?v=1` → `?v=2`), `public/index.html` (`app.js?v=58` → `?v=60`)
- Test: `tests/deep-engine.test.mjs`, `tests/deep-results-view.test.mjs`

**Interfaces:**
- Consumes: `isReservedIp`, and `publicIpOnly` on `deepToolsFor` items (Task 1).
- Produces: `run.calls` entries `{tool, serverName, identifier, outcome:'skipped', error:'Only covers public internet addresses.', ms:0}`. Each also emits `onEvent({type:'tool-end', tool, identifier, outcome:'skipped', ms:0})` and counts toward `total` and `done`.

- [ ] **Step 1: Write failing tests:**
  - `tests/deep-engine.test.mjs` → `public-only tools are skipped for a private IP and shown as skipped`:
    - **Private IP:** tools `[tool('get_greynoise','Open OSINT','query'), tool('get_bgp','Open OSINT','query')]`. Run `runDeepSearch` on target `{type:'ip',value:'192.168.1.10'}`, level 0, recording the names `callTool` receives and every event.
      - `callTool` never sees `get_greynoise`, but does see `get_bgp`.
      - `run.calls` has `{tool:'get_greynoise', outcome:'skipped', error:'Only covers public internet addresses.', ms:0}`.
      - The last `counts` event has `done === total === 2`.
    - **Public IP:** the same run on `8.8.8.8` calls both tools, and no call is `skipped`.
  - `tests/deep-results-view.test.mjs` → `skipped calls show their reason in Search details, escaped`:
    - Render with `run.calls` containing a skipped GreyNoise call. The HTML contains `get_greynoise</strong> · Open OSINT — skipped: Only covers public internet addresses.`
    - A call with `error:'<img src=x>'` renders as `&lt;img src=x&gt;`.
- [ ] **Step 2: Run** `node --test tests/deep-engine.test.mjs tests/deep-results-view.test.mjs`. Expected: the engine test FAILS (`callTool` sees `get_greynoise`). The view test may already PASS, because the existing renderer prints `outcome: error`: record that as a characterization test, and ledger it.
- [ ] **Step 3: Implement** in the task-building loop: for each `picked` with `picked.publicIpOnly && identifier.type==='ip' && isReservedIp(identifier.value)`, push it to a `skipped` list (deduplicated by `callKey`, like `madeCalls`) instead of `tasks`. After the loop:
  - `total += tasks.length + skipped.length`
  - for each skipped one, push the call record above and emit its `tool-end`
  - then `countsEvent()`

  Bump the versions listed in Files.
- [ ] **Step 4: Run** `node --test tests/deep-engine.test.mjs tests/deep-results-view.test.mjs tests/deep-page.test.mjs`. Expected: all PASS. If a deep-page test pins `app.js?v=58`, update it to `60` in the same commit.
- [ ] **Step 5: Commit** `public/deep-engine.js public/app.js public/index.html tests/deep-engine.test.mjs tests/deep-results-view.test.mjs` (plus `tests/deep-page.test.mjs` if touched) with message `feat(deep): skip public-only tools for private IPs and say so`.

### Task 3: Verify

- [ ] **Step 1:** `npm test`. Expected: 0 failures, total above 470.
- [ ] **Step 2:** Whole-branch review (fresh reviewer); fix Critical and Important issues test-first.
- [ ] **Step 3:** Live check, **only when the owner has the tool servers running**: a Deep Search of `8.8.8.8` returns a GreyNoise answer, not an error. If the servers aren't running, report it as not done and ask the owner to start `Start Public Desk.command` when convenient.
- [ ] **Step 4:** Stop and ask the owner before pushing or opening a PR.
