# Deleting Deep Search Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner delete one Deep Search, or all of them, removing both the saved results and the history-log lines.

**Architecture:** The server does all deleting. `DeepRunStore` gains `remove`/`removeAll`. The audit module gains `deleteDeepSearchAudit`/`clearDeepSearchAudit`, which share the existing per-file write queue with `appendDeepSearchAudit`. A new route module, built like `handleCaseRequest`, exposes three `POST` routes. The page adds Delete per row and Delete all, through `confirmAction`.

**Tech Stack:** Node ≥ 22 ES modules, `node --test`, plain HTML/CSS/JS, no dependencies.

**Spec:** [docs/superpowers/specs/2026-11-13-deep-search-delete-runs-design.md](../specs/2026-11-13-deep-search-delete-runs-design.md)

## Global Constraints

- Work on branch `deep-search/delete-runs`. Stage explicit paths only (never `git add -A` or `.`). One commit per task. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit `work/`, `public/__*`, `.superpowers/` or `tests/fixtures/deep/raw/`.
- Every file write is atomic (temp file + `rename`) with mode `0600`, like `DeepRunStore.save`.
- Run ids must match the existing `RUN_ID` pattern `/^[a-z0-9-]{8,64}$/` before touching disk.
- CSP is `script-src 'self'; style-src 'self'`: no inline scripts or styles.
- When a module changes, bump its `?v=` everywhere it's imported, and bump `app.js?v=` (now `58`) in `index.html`.
- User-facing copy (exact):
  - Row button text `Delete`, accessible name `Delete search: <target>`
  - One delete: title `Delete this search?`, message `Its results and its history entry will be removed for good. This can't be undone.`, confirm `Delete`
  - All: button `Delete all`; title `Delete all N searches?` (N = row count; `Delete this search?` when N = 1); message `Every search's results and history entry will be removed for good. This can't be undone.`; confirm `Delete all`
  - While a run is active: `Wait for the current search to finish before deleting.`
  - After success: `Search deleted.` / `All searches deleted.`
- Never show the words "Run grant". Heading order stays h1 → h2 → h3.

## Review Focus

1. **A target containing quotes, `<` or `&`** (any text the owner typed). Expect it escaped in the button's `aria-label` and `data-*` attributes, and the right row deleted. Test: Task 4.
2. **The log has damaged (non-JSON) lines or lines from other searches.** Expect them kept byte-for-byte; only the matching lines go. Test: Task 2.
3. **An append arrives while a delete is rewriting the log** (a search finishing at that moment). Expect the appended line to survive. Test: Task 2.
4. **Deleting something already gone**, or "Delete all" with no log and no runs folder. Expect success with `deleted: 0`, not an error. Test: Tasks 1–3.
5. **The deleted search is the one open on the results page.** Expect the results to close, and focus to go to the Run history heading. Test: Task 4.

---

### Task 1: Remove saved results

**Files:**
- Modify: `scripts/deep-search-runs.mjs`
- Test: `tests/deep-search-runs.test.mjs`

**Interfaces:**
- Produces: `DeepRunStore#remove(id: string): Promise<boolean>`, which returns `true` if a file was deleted, `false` if none existed, and throws `DEEP_RUN_INPUT` for a bad id.
- Produces: `DeepRunStore#removeAll(): Promise<number>`, which deletes every regular file in `this.dir` whose name ends in `.json` or `.tmp` (temporary and orphaned files included) and returns the count. A missing folder returns `0`.

- [ ] **Step 1: Write failing tests** in `tests/deep-search-runs.test.mjs`:
  - `remove deletes one run and reports whether a file existed`: save `run-aaaaaaaa` and `run-bbbbbbbb`; `remove('run-aaaaaaaa')` returns `true`; `read('run-aaaaaaaa')` rejects with code `DEEP_RUN_NOT_FOUND`; `read('run-bbbbbbbb')` still deep-equals the sample; a second `remove('run-aaaaaaaa')` returns `false`.
  - `remove refuses bad ids before touching disk`: `remove('../escape')` and `remove('')` reject with code `DEEP_RUN_INPUT`.
  - `removeAll clears saved, temporary and orphaned files and tolerates a missing folder`: save two runs, `writeFile` a `.run-cccccccc.ab12.tmp` into the folder; `removeAll()` returns `3`; `readdir(dir)` deep-equals `[]`. A fresh store on a non-existent folder: `removeAll()` returns `0`.
- [ ] **Step 2: Run** `node --test tests/deep-search-runs.test.mjs`. Expected: the 3 new tests FAIL (`store.remove is not a function`).
- [ ] **Step 3: Implement** `remove` (`unlink(this.file(id))`, with `ENOENT` → `false`) and `removeAll` (`readdir`, with `ENOENT` → `0`; `unlink` each matching name; skip anything not a regular file via `lstat`).
- [ ] **Step 4: Run** `node --test tests/deep-search-runs.test.mjs`. Expected: all PASS.
- [ ] **Step 5: Commit** `scripts/deep-search-runs.mjs tests/deep-search-runs.test.mjs` with message `feat(deep): delete saved Deep Search results`.

### Task 2: Remove history-log lines

**Files:**
- Modify: `scripts/deep-search-audit.mjs`
- Test: `tests/deep-search-audit.test.mjs`

**Interfaces:**
- Produces: `deleteDeepSearchAudit(file: string, match: {runId: string} | {time: string, target: string}): Promise<number>`, which returns the number of lines removed.
  - `{runId}` removes every line whose parsed `runId` equals it.
  - `{time, target}` removes only lines with that exact `time` and `target` **and no `runId`**.
  - A bad `runId` (fails `/^[a-z0-9-]{8,64}$/`), an empty `target`, or a `time` that isn't a string throws code `AUDIT_INPUT`.
  - A missing log returns `0`.
  - Lines that don't parse, and every non-matching line, are written back byte-for-byte in their original order.
- Produces: `clearDeepSearchAudit(file: string): Promise<number>`, which empties the log (atomic write of `''`, mode `0600`) and returns the number of non-empty lines it held. A missing log returns `0` and creates nothing.
- Both run through the **same** `auditQueues` chain as `appendDeepSearchAudit`. Extract the existing chaining into `function queued(file, work)` and use it in all three.

- [ ] **Step 1: Write failing tests** in `tests/deep-search-audit.test.mjs`. Build each log by writing raw text, including one damaged line `not json`.
  - `delete by run id removes both of that run's lines and keeps every other line byte-for-byte`: lines for `run-aaaaaaaa` (started + completed), a line for `run-bbbbbbbb`, a legacy line with no runId, and `not json`. Result `2`; the file equals the original text minus exactly those two lines.
  - `delete by time and target removes only the legacy line without a run id`: a legacy line and a runId line sharing the same `time` and `target`. Result `1`; the runId line remains.
  - `rejects bad delete input`: `{runId:'../x'}`, `{time:'t', target:''}` and `{}` each reject with code `AUDIT_INPUT`.
  - `clear empties the log and a missing log is fine`: `clearDeepSearchAudit` returns the line count (damaged line included), and the file is `''` with mode `& 0o077 === 0`. On a missing file both functions return `0` and `access(file)` still rejects.
  - `an append queued during a delete is never lost`: start `deleteDeepSearchAudit(file,{runId:'run-aaaaaaaa'})` and `appendDeepSearchAudit(file, {...valid entry, runId:'run-cccccccc'})` without awaiting between them, then `Promise.all`. Afterwards `readDeepSearchAudit` shows the `run-cccccccc` entry and no `run-aaaaaaaa` entry.
- [ ] **Step 2: Run** `node --test tests/deep-search-audit.test.mjs`. Expected: the new tests FAIL (import not found).
- [ ] **Step 3: Implement** `queued`, `deleteDeepSearchAudit` and `clearDeepSearchAudit`. Read with `readFile` (`ENOENT` → `0`). Split on `\n` and keep the trailing-newline shape. Write to `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp` with mode `0600`, `chmod`, then `rename`. Skip the write when nothing matched.
- [ ] **Step 4: Run** `node --test tests/deep-search-audit.test.mjs`. Expected: all PASS, including the existing rotation and concurrency tests.
- [ ] **Step 5: Commit** `scripts/deep-search-audit.mjs tests/deep-search-audit.test.mjs` with message `feat(deep): delete Deep Search history entries`.

### Task 3: Server routes

**Files:**
- Create: `scripts/deep-history-routes.mjs`
- Modify: `server.mjs` (import, and call it next to the `/api/deep-search/runs` routes at ~line 532)
- Test: `tests/deep-history-routes.test.mjs`

**Interfaces:**
- Consumes: `DeepRunStore#remove`, `#removeAll` (Task 1); `deleteDeepSearchAudit`, `clearDeepSearchAudit` (Task 2).
- Produces: `handleDeepHistoryRequest({runs, auditFile}, method: string, pathname: string, readBody: () => Promise<object>): Promise<{status:number, body:object} | null>`. It returns `null` for any path or method it doesn't own, like `handleCaseRequest`.
  - `POST /api/deep-search/runs/<id>/delete` (path matched with `/^\/api\/deep-search\/runs\/([^/]+)\/delete$/`; the id is validated by `runs.remove`, which throws `DEEP_RUN_INPUT` → 400 for a bad id): runs `runs.remove(id)` **first**, then `deleteDeepSearchAudit(auditFile,{runId:id})`. Returns `{status:200, body:{deleted:<lines>, results:<bool>}}`.
  - `POST /api/deep-search/history/delete`: body `{time,target}` → `{status:200, body:{deleted:<lines>, results:false}}`.
  - `POST /api/deep-search/history/delete-all`: `runs.removeAll()` first, then `clearDeepSearchAudit`. Returns `{status:200, body:{deleted:<lines>, results:<files removed>}}`.
- Errors propagate. `server.mjs`'s `errorStatus` already maps `AUDIT_INPUT` and `DEEP_RUN_INPUT` to 400.

- [ ] **Step 1: Write failing tests** in `tests/deep-history-routes.test.mjs`, using a temp folder, a real `DeepRunStore` and a real log file:
  - `deletes one run's results then its history lines`: save `run-aaaaaaaa`, append its started and completed lines → `{status:200, body:{deleted:2, results:true}}`. Both are gone; another run's file and line remain.
  - `results are removed before history lines`: a `runs` stub whose `remove` rejects. The route rejects, and the log still holds the run's lines.
  - `deleting something already gone succeeds with zero`: → `{deleted:0, results:false}`.
  - `deletes a legacy row by time and target`, and a body with an empty target rejects with code `AUDIT_INPUT`.
  - `delete-all clears every result file and the whole log`: → `results:2`, `deleted:<line count>`. Folder empty, log `''`.
  - `refuses a bad run id`: `POST /api/deep-search/runs/BAD_ID/delete` rejects with code `DEEP_RUN_INPUT`, and the log is unchanged.
  - `ignores paths and methods it does not own`: `GET /api/deep-search/runs/run-aaaaaaaa/delete`, `POST /api/deep-search/runs/run-aaaaaaaa` and `POST /api/deep-search/history` all return `null`.
  - `server wires the history routes behind the guard`: read `server.mjs` as text and assert it imports `handleDeepHistoryRequest` from `./scripts/deep-history-routes.mjs` and calls it inside the `/api/` request handling (after `requestGuard`).
- [ ] **Step 2: Run** `node --test tests/deep-history-routes.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `scripts/deep-history-routes.mjs` and wire it into `server.mjs`: `const handledHistory=await handleDeepHistoryRequest({runs:deepRuns,auditFile:DEEP_SEARCH_AUDIT_FILE},req.method,url.pathname,()=>body(req,10_000)); if(handledHistory)return json(res,handledHistory.status,handledHistory.body);`, placed before the existing `deepRunRoute` GET.
- [ ] **Step 4: Run** `node --test tests/deep-history-routes.test.mjs tests/request-guard.test.mjs`. Expected: all PASS.
- [ ] **Step 5: Commit** `scripts/deep-history-routes.mjs server.mjs tests/deep-history-routes.test.mjs` with message `feat(server): routes to delete Deep Search runs`.

### Task 4: Delete buttons on the Run history

**Files:**
- Modify: `public/index.html` (the `#deep` Run history section at ~line 109; `app.js?v=58` → `59`)
- Modify: `public/app.js` (`loadDeepHistory` ~338, the document click handler ~757, `openDeepResults`, and the run start at ~705)
- Test: `tests/deep-page.test.mjs`

**Interfaces:**
- Consumes: the three routes from Task 3, through the existing `api(path, payload)`.
- Produces (markup, for tests and later work):
  - In the history section header, next to `#refreshDeepHistory`: `<button class="text-button" id="deleteAllDeepHistory" hidden>Delete all</button>`.
  - `<p id="deepHistoryStatus" class="subtle" role="status"></p>` below the heading.
  - `<p id="deepHistoryBusy" class="subtle" hidden>Wait for the current search to finish before deleting.</p>`.
  - Each row's last cell gets `<button type="button" class="text-button" data-delete-deep-run="<runId>" aria-label="Delete search: <target>">Delete</button>`. Rows without a runId use `data-delete-deep-time="<time>" data-delete-deep-target="<target>"` instead. All values go through `escapeHtml`.

- [ ] **Step 1: Write failing tests** in `tests/deep-page.test.mjs`:
  - `Run history has Delete all, a status line and a busy note`: assert `#deleteAllDeepHistory` is inside the history section with text `Delete all`; `id="deepHistoryStatus"[^>]*role="status"`; and the busy note's exact text.
  - `each history row gets an escaped Delete button`: in `app.js`, assert `data-delete-deep-run="\$\{escapeHtml(entry.runId)\}"`, `aria-label="Delete search: \$\{escapeHtml(entry.target)\}"`, and the `data-delete-deep-time` / `data-delete-deep-target` forms with `escapeHtml`.
  - `deletes go through confirmAction with the exact wording`: assert `app.js` contains `title:'Delete this search?'`, the exact one-delete message, `confirmLabel:'Delete'`, `'Delete all'`, the exact all message, and the `Delete all ${` count title.
  - `deleting is blocked while a search runs`: assert the delete handlers return early on `state.deepRun`, history buttons render `disabled` when `state.deepRun`, `#deepHistoryBusy` is unhidden then, and `loadDeepHistory()` is called when a run starts.
  - `after a delete, focus and status move sensibly`: assert `deepHistoryHeading[^\n]*focus`, that `Search deleted.` and `All searches deleted.` are written to `#deepHistoryStatus` only when different from its current text, and that when `state.deepCurrent?.id` equals the deleted run id, `#deepResults` is hidden, `state.deepCurrent` becomes `null` and `#deepSetup` is shown.
  - `index.html loads app.js?v=59`.
  - Make `#deepHistoryHeading` focusable for the focus move: assert `id="deepHistoryHeading" tabindex="-1"`.
- [ ] **Step 2: Run** `node --test tests/deep-page.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `loadDeepHistory` adds the button per row, shows `#deleteAllDeepHistory` when there are rows (hidden otherwise), and sets `disabled` plus the busy note from `state.deepRun`.
  - The click handler checks `state.deepRun` first, then `confirmAction`, then `api(...)`. On success: reload the history, write the status, close the results if they show the deleted run, and focus `#deepHistoryHeading`. On error: `toast(\`Could not delete: ${error.message}\`)`.
  - Call `loadDeepHistory()` right after `state.deepRun` is set at run start.
- [ ] **Step 4: Run** `node --test tests/deep-page.test.mjs tests/a11y-structure.test.mjs`. Expected: all PASS.
- [ ] **Step 5: Commit** `public/index.html public/app.js tests/deep-page.test.mjs` with message `feat(deep): delete one search or all searches from the Run history`.

### Task 5: Verify the whole change

**Files:** none changed unless a check fails. A fix starts with a failing test in the owning task's test file.

- [ ] **Step 1:** Run `npm test`. Expected: 0 failures, total above 470. Report the number.
- [ ] **Step 2:** Start the app alone with `npm start`. Don't print the token; open the address in the built-in browser. Through the page's own API, add three history entries with stand-in targets (`owner@example.com`, `ownername`, `owner-site.example`), two of them with saved runs and one legacy line without a `runId`.
- [ ] **Step 3:** Using the keyboard only:
  - delete one row with a saved run, and check its file is gone from `work/deep-search-runs/` and both its lines from `work/deep-search-audit.jsonl`
  - delete the legacy row
  - cancel a Delete all, then confirm one

  After each, check the status text and that focus is on the Run history heading.
- [ ] **Step 4:** Run axe-core 4.10.2 (git-excluded `public/__axe-test.js`; rule sets `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, `best-practice`) on the Run history with rows, with the confirmation open, and empty. Do this in light and dark themes (wait ≥ 600 ms after switching) at 1280 and 375 px. Expected: 0 violations.
- [ ] **Step 5:** `git status` shows nothing from `work/` or `public/__*`. Then a whole-branch review. Stop and ask the owner before pushing or opening a PR.
