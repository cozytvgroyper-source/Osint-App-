# Public Desk: handoff to Codex

> **Historical record.** This briefed Codex on 2026-11-11 for search-overhaul steps 2–4. Steps 2 and 3 are merged,
> step 4 (the Omega review) is in progress, and the PRs and test counts below are out of date. `HANDOFF.md` is the
> current handoff and `docs/search-overhaul.md` the current plan; read those instead.

Written 2026-11-11 by Claude Code, after Codex's hardening pass (`CLAUDE_CODE_HANDOFF.md`, now historical).

Repository: `/Users/randybill/Documents/Codex/2026-11-10/public-desk` (GitHub `cozytvgroyper-source/Osint-App-`).
App: `http://127.0.0.1:4173`. Start and stop it with `Start Public Desk.command` and `Stop Public Desk.command`.

## Read first

1. **`HANDOFF.md`**: the current reference for architecture, the security model, known limitations and next work.
2. **`docs/search-overhaul.md`**: the agreed plan for the work you are picking up (steps 2–4), with the owner's
   decisions A–D.
3. This file: what changed since your last pass, the rules, and the traps.

## Working rules (from the owner)

- **One branch and one pull request per change. Never commit or push to `main`.** Your last pass pushed seven commits
  straight to `main`; CI only ran after they landed, and it was red (see "What changed" #28). Open a PR and let CI
  run before anything reaches `main`.
- **Merge only when the owner says "send it", and only after CI passes** on the PR's latest commit. Auto-merge is
  disabled in the repository settings.
- **CI runs on macOS** (`.github/workflows/ci.yml`, Node 20 and 22). Free macOS runners sometimes queue for 10 or
  more minutes: wait, don't merge around it.
- Add tests with every behaviour change, and keep refactors and behaviour changes in separate commits.
- Don't spend paid credits, run active reconnaissance, or delete data without asking. Never force-push.
- **Never read, print or commit `work/api-keys.env`.** It holds the owner's API keys. To check which keys are
  loaded, read key *names* from the data-service log (`[public-desk] data-source keys: …`), never values.
- Lead reports with results, and say plainly what was verified live and what was not.

## What changed since your pass (all merged, each with CI green)

| PR | Change |
|---|---|
| #28 | Fixed your red CI: `service-ownership.zsh` hardcoded macOS's `/usr/sbin/lsof`. It now finds lsof on PATH and **fails closed** without it. Also: empty file chip hidden, page copy matches the HTTPS-only policy, refused MCP addresses return 400 (`EndpointPolicyError`), diagnostics no longer hide errors. CI moved to macOS after an Ubuntu runner DNS outage. |
| #29 | `CLAUDE_CODE_HANDOFF.md` marked historical. |
| #30 | **AbuseIPDB blacklist cached 6 h** (free plan: 5 requests a day) via a launcher-applied patch. |
| #31 | **abuse.ch key** sent to MalwareBazaar and ThreatFox by a preload (`scripts/abuse-ch-auth.mjs`). |
| #32 | **Vessel positions work**: the AIS module is rewritten for AISStream's WebSocket stream (patch). |
| #33 | **Tool risk tiers** (`public/tool-tiers.js`) and Tool Library grouped by tier, with run confirmations. |
| #34 | Design doc `docs/search-overhaul.md`. |
| #35 | **Open when this was written:** records the owner's decisions A–D and removes the 14 "needs review" markers. Check that it has merged before starting. |

## Current state

- `main` passes **151 tests** (152 once #35 merges). The running app has all four Open OSINT patches applied.
- **Data sources:** OTX, AbuseIPDB, Intelligence X and AISStream keys are connected; abuse.ch is not (MalwareBazaar
  and ThreatFox answer 401 until it is).
- **Tools:** 245 across Open OSINT (107), OSINT Toolbox (17), Omega (116) and Consensus (5). By tier: 197 Passive,
  19 Light touch, 19 Active, 10 Intrusive, none unreviewed.

## Your task: step 2, the inline Sources panel

Spec: `docs/search-overhaul.md`, "Step 2". The owner chose **inline** (decision A): completed searches show the
findings first, then a Sources section. This **replaces** the old "findings and Related Links only" rule, so update
the main-search section of `HANDOFF.md` when you build it.

For each tool the main search ran, show its server, tier badge (reuse `tierBadge()` and `toolRisk()` from Tool
Library), why it was chosen (the planner's `reason`), the exact arguments sent (from `argsForSearch`), start and
finish times, and the outcome (data, empty or error, with the error text).

Where the code is:
- `public/app.js`, `smartInvestigate()` (around line 355): runs the planned tools in parallel and fills
  `outcomes[i]`. Record start and finish times and the arguments here; `latestSearchId` guards against stale searches.
- `public/search-report.js`, `buildSearchReport()`: builds the report. Add a Sources entry and keep it out of
  `reportHasFindings()` (add it to `NOT_FINDINGS`), or a search with no findings would hide its errors.
- `public/app.js`, `renderReadableResult()`: renders the completed result.

Acceptance:
- Sources appears after the findings, for searches with and without findings, and while results are still arriving.
- Errors still appear when nothing was found.
- Saved evidence and history keep the source log.
- Tests cover the report shape and the no-findings case.
- Checked live with a domain search and a no-results search.

Also in step 2 (see the doc): merge duplicate findings across tools, and pivot buttons on IPs, emails and domains.
These can be separate PRs.

**Step 3 is complete.** Deep Search now includes its explicit scope and level selector, visible selectable plan,
authorization and typed Intrusive confirmation, sequential execution, Cancel, longer controlled timeouts and a
private local audit log. The server still refuses every call that does not match its grant. Next is Step 4's review
of Omega Tier 0 tools for useful passive coverage.

## Traps

- **Open OSINT is third-party code.** Fixes to it live in `patches/*.patch`, which the launcher applies with
  `scripts/apply-open-osint-patches.zsh`. It skips applied ones and warns on ones that no longer fit. Don't edit
  the Open OSINT checkout by hand. Its `mcp/src/osint_mcp/client.py` has an older local edit that is not ours: leave
  it alone. Patch tests rebuild the upstream lines from the patch itself (`tests/helpers/patch-fixtures.mjs`).
- **Data-service preloads**, in launcher order: `live-api-keys.mjs` (must stay first), `bind-loopback.mjs`,
  `default-user-agent.mjs`, `intelx-host.mjs`, `abuse-ch-auth.mjs`. Keys change live from the Data sources panel;
  the preloads reread `process.env` on every call.
- **Tier invariant:** `tests/tool-tiers.test.mjs` fails if the main search could auto-run any non-passive tool. Never
  weaken it. A tool missing from the tier table counts as Intrusive.
- **MCP destination policy** (`scripts/endpoint-policy.mjs`): only the bundled `127.0.0.1:8892–8894` endpoints and
  public HTTPS addresses. A new local MCP server needs an allowlist entry.
- **The page is served from the checked-out branch.** Switching branches changes the live page immediately; files
  have `?v=` cache-busting numbers in `public/index.html`, so bump them when you change a CSS or JS file.
- **Behaviour tests that run patched TypeScript** need Node's type stripping, so they skip on Node 20 and run on 22.
- **Quotas and coverage:** AbuseIPDB allows 5 blacklist requests a day (cached in memory, so each data-service
  restart costs one). AISStream returns nothing in some regions, such as the Persian Gulf; test vessel searches with
  `vessels 51.8,3.8,52.1,4.4` (Rotterdam).
- **subfinder** stays out of automatic search until its upstream wrapper exposes `-max-time`. Asking the maintainer
  means a public post, so it needs the owner's approval.

## Verify before every PR

```sh
for f in server.mjs public/*.js scripts/*.mjs; do node --check "$f"; done
for f in "Start Public Desk.command" "Stop Public Desk.command" scripts/*.zsh; do zsh -n "$f"; done
npm test
git diff --check
```

For interface changes, also exercise the feature in a browser at `http://127.0.0.1:4173` and report what you saw.
To restart with new launcher or server code, run `Stop Public Desk.command`, then `Start Public Desk.command`; Stop
should print "Stopped …" for all five services.
