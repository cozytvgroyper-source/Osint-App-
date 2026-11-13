# Handoff: Deep Search, current state

Updated 2026-11-13 · Repo: `cozytvgroyper-source/Osint-App-` · Branch: `main`

**Rule:** when this handoff goes stale, delete it rather than marking it historical. Git history keeps the old text.

## Where things stand

The Deep Search redesign and the person-results refine are built, tested and merged into `main`. Don't rebuild them or reopen the approved decisions.

| PR | What it did |
|---|---|
| [#88](https://github.com/cozytvgroyper-source/Osint-App-/pull/88), [#89](https://github.com/cozytvgroyper-source/Osint-App-/pull/89) | Deep Search engine, then the search, progress and results pages |
| [#92](https://github.com/cozytvgroyper-source/Osint-App-/pull/92) | Delete one search, or all searches, from the Run history |
| [#93](https://github.com/cozytvgroyper-source/Osint-App-/pull/93) | Dropped the dead ASN tool; GreyNoise is skipped for private IPs |
| [#94](https://github.com/cozytvgroyper-source/Osint-App-/pull/94) | Person-results refine: working profile links, the a/b/c confirmation rules with levels, Connected details, and folded unconfirmed or unavailable accounts |

**Design and plan:** these are the authority for intended behaviour.
- [Redesign design](../superpowers/specs/2026-11-13-deep-search-redesign-design.md)
- [Results-refine design](../superpowers/specs/2026-11-13-deep-search-results-refine-design.md)
- The matching plans are in `docs/superpowers/plans/`.

**Tests:** `npm test` passes, 534 tests.

## Checks done after PR #94

**axe-core 4.10.2** on the results page at 1280 px, with all folded sections opened:
- **0 violations** in both light and dark.
- With 200+ cards on the page, wait about 2 seconds after switching theme; 600 ms isn't enough while the buttons fade.
- The ~97 "incomplete" contrast items are text over the page gradient. That's expected.

**The owner's real username run**, re-opened in a throwaway copy that was then deleted (counts only):

| What | Count |
|---|---|
| Confirmed accounts | 0 (correct: a username alone confirms nothing) |
| Folded "same username, not confirmed" | 213 |
| Folded "not found or couldn't check" | 21 |
| Links checked | 210, all clean `http(s)` profile pages |
| Links with a `\n` or a JSON/API address | 0 |
| Accounts showing "No page address" | 3 |

## Open items

1. **GHunt:** the owner needs to run `ghunt login`. A throwaway Google account is recommended.
2. **Live GreyNoise check:** run a Deep Search of `8.8.8.8` once the tool servers are running.
3. **Website results** ("Things to fix") are parked until the owner has a site to test.
4. **Minor findings, not urgent:**
   - `node.js`-style usernames are treated as domains.
   - `confirmedWithout` in `public/deep-linking.js` recomputes for each account (~280 ms worst case).
   - The outer fixed point stops silently at 10 passes.
   - The shared-platform host list in `deep-linking.js` is hand-picked.
   - In theory, an account could back itself up through a non-account fact it caused.
   - `tableEvidence` has an unused `subject` parameter.

## Practical notes

- **The checkout folder name ends with a space** (`Mac app `). Always quote paths.
- **The owner's saved runs** are in this repo's git-ignored `work/deep-search-runs/`.
  - Run history reads `work/deep-search-audit.jsonl`.
  - A throwaway test copy needs both the run file and that run's audit line.
- **Throwaway server:**

  ```bash
  PORT=4199 PUBLIC_DESK_TOKEN=<random> node server.mjs
  ```

  Then open `http://127.0.0.1:4199/#access=<token>`.
- **axe-core** is git-excluded as `public/__axe-test.js`.
  - Load it with a `<script src>`, because the CSP is `script-src 'self'`.
  - Rule sets: `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, `best-practice`.

## Working rules

- **Plain language** with the owner; they aren't a developer.
- **Test first** for every change and fix.
- **Commits:**
  - Stage explicit paths only (never `git add -A` or `git add .`).
  - Work on a fresh branch from `main`.
  - Stop and ask before pushing, opening a PR, merging or reverting.
- **Never commit** `work/`, `public/__*`, `.superpowers/` or `tests/fixtures/deep/raw/`.
- **Fixtures** use stand-ins only: `ownername`, `owner@example.com`, `Owner Example`, `owner-site.example`, `Example City`.
- **Never print or commit** the owner's identifiers or tokens. Report counts only from their real runs, and only with their OK.
- **Don't spend credits,** run live OSINT searches, contact targets, install tools or connect accounts without explicit approval.
- **Views:**
  - Views are DOM-free and return escaped HTML.
  - Heading order is h1 → h2 → h3.
  - Pivot accessible names start with `Pivot:`.
- **Main Search** (`search-query.js`, `search-planner.js`) stays unchanged unless the owner asks.
