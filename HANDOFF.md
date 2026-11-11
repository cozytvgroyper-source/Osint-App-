# Public Desk handoff

Updated 2026-11-11 (security hardening, CI). First written 2026-11-10; it replaces the original Codex handoff, which lived outside the repo and is now out of date.

## Objective

Public Desk (formerly SignalDesk) is a private, local macOS web app that connects to MCP servers and presents OSINT
results in a readable, category-based interface. Keep it local-first, simple to run on this Mac, passive by default,
and honest about what sources did and did not return.

## Repository and where it runs

- Repository: `cozytvgroyper-source/Osint-App-`, branch `main`.
- Mac checkout: `~/Documents/Codex/2026-11-10/public-desk` (renamed from `signaldesk`).
- The old Codex copy is archived at `~/Documents/Codex/2026-11-10/xn-archived-2026-11-10`. Nothing runs from it.
- Address: `http://127.0.0.1:4173` (unchanged by the rename).
- Workflow: one feature branch and one pull request per change; don't commit straight to `main`. Plain `git push` works.

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
| `public/search-planner.js` | `explainSearchPlan` / `planSearchTools` (tool selection) and `summarizePlanDiagnostics` |
| `public/result-classifier.js` | `classifyToolResult`: whether a response is data, empty, or an error |
| `public/tool-health.js` | Per-tool working/failing counts and the "N of M servers connected" label |
| `tests/fixtures/mcp-tools.json` | The real 240-tool list from the three local servers; planner tests run against it |
| `scripts/bind-loopback.mjs` | `node --import` preload: servers that name no address listen on 127.0.0.1 only |
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
- **Data service:** started with `bind-loopback.mjs`, because its own code calls `listen(8080)` with no address.
- **Upload and sign-in:** uploads are size-limited, renamed, written 0600 and deleted after analysis; pending
  Consensus sign-ins expire after 10 minutes (at most 20, oldest dropped).

## Main search

1. `extractTarget` finds a domain (including from a URL), IP, email, `@username`, CVE, hash or phone number.
2. `searchIntent` picks the intent from the target, otherwise from topic words (plurals are recognised).
3. `explainSearchPlan` scores every connected tool against the search words, with the target's own text removed, and
   against the topic words. It selects up to 6 tools, at most 4 per server.
4. `argsForSearch` sends a tool only the target when there is one, otherwise the cleaned phrase.
5. `classifyToolResult` sorts each response; only real data becomes a result category. Errors and empty answers are
   listed under Unavailable Sources with their actual reason.

Never auto-run, but still available in Tool Library:

- tools whose name or description indicates active probing (port scans, fuzzing, brute force, zone transfer or zone walk, crawling, and similar);
- Omega tools outside the reviewed passive allowlist (`OMEGA_AUTO_SEARCH_TOOLS`);
- `subfinder` and `theHarvester`, which exceed the 45 s request limit.

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
  - Open OSINT `get_whois` (RDAP) often returns HTTP 403.
  - GreyNoise returns 404 for IPs it has no record of.
  - MalwareBazaar needs an API key (401).
  - ThreatFox intermittently errors.
- **Missing API keys:** some Open OSINT tools need keys that aren't configured: ACLED, AISStream, Intelligence X,
  FMP and others.
- **Omega quirks:** Omega turns some network failures into an empty "ok" result, so "no results" isn't proof.
  `omega_monitor` always fails (not implemented in omega-cli).
- **Domain-like words:** tokens such as "node.js" are treated as domain targets.
- **Searches without a target** send the whole phrase, including topic words (e.g. "sanctions Rosneft").
- **Speed:** domain searches take about 25–35 s, because the selected lookups run in parallel and the slowest
  sets the pace.
- **Legacy internal names:** browser storage keys keep the `signaldesk.` prefix, and the launcher's PID and log
  file is `signaldesk.*`, so saved data and the old launcher keep working. Don't rename them without a migration.

## Recommended next work

1. Show each source's results as they arrive instead of waiting for the slowest tool.
2. Trim topic words from searches without a target (send "Rosneft" to sanctions tools).
3. Investigate Open OSINT `get_whois` failing with RDAP HTTP 403.
4. Tailor arguments per tool where schemas allow (e.g. limit theHarvester's sources) so slow tools can rejoin the
   automatic search.
5. Configure API keys for the Open OSINT tools listed above if the user wants those sources.

## Working rules from the user

- Lead with results; say plainly what was verified and what wasn't.
- Make the smallest change that fully solves the problem. Add tests with every behavior change, and don't mix
  refactors with behavior changes in one commit.
- Don't spend paid API or generation credits, enable active reconnaissance, or delete data without asking.
- Mark uncertain identity matches as unconfirmed; OSINT results are leads, not proof.
