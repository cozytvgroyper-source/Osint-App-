# Public Desk handoff

Updated 2026-11-11 (security hardening, CI, progressive results, topic-word trimming). First written 2026-11-10; it replaces the original Codex handoff, which lived outside the repo and is now out of date.

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
`npm test` on Node 20 and 22 for every pull request and push to `main`. For UI changes, also exercise the feature in
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
| `tests/fixtures/mcp-tools.json` | The real 240-tool list from the three local servers; planner tests run against it |
| `scripts/bind-loopback.mjs` | `node --import` preload: servers that name no address listen on 127.0.0.1 only |
| `scripts/load-api-keys.zsh` | Reads `work/api-keys.env` (KEY=value, never sourced) and exports allowlisted data-source keys |
| `config/api-keys.env.example` | Template the launcher copies to `work/api-keys.env` on first start |
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
  User-Agent with HTTP 403. About 22 of its 37 fetching modules set no User-Agent of their own.
- **Upload and sign-in:** uploads are size-limited, renamed, written 0600 and deleted after analysis; pending
  Consensus sign-ins expire after 10 minutes (at most 20, oldest dropped).
- **API keys:** the user's keys live in `work/api-keys.env` (0600, git-ignored; `work/` is 0700). The launcher
  passes them only to the Open OSINT data service, reads the file line by line so nothing in it runs, exports only
  allowlisted data-source keys (no AI or hosting keys, which spend credits), and prints key names, never values.
  Keys change only after Stop and Start. Never read, print or commit that file.

## Main search

1. `extractTarget` finds a domain (including from a URL), IP, email, `@username`, CVE, hash or phone number.
2. `searchIntent` picks the intent from the target, otherwise from topic words (plurals are recognised).
3. `explainSearchPlan` scores every connected tool against the search words, with the target's own text removed, and
   against the topic words. It selects up to 6 tools, at most 4 per server.
4. `argsForSearch` sends a tool only the target when there is one. Otherwise it sends the subject: the phrase
   without the matched intent's topic words and with framing words ("in", "latest", "news", "price"…) trimmed
   from the ends, so "OFAC sanctions on Rosneft" sends "Rosneft" and "Bank of America sanctions" keeps its "of".
   This matters because Open OSINT's `search` parameter keeps only items containing the whole value.
5. `classifyToolResult` sorts each response; only real data becomes a result category. Errors and empty answers are
   listed under Unavailable Sources with their actual reason.
6. The result window opens at once with the plan and a **Still Running** list, and each source's findings or error
   appear as it answers ("2 of 4 sources answered"). A newer search makes an older one's late answers stale.

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

## Server cards

Each connected server shows `N tools · W working · F failing · U not yet run`, based on each tool's latest outcome in
main searches and Tool Library runs (stored in `localStorage`). The workspace shows `N of M MCP servers connected`.

## Launcher

`Start Public Desk.command` checks MCP bridges with an MCP `initialize` request; a plain GET always gets HTTP 400.
It reuses services that are already running and refuses to start when Public Desk or a bridge on its port belongs to
another folder, naming the folder to stop. `Stop Public Desk.command` stops the PIDs saved in `work/runtime/`.

## Files, news and external links

- **File search:** the main search accepts files up to 50 MB, analyses them locally with OSINT Toolbox
  `exiftool_metadata`, and deletes the temporary upload afterwards. Don't send uploads to external providers without
  explicit approval.
- **News view:** reads IntelMap's official JSON feed (`https://intelmap.watch/api/feed/`). The user removed the
  "Open IntelMap" header button; don't restore it unless asked.
- **IntelMap and Situation Room:** external sidebar links. Both block iframes, so don't proxy around that. On
  2026-11-10 the user chose to keep Situation Room as an external link rather than build a local view.

## Known limitations

- **Server-side request block is shallow:** `validatedEndpoint` blocks only the literal cloud-metadata hostnames
  (`169.254.169.254` forms that the URL parser normalises, `metadata.google.internal`); spellings such as
  `[::ffff:169.254.169.254]` or a trailing dot get through, and redirects are followed. That matters only on cloud
  hosts, and since the request guard only local programs can reach `/api/mcp`.
- **Data service CORS:** the third-party data service lets `worldmonitor.app` / `h1dr4.dev` pages read its responses
  (public OSINT data). It is no longer reachable from the network.
- **Upstream failures, not app bugs:**
  - GreyNoise returns 404 for IPs it has no record of.
  - MalwareBazaar needs an API key (401).
  - ThreatFox intermittently errors.
- **API keys:** none are filled in by default; see `config/api-keys.env.example` for each source and where to
  get a free key. OTX and AbuseIPDB feed `get_cyber_threats`; Intelligence X feeds `get_intelx`.
- **AISStream is broken upstream:** Open OSINT's `ais_vessels` module calls `api.aisstream.io`, which does not
  resolve; AISStream only offers a WebSocket stream (`stream.aisstream.io`). A key changes the error from "not
  configured" to "fetch failed" but returns no vessels.
- **MalwareBazaar** answers 401 because its module never sends the abuse.ch Auth-Key, even if one is configured.
- **Omega quirks:** Omega turns some network failures into an empty "ok" result, so "no results" isn't proof.
  `omega_monitor` always fails (not implemented in omega-cli).
- **Domain-like words:** tokens such as "node.js" are treated as domain targets.
- **Subject trimming is word-list based:** a name that contains its own topic word loses it ("Port of Rotterdam"
  sends "Rotterdam"), and a topic-only search such as "latest ransomware" still sends "ransomware" as a filter.
- **Speed:** fast sources now show within seconds, but a domain search still takes about 25–35 s to finish,
  because the final summary waits for the slowest lookup.
- **Legacy internal names:** browser storage keys keep the `signaldesk.` prefix, and the launcher's PID and log
  file is `signaldesk.*`, so saved data and the old launcher keep working. Don't rename them without a migration.

## Recommended next work

1. The user is signing up for OTX, AbuseIPDB and Intelligence X keys; once they are in `work/api-keys.env`, restart
   and check `get_cyber_threats` and `get_intelx` in a search.
2. subfinder can only rejoin the automatic search if `osint-toolbox-mcp` exposes subfinder's `-max-time` (an
   upstream change; its `timeout` limits each request, not the run).
3. Vessel positions need Open OSINT's `ais_vessels` module rewritten for AISStream's WebSocket stream.
4. MalwareBazaar needs its module (or a preload, like `default-user-agent.mjs`) to send `Auth-Key` from
   `URLHAUS_AUTH_KEY`; one abuse.ch key covers URLhaus, MalwareBazaar and ThreatFox.

## Working rules from the user

- Lead with results; say plainly what was verified and what wasn't.
- Make the smallest change that fully solves the problem. Add tests with every behavior change, and don't mix
  refactors with behavior changes in one commit.
- Don't spend paid API or generation credits, enable active reconnaissance, or delete data without asking.
- Mark uncertain identity matches as unconfirmed; OSINT results are leads, not proof.
