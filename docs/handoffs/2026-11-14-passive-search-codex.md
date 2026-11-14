# Handoff to Codex: Passive search (stopped partway through Task 6)

Date: 2026-11-14 · Branch: `design/passive-search` (not pushed, no PR) · Delete this file once the branch is merged.

## What this work is

The owner asked for the main Search page to become **Passive search**, covering **names, companies and news only**:

- Websites, IPs, usernames, emails, phones, CVEs and hashes go to Deep Search.
- Results are grouped by meaning, and each is shown once.
- Every result has its own **Save to case** button.
- Event searches get a **Newest first / Most relevant** news sort.
- The ⌘K button and shortcut are removed, and so is the blue focus box on the search field.
- News works again.

Read these two first. They are binding:

- **Spec:** `docs/superpowers/specs/2026-11-14-passive-search-design.md` (owner-approved).
- **Plan:** `docs/superpowers/plans/2026-11-14-passive-search.md`. Its **Global Constraints** section holds the exact UI copy; use it verbatim. Tasks 6, 7 and 8 are the remaining work.

## Done and committed (Tasks 1–5, each reviewed until clean)

| Task | Commits | What |
|---|---|---|
| 1 | e640f8c, c2f2bd7 | `scripts/require-loopback-token.mjs` adds the launch token to the data service's calls to **its own** loopback origin, so RSS/GDELT stop returning 401. Tests: `tests/local-service-auth.test.mjs`. |
| 2 | 9715a62 | `scripts/cases.mjs` `addEvidence` accepts an optional `note`. |
| 3 | 29357e6, 49e4572, 7e4f11c | `public/passive-search.js`: `passiveQuery`, `passiveSources`, `addCompanySources`. Never uses `get_hn_search`. |
| 4 | 7137195 … c2cf27f | `public/passive-results.js`: `passiveTier`, `buildPassiveResults`, `sortNews`. Fixtures are in `tests/fixtures/passive/`. |
| 5 | 4cd9b91, 9703b05 | `public/passive-results-view.js`: `renderPassiveResults`, `renderPassiveHandOff`, plus CSS in `public/ui.css`. |

At 9703b05, `npm test` gave 649 passing, 0 failing.

## Where it stopped: Task 6 is partly written (WIP commit)

When the owner asked to stop, an agent was midway through Task 6 ("Run Passive search in the app"). Its edits are committed as a **work-in-progress commit** (`wip(search): partial Task 6 …`, the commit that adds this file) in 9 files:

- `public/app.js`
- `public/app/core.js`
- `public/app/deep.js`
- `public/app/evidence.js`
- `public/app/results.js`
- `public/app/search.js`
- `tests/browser-flows.test.mjs`
- `tests/helpers/browser.mjs`
- `tests/ui-polish.test.mjs`

There is also a backup of that diff at `.superpowers/sdd/2026-11-14-passive-search/task-6-partial.patch`.

- **Not reviewed.** It was stopped mid-edit, so expect the work to be incomplete. `npm test` was run twice afterwards: 655 tests, with 1 failure on one run and 0 on the rerun. That looks like the known intermittent failure.
- **Review it before keeping it.** Either finish it, or revert those files to 9703b05 (`git checkout 9703b05 -- <files>`) and redo Task 6 from the plan.
- **The test removed from `tests/ui-polish.test.mjs` is an old text check.** Keep that removal only if a new browser test covers the same behaviour.

Task 6 requirements are in the plan. These rulings also apply:

1. Only one passive result is ever rendered at a time, because the view uses a fixed `id="newsSort"`.
2. `state.savedResultKeys` is cleared only when a **new** search starts, not on the live redraws of the same search.
   - Pressing Save on a saved key does nothing.
   - An in-flight set stops a second save of the same key.
   - A failed save leaves the button usable.
3. The Save status message names the case, as today's Save does.
4. The saved finding's note is `From Passive search: <query>`.
5. Don't run a search on empty or whitespace-only input.
6. Stub and fixture data use stand-ins only: `Owner Example`, `Owner Example Jr.`, `owner-site.example`, `ownername`, `Example City`, `Example Corp`. No real names and no live answers.

## Still to do

- **Task 7:** copy and chips per the Global Constraints.
  - Remove `#cmdButton`, the ⌘K handler and the "⌘K jumps here" hint.
  - Remove the `.search-row:focus-within` outline and add `#query:focus-visible{outline:none}`. All other focus markers stay.
  - Add tests for all of this.
- **Final fix wave**, for the small issues already found:
  - The hand-off plural: `<kind>s` produces "IP addresss" and "email addresss". Add "es" after a trailing "s".
  - An `{items:[]}` data answer shows up as one empty row marked found (`public/passive-results.js` ~173). It should be state `empty` with no row.
  - Empty answers are also pushed into `failed` as "Returned nothing." (~152). Remove that.
  - The rest of the deferred minor items are listed in `.superpowers/sdd/2026-11-14-passive-search/progress.md` (lines marked `minor (deferred)`). Triage them; most can stay.
- **Task 8, checks:**
  - Run `npm test` 5 times. One untraced flaky failure was seen twice under load; 14 later runs were clean.
  - Run axe 4.10.2 at 1280 px and 375 px, in light and dark.
  - Do a whole-branch review.

## The owner must approve these first

- **Restarting Public Desk** (Stop, then Start) is needed for the Task 1 news fix to take effect. Then run live passive checks: "Donald Trump", "JD Vance", "Rosneft" and "earthquakes in Chile". Also confirm the live GDELT shape matches the fixture.
- **Downloading** anything, including axe.
- **Pushing** the branch or opening a PR.

## Standing rules

- No dependencies.
- Views are DOM-free and escape everything; links go through `safeHttpUrl`.
- The CSP allows no inline scripts or styles.
- Never commit or print the owner's identifiers or tokens.
- Don't read `work/`.
- Report only real counts from real runs.
- Stage files with explicit paths.
- Delete this handoff once the branch is merged.
