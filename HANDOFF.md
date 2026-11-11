# Public Desk handoff

Updated 2026-11-11 (security hardening, CI, progressive results, search pivots and Deep Search workflow).
`CLAUDE_CODE_HANDOFF.md` records the plan and verification of Codex's hardening pass; this file is the current
reference. `CODEX_HANDOFF.md` briefs Codex on the work since then and the remaining search-overhaul work. First written
2026-11-10; it replaces the original Codex handoff, which lived outside the repo and is now out of date.

## Objective

Public Desk (formerly SignalDesk) is a private, local macOS web app that connects to MCP servers and presents OSINT
results in a readable, category-based interface. Keep it local-first, simple to run on this Mac, passive by default,
and honest about what sources did and did not return.

## Repository and where it runs

- Repository: `cozytvgroyper-source/Osint-App-`, branch `main`.
- Mac checkout: `~/Documents/Codex/2026-11-10/public-desk` (renamed from `signaldesk`).
- The old Codex copy is archived at `~/Documents/Codex/2026-11-10/xn-archived-2026-11-10`. Nothing runs from it.
- Address: `http://127.0.0.1:4173` (unchanged by the rename).
- Workflow: one feature branch and one pull request per change; don't commit straight to `main`. GitHub CLI (`gh`) is installed
  and signed in as `cozytvgroyper-source`, so `git push` and `gh pr create` work from this Mac. Merge only when the
  user says "send it".

## Run and verify

Double-click **Start Public Desk.command** and **Stop Public Desk.command**, or `npm start` for the interface only.

Before every PR:

```bash
for f in server.mjs public/*.js scripts/*.mjs; do node --check "$f"; done
npm test          # node --test tests/*.test.mjs (no dependencies)
git diff --check
```

GitHub Actions (`.github/workflows/ci.yml`) runs the syntax checks, `py_compile`, `zsh -n` on the launchers and
`npm test` on Node 20 and 22, on macOS runners (free for this public repo), for every pull request and push to
`main`. macOS has zsh and lsof built in, so CI downloads no packages; Ubuntu runners needed zsh from apt, which a
runner DNS outage blocked for over an hour on 2026-11-11. For UI changes, also exercise the feature in
a browser and report what you observed.

## Architecture

| File | Role |
|---|---|
| `server.mjs` | Local HTTP server: static files, MCP Streamable HTTP proxy (`/api/mcp`, 45 s timeout), Consensus OAuth, guarded uploads |
| `public/app.js` | UI state, MCP connections, rendering, main-search orchestration, file analysis, IntelMap News |
| `public/search-query.js` | `extractTarget`, `splitTarget`, `searchIntent`, `argsForSearch`: what the search is about and what each tool receives |
| `public/search-report.js` | `buildSearchReport`: the result window from whichever sources have answered so far |
| `public/search-planner.js` | `explainSearchPlan` / `planSearchTools` (tool selection) and `summarizePlanDiagnostics` |
| `public/result-classifier.js` | `classifyToolResult`: whether a response is data, empty, or an error |
| `public/tool-health.js` | Per-tool working/failing counts and the "N of M servers connected" label |
| `public/browser-storage.js` | Safe loading and saving of browser data: damaged entries are skipped, evidence is capped (100 items, 2.5 MB), bearer tokens are never stored |
| `scripts/endpoint-policy.mjs` | Which MCP addresses the server may call: the bundled `127.0.0.1:8892–8894` endpoints, or public HTTPS addresses (checked after DNS and on every redirect) |
| `scripts/service-ownership.zsh` | Launcher checks that a port or saved PID belongs to this folder before reusing or stopping it; fails closed without `lsof` |
| `tests/fixtures/mcp-tools.json` | The real 240-tool list from the three local servers; planner tests run against it |
| `scripts/bind-loopback.mjs` | `node --import` preload: servers that name no address listen on 127.0.0.1 only |
| `scripts/api-keys.mjs` | The 14 keyed data sources (fields, tools fed, sign-up link, note) and the `work/api-keys.env` format: parse, update, status |
| `scripts/live-api-keys.mjs` | Data service preload: keeps its environment in step with `work/api-keys.env`, so panel changes apply without a restart |
| `config/api-keys.env.example` | Template the launcher copies to `work/api-keys.env` on first start |
| `scripts/apply-open-osint-patches.zsh` | Applies `patches/*.patch` to the Open OSINT checkout before its data service starts; skips applied ones, warns on ones that no longer fit |
| `patches/` | Public Desk's fixes to Open OSINT's own code (see Known limitations: cyber threats) |
| `scripts/abuse-ch-auth.mjs` | `node --import` preload: adds the saved abuse.ch key to MalwareBazaar and ThreatFox requests |
| `scripts/intelx-host.mjs` | `node --import` preload: sends `get_intelx` from `2.intelx.io` (paid) to `INTELX_API_ORIGIN`, default `free.intelx.io` |
| `scripts/default-user-agent.mjs` | `node --import` preload: `fetch` calls with no User-Agent send `PublicDesk/1.0` instead of `node` |
| `scripts/run-osint-mcp-guarded.py` | Starts Open OSINT's MCP server with a Host-header check (FastMCP 3.x has no setting) |
| `Start/Stop Public Desk.command` | Mac launcher; see the launcher section below |

## Bundled connections

| Server | Address | Notes |
|---|---|---|
| Open OSINT | `127.0.0.1:8892/mcp` | 107 tools; started from the adjacent `omprehensive-osint-toolboxes-osint-mcp-by/downloads/osint-mcp` |
| OSINT Toolbox | `127.0.0.1:8893/mcp` | 17 tools |
| Omega MCP | `127.0.0.1:8894/mcp` | 116 tools; pinned `omega-mcp-server` + `omega-cli` from GitHub with `mcp==1.30.0` |
| Consensus | `mcp.consensus.app/mcp` | OAuth; the sign-in is saved to `work/consensus-auth.json` (0600) and restored on restart |

The Open OSINT data service behind 8892 runs on `127.0.0.1:8080`. All five local services listen on `127.0.0.1` only.

## Security model

Public Desk serves your Mac only; every protection below was reproduced as an attack before it was fixed.
Keep them when changing the server or launcher.

- **Public Desk server (`requestGuard` in `server.mjs`):**
  - every request must carry this app's Host (127.0.0.1, localhost or [::1] on its port), which blocks DNS rebinding;
  - `/api/` requests are refused when `Origin` or `Sec-Fetch-Site` shows another site;
  - API POSTs must be `application/json`, which blocks the no-preflight cross-site POST;
  - page and file GETs need only the Host check, so the return from the Consensus sign-in works;
  - the Consensus callback is exempt and protected by its one-time `state`.
- **Security headers** (`SECURITY_HEADERS`, on every response): a strict CSP (own scripts and styles only; fetches
  only to itself and `intelmap.watch`; `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`,
  `no-referrer`, same-origin COOP/CORP. The page must stay free of inline scripts and styles.
- **MCP servers:** Toolbox and Omega run with `FASTMCP_HTTP_HOST_ORIGIN_PROTECTION=true` (forged Host → 421) on
  `fastmcp-slim==4.1.8`. The version is pinned because that setting's name is version-specific; re-check the 421
  before raising it. Open OSINT runs through `run-osint-mcp-guarded.py` (forged Host → 400).
- **Data service:** started with `bind-loopback.mjs`, because its own code calls `listen(8080)` with no address,
  and with `default-user-agent.mjs`, because rdap.org (behind `get_whois`) answers Node's default `node`
  User-Agent with HTTP 403. About 22 of its 37 fetching modules set no User-Agent of their own. It also loads
  `intelx-host.mjs`, because free Intelligence X keys get 401 from the hardcoded `2.intelx.io`.
- **Upload and sign-in:** uploads are size-limited, renamed, written 0600 in a 0700 folder and deleted after
  analysis; any left behind expire after 30 minutes and are swept at server start. Pending Consensus sign-ins
  expire after 10 minutes (at most 20, oldest dropped).
- **MCP destinations and responses:** the server calls only the bundled local MCP endpoints or public HTTPS
  addresses, re-checking every redirect (`scripts/endpoint-policy.mjs`); a refused address is answered with 400.
  Responses are capped at 5 MB, and event streams at 1,000 events of at most 1 MB each.
- **API keys:** the user's keys live in `work/api-keys.env` (0600, git-ignored; `work/` is 0700), written only by the
  Data sources panel (`POST /api/data-sources[/connect|/disconnect|/remove]`, behind the same request guard) or by
  hand. Writes go to a private temporary file renamed into place, one at a time. Only the Open OSINT data service
  reads the keys (`live-api-keys.mjs`); the file is parsed as text, so nothing in it runs. Only allowlisted
  data-source keys are used (no AI or hosting keys, which spend credits). Responses and logs carry statuses and key
  names, never values; the panel's key inputs are password fields cleared when the dialog closes. Never read,
  print or commit that file.

## Main search

1. `extractTarget` finds a domain (including from a URL), IP, email, `@username`, CVE, hash or phone number.
2. `searchIntent` picks the intent from the target, otherwise from topic words (plurals are recognised).
3. `explainSearchPlan` scores every connected tool against the search words, with the target's own text removed, and
   against the topic words. It selects up to 6 tools, at most 4 per server.
4. `argsForSearch` sends a tool only the target when there is one. Otherwise it sends the subject: the phrase
   without the matched intent's topic words and with framing words ("in", "latest", "news", "price"…) trimmed
   from the ends, so "OFAC sanctions on Rosneft" sends "Rosneft" and "Bank of America sanctions" keeps its "of".
   This matters because Open OSINT's `search` parameter keeps only items containing the whole value.
5. `classifyToolResult` sorts each response; only real data becomes a result category. When there are no findings,
   errors and empty answers appear under Unavailable Sources with their actual reason.
6. The result window opens at once with a **Still Running** list, and each source's findings appear as it answers.
   Repeated simple domain, host, email, IP and URL lists are consolidated across tools, with every contributing
   source named; rich certificate and registration records stay intact. Findings are followed by an inline
   **Sources** log and then Related Links. The source log records each
   tool's server, risk tier, planner reason, exact arguments, start and finish times, and data/empty/error outcome;
   it is retained in saved evidence and investigation history. A newer search makes an older one's late answers stale.
7. Exact domain, IP-address and email values in findings have a **Pivot** button. It closes the current result and
   runs that value through the same passive main-search planner; it never bypasses the passive-tool boundary.

Never auto-run, but still available in Tool Library:

- tools whose name or description indicates active probing (port scans, fuzzing, brute force, zone transfer or zone walk, crawling, and similar);
- Omega tools outside the reviewed passive allowlist (`OMEGA_AUTO_SEARCH_TOOLS`);
- `subfinder`, which took 31–58 s whatever its per-request `timeout`; its wrapper exposes no total time limit
  (subfinder's own `-max-time`).

`theHarvester` does run automatically, but `AUTO_SEARCH_ARGS` in `search-query.js` limits it to
`crtsh,hackertarget,rapiddns,otx` (11–20 s; every source took 223 s). Tool Library runs keep every source.
- map-area tools (`get_ais_vessels`, `get_aircraft`, `get_satellite_search`) unless the search contains four
  comma-separated coordinates (e.g. `vessels 24,54,26,56`). They then receive only those numbers, in the order typed;
  the order is tool-specific (`get_aircraft` documents south,west,north,east). Other tools never filter on them.

Keep this passive-by-default boundary.

Development mode: open `http://127.0.0.1:4173/?diagnostics` to add a **Planner Diagnostics** section showing the
target, the matched words, the selected tools with scores, the closest misses, and skip counts per reason.

## Data sources

The MCP servers page lists 14 keyed data sources under **Data sources**, and the workspace shows `N of 14 connected`
with a pill per connected source. Each card names the tools the source feeds and any known problem. **Connect**
pastes a key (or turns a disconnected one back on), **Disconnect** keeps the key but stops using it
(`PUBLIC_DESK_DISABLED=` in the file), **Change key** replaces it and **Remove** deletes it. Keys are not verified
on Connect (the user chose this), so a wrong key shows up only as missing data in searches.

## Server cards

Each connected server shows `N tools · W working · F failing · U not yet run`, based on each tool's latest outcome in
main searches and Tool Library runs (stored in `localStorage`). The workspace shows `N of M MCP servers connected`.

## Launcher

`Start Public Desk.command` checks MCP bridges with an MCP `initialize` request; a plain GET always gets HTTP 400.
It reuses services that are already running and refuses to start when Public Desk or a bridge on its port belongs to
another folder, naming the folder to stop. Every service port is checked by folder and command marker
(`scripts/service-ownership.zsh`), and `Stop Public Desk.command` stops a saved PID only if it passes the same check.

## Files, news and external links

- **File search:** the main search accepts files up to 50 MB, analyses them locally with OSINT Toolbox
  `exiftool_metadata`, and deletes the temporary upload afterwards. Don't send uploads to external providers without
  explicit approval.
- **News view:** reads IntelMap's official JSON feed (`https://intelmap.watch/api/feed/`). The user removed the
  "Open IntelMap" header button; don't restore it unless asked.
- **IntelMap and Situation Room:** external sidebar links. Both block iframes, so don't proxy around that. On
  2026-11-10 the user chose to keep Situation Room as an external link rather than build a local view.

## Known limitations

- **No extra local MCP servers:** the destination policy allows only the three bundled local endpoints and public
  HTTPS addresses, so a new local MCP server needs an entry in `scripts/endpoint-policy.mjs`.
- **DNS can change between check and call:** an added server's address is checked, then fetched with a fresh DNS
  lookup, so a hostile server you add yourself could switch to a private address in between.
- **Data service CORS:** the third-party data service lets `worldmonitor.app` / `h1dr4.dev` pages read its responses
  (public OSINT data). It is no longer reachable from the network.
- **Upstream failures, not app bugs:**
  - GreyNoise returns 404 for IPs it has no record of.
  - MalwareBazaar and ThreatFox answer 401 until an abuse.ch key is connected in Data sources.
- **API keys:** none are filled in by default; connect them in the Data sources panel, which links each source's
  sign-up page. OTX and AbuseIPDB feed `get_cyber_threats`; Intelligence X feeds `get_intelx`.
- **Cyber threats (patched):** two launcher-applied patches fix Open OSINT's threat feed. Its `cyber_threats` tool sent
  `limit`, but the feed reads `page_size`; the missing value became 0, clamped to a page size of **1**. And the feed,
  built for a map, discarded every threat its rate-limited free geolocation lookups could not place.
- **Cyber threats still rank C2Intel first:** the feed sorts by severity before cutting the page. C2Intel entries are
  HIGH and OTX entries MEDIUM, so a 10- or 50-item search shows only C2Intel; OTX appears after all HIGH entries.
- **AbuseIPDB's free blacklist allows 5 requests a day.** A launcher-applied patch caches the full list for 6 hours
  in the data service (at most 4 requests a day) and keeps the last list when a refresh fails, retrying after an
  hour. The cache is in memory, so each data-service restart costs one request.
- **Vessel positions (patched):** Open OSINT's `ais_vessels` called `api.aisstream.io`, which does not exist. A
  launcher-applied patch rewrites it to subscribe to AISStream's WebSocket stream, listen up to 10 s (or until
  `limit` ships) and disconnect, using Node's built-in WebSocket. Coverage depends on AISStream's volunteer
  receivers: the North Sea and English Channel return ships, the Persian Gulf usually returns none.
- **abuse.ch:** Open OSINT sends the Auth-Key only for URLhaus; `scripts/abuse-ch-auth.mjs` (a data-service preload)
  adds the saved `URLHAUS_AUTH_KEY` to MalwareBazaar and ThreatFox API requests, and never to other hosts.
- **Omega quirks:** Omega turns some network failures into an empty "ok" result, so "no results" isn't proof.
  `omega_monitor` always fails (not implemented in omega-cli).
- **Empty-result wrappers:** some Open OSINT tools return explanatory text and counters alongside empty result arrays.
  The classifier can count those wrappers as data, so a deliberately nonexistent target may show a source section
  with zero matching records instead of the consolidated "No results returned" message.
- **Domain-like words:** tokens such as "node.js" are treated as domain targets.
- **Subject trimming is word-list based:** a name that contains its own topic word loses it ("Port of Rotterdam"
  sends "Rotterdam"), and a topic-only search such as "latest ransomware" still sends "ransomware" as a filter.
- **Speed:** fast sources now show within seconds, but a domain search still takes about 25–35 s to finish,
  because the final summary waits for the slowest lookup.
- **Legacy internal names:** browser storage keys keep the `signaldesk.` prefix, and the launcher's PID and log
  file is `signaldesk.*`, so saved data and the old launcher keep working. Don't rename them without a migration.

## Recommended next work

1. **Search overhaul:** follow `docs/search-overhaul.md`. Step 1 (risk tiers in Tool Library) is merged (PR #33), and
   the owner decided A–D on 2026-11-11: Sources panel inline, Intrusive included in Deep Search, no saved scope list,
   all 14 best-guess tiers confirmed. Step 2 is complete: inline Sources, duplicate consolidation and passive pivots
   for IPs, emails and domains are implemented. Step 3 is complete: Deep Search has explicit scope and level controls,
   a selectable plan, authorization and typed Intrusive confirmation, sequential execution, Cancel, server-enforced
   grants and the private local audit log. Step 4 has started: `omega_breach` is approved for automatic search after
   a live structured response; `omega_archive` and `omega_threatintel` returned only `completed` and remain manual.
   Continue the same evidence-based review of the remaining Tier 0 Omega tools.
2. Decide with the user whether cyber searches should mix sources instead of strict severity order, so OTX shows
   up in short result lists (another patch to the feed's sort). The user chose not to do this for now.
3. subfinder can only rejoin the automatic search if `osint-toolbox-mcp` exposes subfinder's `-max-time` (an
   upstream change; its `timeout` limits each request, not the run). Checked 2026-11-11: neither 1.1.0, the latest
   release, nor the GitHub `main` branch exposes it; asking the maintainer would be a public post, so needs approval.

## Working rules from the user

- Lead with results; say plainly what was verified and what wasn't.
- Make the smallest change that fully solves the problem. Add tests with every behavior change, and don't mix
  refactors with behavior changes in one commit.
- Don't spend paid API or generation credits, enable active reconnaissance, or delete data without asking.
- Mark uncertain identity matches as unconfirmed; OSINT results are leads, not proof.
