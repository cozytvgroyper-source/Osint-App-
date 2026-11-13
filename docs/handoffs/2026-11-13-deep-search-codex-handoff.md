# Handoff: Deep Search redesign (for Codex)

Date: 2026-11-13 · Repo: `cozytvgroyper-source/Osint-App-` · Branch: `deep-search/redesign` (from `main` at `2701562`)

## 1. Your job, in one paragraph

Build the **Deep Search redesign** described in the approved design and the build plan:

- **Design:** [docs/superpowers/specs/2026-11-13-deep-search-redesign-design.md](../superpowers/specs/2026-11-13-deep-search-redesign-design.md)
- **Plan:** [docs/superpowers/plans/2026-11-13-deep-search-redesign.md](../superpowers/plans/2026-11-13-deep-search-redesign.md)

Deep Search becomes a one-box search. A regular person types an email, username, website or IP. The app runs **every** reviewed tool that fits the target and the chosen level, follows leads for people (up to 3 rounds), shows a live progress page, and ends on a results page that shows **only linked, sourced findings**. The owner's main use is people and accounts.

Both documents are approved. Don't re-open decisions in them; ask the owner if something truly blocks you (§8).

**Read in this order:** this handoff → the design → the plan → the files named in plan Task 2 onwards.

## 2. The project in five minutes

**Public Desk** is a local-first web app for running OSINT tools over MCP (Model Context Protocol) servers. It runs only on the owner's Mac, bound to `127.0.0.1`.

- **Stack:**
  - plain HTML, CSS and ES modules in `public/`
  - a Node ≥ 22 server, `server.mjs`
  - helper modules in `scripts/`
  - tests with `node --test` in `tests/*.test.mjs`
  - no framework, no build step, no runtime dependencies (no `node_modules` needed for the app or tests)
- **Commands:**

  ```bash
  npm test
  ```

  On `main` at `2701562` this gives **411 passing, 0 failing**.

  ```bash
  npm start
  ```

  This starts only the app, on port 4173, and prints a private address with `#access=<token>`.
- **Full stack:** `Start Public Desk.command` (macOS) starts five services:

  | Service | Address |
  |---|---|
  | Open OSINT data service | `127.0.0.1:8080` |
  | Open OSINT MCP | `127.0.0.1:8892/mcp` |
  | OSINT Toolbox MCP | `127.0.0.1:8893/mcp` |
  | Omega MCP | `127.0.0.1:8894/mcp` |
  | the app | `127.0.0.1:4173` |

  The launcher's access token is in `work/runtime/public-desk-token`; never print or commit it. A fourth server, Consensus, is remote and signed in through OAuth.
- **API guard** (`requestGuard` in `server.mjs`): every `/api/*` call needs all of these:
  - the right `Host`
  - no cross-site `sec-fetch-site`
  - an own `origin`
  - JSON `content-type` for POST
  - the header `x-public-desk-token: <token>`

### Map of the code that matters for this job

| File | What it is |
|---|---|
| `public/app.js` | All page wiring: one big module. Deep Search today is `buildDeepPlan`, `renderDeepPlan`, `runDeepSearch` (~line 650–685), `loadDeepHistory`, `addDeepLog`. `callTool(tool, serverId, args, grant, options)` is at ~460; `confirmAction`, `openDialog`, `switchView`, `saveLastResultToCase` and `allTools()` are also there. |
| `public/index.html` | Every view as a `<section class="view">`. Deep Search is `#deep` (~line 87). |
| `public/deep-search.js` | Today: `DEEP_SEARCH_TOOLS`, `deepSearchPlan`, `deepRunBlocked`. **Rewritten in Task 2.** |
| `public/tool-tiers.js` | The safety model: `TIERS`, `toolRisk(tool)` (tier per server and tool; unreviewed counts as Intrusive), `runRequirements`. |
| `public/search-query.js` | `extractTarget`, `argsForSearch(tool, query)`, `searchIntent`. |
| `public/result-classifier.js` | `classifyToolResult(result)` gives `{kind:'data'|'empty'|'error'}`. |
| `public/search-dedup.js` | `extractIndicatorLists`, `consolidateIndicatorLists`. |
| `public/ui.js` + `public/ui.css` | Design-system building blocks and tokens: `escapeHtml`, `button`, `card`, `badge`, `emptyState`, `term`, `pageHeader`. `ui.css` is the **only** stylesheet. |
| `public/search-results-view.js`, `evidence-view.js`, `servers-view.js`, `tools-view.js` | Examples of the DOM-free view pattern to copy. |
| `scripts/run-grants.mjs` | Server-side run grants: `createRunGrant`, `authorizeMcpToolCall`, `pruneRunGrants`. |
| `scripts/deep-search-audit.mjs` | Append-only audit log in `work/deep-search-audit.jsonl`. |
| `scripts/cases.mjs` | `CaseStore`; copy its atomic, `0600` write pattern for the run store. |
| `server.mjs` | Routes. `/api/mcp` is ~line 489, `/api/run-grants` ~499, `/api/deep-search/audit` ~514. |
| `tests/fixtures/mcp-tools.json` | The 245 real tool definitions from all four servers (names, descriptions, input schemas). |

## 3. How we got here (context, not work for you)

| PRs | What they did |
|---|---|
| 79–80 | Earlier fixes. |
| 81 | The main search now ranks results by relevance and shows only results, with the tool and server that found each. |
| 82 | A deep review: bug fixes across the app. |
| 83–87 | A five-phase design overhaul for non-technical users, to **WCAG 2.2 AA**: a shared design system (`ui.css`, `ui.js`, `glossary.js`), then the Search, Evidence, News, MCP servers, Tool library and Deep Search pages, then one stylesheet and a final accessibility audit. |

All are merged. Everything you build must keep that standard.

**The Deep Search redesign** came out of a long discussion with the owner. Its decisions are listed in the design. The most important ones:

- **People first:** email or username in; everything about that identity out.
- **One box.** The app works out the type and shows the level picker only for websites and IPs.
- **No limit on the number of tools**, only levels. For people, every tool is Passive. Active and Intrusive probing of a person's accounts would be account attacks, so it's not done.
- **Leads are followed:** up to 3 rounds, at most 25 identifiers.
- **Websites found during a person search** get **Passive and Light touch without asking**, never higher.
- **Runs happen in the page** (owner's choice), so the tab must stay open. The browser warns before closing during a run.
- **Linking is by evidence only:** no AI, no photo matching. A username-only match is "possible", folded away.
- **Results:**
  - person: a summary card first, with the trail of leads folded under each account
  - website: overview first, "Things to fix" below
- **Real tool answers** are recorded first, on the owner's own identifiers, and everything that reads answers is built and tested against those recordings.

## 4. What exists on the branch now

```
3b70e17 docs: Deep Search redesign implementation plan
3c0fb7d docs: Deep Search redesign design
```

- **Nothing is built yet.** The branch is local on the owner's Mac. If you can't see it, ask the owner to push it.
- **Facts already checked in the code** (don't re-derive them):
  - Today Deep Search **throws away results**: it only logs "Finished <tool>."
  - 50 reviewed Light touch, Active or Intrusive tools exist; only 11 are in `DEEP_SEARCH_TOOLS`. Above Passive, only website and IP targets have tools.
  - Person tools are all Passive. **Sherlock and Blackbird return only site and URL**, while **Maigret extracts profile fields** (names, links, IDs), as do GHunt and Omega's identity, socmint and gitrecon. That is why most "linked" evidence comes from Maigret, GHunt, Holehe, breach tools and the Omega identity tools.
  - Deep Search grants today last **15 min**, allow ≤ 25 calls, and the server keeps ≤ 100 grants (oldest evicted first). Grant-backed calls time out at **120 s**; Passive calls, which need no grant, at **45 s**.
  - The tool servers' source isn't in this repo, so the real output shapes are unknown until Task 1 records them.

## 5. Working rules the owner expects

- **Plain language** in everything the user sees and in messages to the owner. They aren't a developer.
- **Test first.** Every task writes failing tests, watches them fail, then implements. Fixes also start with a failing test.
- **Git:**
  - Work on `deep-search/redesign`.
  - **Stage explicit paths** (never `git add -A` or `.`).
  - One commit per task, using the messages in the plan.
  - **Never push, open a PR or merge without the owner saying so.** The owner's go-ahead has been "Push and open PR".
  - The plan splits the work into **PR 1** (Tasks 1–7) and **PR 2** (Tasks 8–11).
  - Earlier commits end with a `Co-Authored-By:` line for the agent that wrote them. Use your own attribution, not Claude's.
- **Never commit:**
  - `work/` (git-ignored)
  - `public/__*.js` (test-only browser helpers)
  - `.superpowers/`
  - `tests/fixtures/deep/raw/`

  The first three are excluded locally through `.git/info/exclude`. In a fresh checkout, add `public/__*` and `.superpowers/` there, and add `tests/fixtures/deep/raw/` to `.gitignore` (plan Task 1).
- **The owner's identifiers** (email, username, phone, website, IP) come only from chat. Keep them in a scratch file outside the repo. Committed fixtures use the stand-ins in plan Task 1. Don't send them anywhere except the local tool servers.
- **The tool table belongs to the owner.** In Task 1, show them every change to which tools run before committing it.
- **Report honestly:** say what passed, what failed, and what you couldn't check.

## 6. Conventions and gotchas (learned the hard way)

- **CSP is `script-src 'self'; style-src 'self'`.** No inline scripts, styles or `eval`.
  - For browser test helpers, write a git-excluded module in `public/__name.js` and `import()` it from the page.
  - For CSS probes in a browser, use the CSSOM (`sheet.insertRule`), not a `<style>` tag.
- **Cache-busting:** every module import and the `index.html` links use `?v=N`. When a module changes, bump its `?v=` everywhere it's imported, and bump the importer's own version too. One version per module everywhere; two different URLs make two module instances. Bump `ui.css?v=` and `app.js?v=` in `index.html` when they change.
- **View modules are DOM-free** and return escaped HTML strings. Tests import them under Node and assert on the strings, including heading order and escaping of hostile input. Markup and wiring tests read `index.html` and `app.js` as text with regexes; follow the existing `tests/*-page.test.mjs` style.
- **Accessibility patterns already in the app.** Reuse them, don't reinvent:
  - `openDialog(dialog)` returns focus only if focus is stranded.
  - `confirmAction({title, message, confirmLabel})` starts focus on Cancel, cancels only on a click **outside** the dialog box, and refuses a second confirmation while one is open.
  - `setupMenu(button, menu)` implements the WAI-ARIA menu pattern.
  - Live regions (`role="status"`) are written **only when their text changes**.
  - After any action that removes the focused element, move focus somewhere sensible.
  - `aria-pressed` is used for toggles, `<details>` for folds, and `.visually-hidden` for screen-reader-only headings.
- **Heading order:** h1 page → h2 → h3 → h4, never skipping. Axe's `heading-order` caught this in phase 5.
- **Names:**
  - Pivot buttons are `Pivot →` with an accessible name that **starts with "Pivot:"** (WCAG 2.5.3).
  - Keep the terms "MCP server", "Tool library", "Passive", "Light touch", "Active", "Intrusive" and "Pivot".
  - **Never show the words "Run grant"** in the UI.
- **Contrast:**
  - `tests/design-tokens.test.mjs` computes WCAG contrast for every token pair in both themes, and checks rule specificity inside the single `ui.css`.
  - Use existing tokens (`--ink`, `--muted`, `--surface`, `--accent-dark`, `--danger` and so on).
  - The sidebar is navy in both themes.
- **Axe in a browser:** use axe-core **4.10.2**, saved as git-excluded `public/__axe-test.js`, with the rule sets `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa` and `best-practice`. **Wait at least 600 ms after switching the theme**, because the 150 ms transitions cause false contrast failures.
- **The local API from a browser:** open `http://127.0.0.1:4173/#access=<token>`. The page moves the token into `sessionStorage` (`publicDesk.access`) and sends it as `x-public-desk-token`.
- **Safety model:**
  - The **server** enforces tiers. `authorizeMcpToolCall` refuses any call above Passive unless a matching, unused grant exists for the same target, endpoint, tool and **exact arguments**.
  - Don't weaken any existing check. Task 3 relaxes exactly one thing: Deep Search grants **at Light touch or below** need only the acknowledgement. Active still needs "I own this target or have written permission", and Intrusive also needs the typed target. A test must prove an Active call is refused under an acknowledgement-only grant.
- **Main search vs Deep Search:** don't change the main search's detection or planning (`search-query.js`, `search-planner.js`). Deep Search's "a single word is a username" rule lives only in `deep-search.js`.

## 7. Suggested order (and what needs the owner)

The plan's task order assumes the owner is available for Task 1 at the start. A workable order if they aren't yet:

| Step | Task | Notes |
|---|---|---|
| 1 | **Task 2** | Use the design's §6.6 table as a provisional `DEEP_TOOLS`. Mark it provisional in a code comment. |
| 2 | **Task 3** | Server rules. The recorder needs the long timeouts this adds. |
| 3 | **Task 1** | **Needs the owner.** They start the app with `Start Public Desk.command` and give their identifiers in chat; you run the recorder on their Mac. Then correct `DEEP_TOOLS`, write `docs/deep-tool-review.md`, and **show the owner the table changes**. |
| 4 | **Tasks 4 → 7** | Answer reading, linking, engine, run store. Then **stop for a whole-branch review and the owner's "Push and open PR"** for PR 1. |
| 5 | **Tasks 8 → 11** | Pages and the final audit. Task 11 needs the owner again, for one real person search and one real website search. |

**If your environment can't reach the owner's local tool servers** (for example, you run in a cloud sandbox), you can't run Task 1 or the real searches in Task 11. Build everything else against the plan. Leave those steps for the owner, with exact commands, and say so plainly in your report.

## 8. Stop and ask the owner when…

- You need their identifiers (Task 1), or need them to start or stop the app.
- A recorded answer shows that a tool in the design's table doesn't fit (the table changes need their OK).
- A safety rule would have to change beyond plan Task 3.
- A design decision seems wrong for a real-world reason. Say what you found, give a recommendation, and wait.
- You're ready to push or open a PR.

## 9. Definition of done

- [ ] All 11 plan tasks done with their tests.
- [ ] `npm test`: 0 failures. Report the new total.
- [ ] Axe: 0 violations on every state in plan Task 11, in both themes at 1280 and 375 px.
- [ ] A keyboard pass of the whole flow, with focus going where the design §10 says.
- [ ] The owner has run one real person search and one real website search, and every linked finding is explainable from its trail.
- [ ] No owner identifiers, tokens, `work/`, `public/__*`, `.superpowers/` or `tests/fixtures/deep/raw/` in git.
- [ ] A whole-branch review has been done and its findings fixed with tests.
- [ ] PR 1 and PR 2 opened only after the owner said so. PR bodies list what was verified and what wasn't.
