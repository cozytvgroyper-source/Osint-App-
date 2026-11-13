# Deleting Deep Search runs: design

Date: 2026-11-13 · Status: approved by the owner · Size: small change

## Intent

Every finished Deep Search stays on the owner's Mac forever: its results (findings and raw tool answers, up to 25 MB) and its lines in the run history log. There is no way to remove either. Person searches hold sensitive findings about people, so the owner wants to be able to delete them **completely**.

## Decisions (the owner's)

- **Delete removes the search completely:** its saved results **and** its lines in the history log. The search disappears from the Run history as if it never happened.
- **Two buttons:** a **Delete** button on each Run history row, and a **Delete all** button for the whole history.

## Goals, non-goals, anti-goals

**Goals**
- Delete one search, or all searches, from the Run history page.
- After a delete, nothing from that search is left in `work/deep-search-runs/` or `work/deep-search-audit.jsonl`.

**Non-goals**
- Evidence saved to a case with "Save to Evidence" is **not** touched. It's a separate copy the owner chose to keep, with its own controls.
- Automatic expiry or deleting by age.
- Undo.

**Anti-goals**
- A delete that leaves part of the search behind (one of its two history lines, or its results file).
- A crash or a run finishing mid-delete that leaves the history log half-written or loses another search's lines.
- Weakening any safety check. (Checked: nothing in the safety system reads the history log. Run grants and tier checks are separate.)
- A path or id from the request reaching the filesystem unchecked.

## How it works today (facts checked in the code)

- `scripts/deep-search-runs.mjs`: `DeepRunStore` saves `work/deep-search-runs/<runId>.json` (atomic temp-and-rename, mode `0600`) and reads it back. It has no delete.
- `scripts/deep-search-audit.mjs`: `appendDeepSearchAudit` adds one JSON line per call through a per-file queue. Each search writes **two** lines with the same `runId`: `outcome:'started'` and the final outcome. Older lines may have no `runId`.
- `public/app.js` `loadDeepHistory()` builds the Run history table from those lines (one row per `runId`, or per `time+target` when there's no `runId`). Rows with no `runId` show "Results weren't kept for this run".
- The server's existing deletes are `POST …/delete` routes (cases). The request guard requires a JSON body on every POST.

## Approach

**Considered:**
1. **The server deletes** the results file and rewrites the history log without the search's lines. *(Chosen: the only way that actually removes the data.)*
2. Hide rows in the page only. *Rejected: the data stays on disk, which defeats the owner's decision.*
3. The page deletes files itself. *Rejected: pages can't touch files; only the server can, behind the access-token guard.*

**Design:**
- **Server routes** (same guard as every `/api/*` route):
  - `POST /api/deep-search/runs/<runId>/delete` deletes one search that has a `runId`.
  - `POST /api/deep-search/history/delete` with `{time, target}` deletes one older row that has no `runId`. It removes only lines with that exact `time` and `target` and no `runId`.
  - `POST /api/deep-search/history/delete-all` deletes every results file in `work/deep-search-runs/` (including orphaned and temporary ones) and empties the history log.
- **History log rewrite:** runs through the **same queue** as `appendDeepSearchAudit`, so appends and deletes never interleave. It reads the whole log, drops the matching lines, writes a temporary file (`0600`), and renames it over the log. Damaged lines that aren't the target are kept as they are.
- **Results file:** deleted by validated `runId` only (the existing `RUN_ID` pattern). A missing file isn't an error, because older runs may have none.
- **Order:** delete the results file first, then the log lines. If the second step fails, the row stays visible and can be deleted again.
- **Responses:** `{deleted: <number of log lines removed>, results: true|false}`. An invalid id gets 400. Deleting something already gone returns `deleted: 0` and is not an error.

**Page:**
- Each Run history row gets a **Delete** button with accessible name "Delete search: <target>". Its confirmation (`confirmAction`, focus starts on Cancel) reads: title "Delete this search?", message "Its results and its history entry will be removed for good. This can't be undone.", confirm label "Delete".
- **Delete all** sits next to the Refresh button and is shown only when there's history. Its confirmation names the count: "Delete all N searches?" / "Every search's results and history entry will be removed for good. This can't be undone." / "Delete all".
- **While a search is running**, Delete and Delete all are disabled, with a visible note: "Wait for the current search to finish before deleting." *(Builder's call, accepted by the owner.)*
- After a delete: the table reloads, a status message says "Search deleted." or "All searches deleted.", and focus moves to the Run history heading (the removed button can't keep focus). If the results page was showing the deleted search, it is closed.
- Errors appear as the usual toast in plain words.

## Testing

Test first, as with every task in this project:
- Run store: delete removes the file; a missing file is fine; an invalid id is refused; delete-all removes every file, including temporary and orphaned ones.
- History log: delete by `runId` removes both lines and keeps every other line byte-for-byte; delete by `time+target` removes only the matching line(s) with no `runId`; delete-all empties it; a delete queued alongside an append keeps the appended line; a missing log is fine.
- Server routes: guard enforced (no token → refused); bad id → 400; success shapes as above.
- Page (text tests in the existing `tests/*-page.test.mjs` style): Delete per row with a "Delete search:" accessible name, Delete all present, confirmations wired through `confirmAction`, buttons disabled while a run is active, focus moves to the heading after delete, and the `?v=` versions are bumped.
- Then `npm test` (currently 470) with 0 failures, plus a browser check: delete one, delete all, keyboard only, both themes, and axe at 0 violations.

## Left to the builder

File and function names; exact status and toast wording within the plain-words rule.
