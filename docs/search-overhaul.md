# Search overhaul: risk tiers, a Sources panel and Deep Search

Status: agreed 2026-11-11. Steps 1 and 2 are built; steps 3–4 are not built. The owner decided A–D on 2026-11-11
(see Decisions at the end).
Where this document and the code disagree, the code wins: `public/tool-tiers.js` is the source of truth for tiers.

## Goals

1. Everyone (the owner, and every future session) can see what a tool does **to the target** before it runs.
2. The everyday main search stays passive, and shows which sources it used, where and when.
3. A separate **Deep Search** page can run probing tools, but only deliberately, in scope, and with a record.
4. Safety does not depend on any one page behaving: the server enforces it (step 3).

## Risk tiers

Every tool has exactly one tier. A tool missing from the reviewed table counts as **Intrusive**, so a new scanner
added by a server update can never be mistaken for a safe one.

| Tier | Name | What the target sees | Tools (2026-11-11, 245 live) |
|---|---|---|---|
| 0 | Passive | Nothing: public databases and third parties | 197 |
| 1 | Light touch | A normal visit or connection, like one browser loading the site | 19 |
| 2 | Active | Probing or enumeration likely to show in its logs or alerts | 19 |
| 3 | Intrusive | Attack-style testing; only on systems you own or may test in writing | 10 |

Flags, shown alongside the tier: **💳 credits** (spends paid AI credits: `omega_ai_analyst`, `omega_aiassist`,
`omega_aisummary`, `omega_agent_run`, `omega_autopilot`) and **⚙ side effects** (sends, stores, schedules or loads
something: `omega_notifier`, `omega_monitor`, `omega_watcher`, `omega_pastewatch`, `omega_osintdb`, the report and
dashboard generators, `omega_plugin`, `omega_proxy`).

Whole servers reviewed as Tier 0: **Open OSINT** (all 107 tools read public feeds and databases through its data
service; none takes a target to crawl or probe) and **Consensus** (research papers).

- **Tier 1:** `omega_headers`, `omega_ssl`, `omega_tech`, `omega_cors`, `omega_ioc`, `omega_infra`,
  `omega_network`, `omega_certhunt`, `omega_crypto`, `omega_docosint`, `omega_dossier`, `omega_mailsec`,
  `omega_phishcheck`, `omega_firmware`, `omega_mobile`, `omega_monitor`, `omega_watcher`, `omega_opsec`,
  `omega_screenshot`.
- **Tier 2:** `spiderfoot_scan`, `dnsrecon_domain_scan`, `omega_subdomains`, `omega_ports`, `omega_jscan`,
  `omega_crawl`, `omega_spider`, `omega_cloud`, `omega_cloud2`, `omega_buckets`, `omega_auto`, `omega_assetmap`,
  `omega_attackmap`, `omega_deception`, `omega_creds`, `omega_secrets`, `omega_dnsbrute`, `omega_webcrawl`,
  `omega_wordlist`.
- **Tier 3:** `omega_vuln`, `omega_fuzzer`, `omega_redteam`, `omega_pivot`, `omega_exfil`, `omega_chain`,
  `omega_plugin`, `omega_proxy`, `omega_autopilot`, `omega_agent_run`.

### Reviewed by the owner

Omega's descriptions are one line long, so these 14 tiers were set from best guesses. The owner confirmed all of them
on 2026-11-11 (decision D); the table keeps the reasoning. A correction is a one-line change in `tool-tiers.js`.

| Tool | Set to | Description | Why, and the doubt |
|---|---|---|---|
| `omega_c2` | 0 | C2 infrastructure detection | Likely matches threat feeds; could connect to suspected C2 hosts |
| `omega_mldetect` | 0 | ML anomaly detection from scan results | Works on collected results; unclear whether it uses paid AI |
| `omega_ioc` | 1 | IOC extraction from text/URLs | Fetches URLs it is given |
| `omega_certhunt` | 1 | Certs across CT logs **and hosts** | "Hosts" suggests TLS connections to the target |
| `omega_docosint` | 1 | Metadata from PDFs, Office docs, images | May download documents from the target's site |
| `omega_phishcheck` | 1 | Checks URLs and domains for phishing | Likely fetches the URL |
| `omega_network` | 1 | Traceroute, hop mapping, latency | Sends packets toward the target |
| `omega_opsec` | 1 | Evaluates the target's OPSEC posture | Method unknown; could probe |
| `omega_dossier` | 1 | Profile compiled "from all sources" | May include the light-touch modules |
| `omega_firmware` | 1 | Firmware analysis | Probably local files; unknown where the firmware comes from |
| `omega_mobile` | 1 | APK/IPA scanning | Probably local files or app stores |
| `omega_deception` | 2 | Honeypot detection | Detecting decoys usually means probing services |
| `omega_creds` | 2 | Credentials "in public sources" | Passive per its description, but handles credentials |
| `omega_exfil` | 3 | Data-exfiltration channel detection | Name suggests offensive use; behaviour unknown |

## Step 1 (PR #33): Tool Library by tier

- **Tool Library:** tools are grouped by tier, with filter chips and counts; each card shows its tier, flags and
  where it is used ("Main search can use it" or "Tool Library only").
- **Run dialog:** Tier 2+ requires "I own this target or have written permission to test it". Tier 3 and
  unreviewed tools also require typing the tool's exact name. Credit-spending tools require consent. Nothing is
  sent until these are given.
- **Invariant, enforced by a test:** every tool the main search may run automatically is Tier 0.

## Step 2: Sources panel in the main search

Every search records, per tool: server, tier, why it was chosen, the exact value sent (e.g. `Rosneft`), start and
finish times, and the outcome (data, empty, error).

**Decision A: the panel is shown inline** in the completed result, after the findings. This replaces the earlier
owner requirement that completed searches show only findings and Related Links (`CLAUDE_CODE_HANDOFF.md`, Owner
Requirements); findings still come first.

Also in this step: merge duplicate findings across tools (implemented for simple domain, host, email, IP and URL
lists, with every contributing source named), passive one-click pivot searches on exact IP, email and domain values,
and the source log saved with each search in history and evidence.

## Step 3: Deep Search page (implemented)

A separate page with amber/red styling, never mixed with the main search.

1. **Level selector:** Passive · Light touch · Active · Intrusive. Each level includes the ones below it. Default:
   Light touch. **Decision B: Intrusive is included**, behind the typed confirmation in step 3.
2. **Scope:** the target is typed explicitly, never inferred from a phrase. Every run needs "I own this target or
   have written permission to test it". **Decision C: no saved scope list** is required for Active or Intrusive;
   the per-run confirmation, the typed confirmation for Intrusive and the audit log are the safeguards.
3. **Plan preview:** lists each tool with its tier, what it does, whether the target will notice, and its expected
   time. Tools can be unticked. Nothing runs until Run is pressed; Intrusive also asks for the target name typed.
4. **Execution:** one tool at a time, with a live log and Cancel. Time limits are longer than the main search's 45 s
   (the per-request limit in `server.mjs` gets a Deep-Search-only value).
5. **Audit log:** every Tier 1+ run is appended to `work/deep-search-audit.jsonl` (time, target, level, tools,
   outcome). It is git-ignored and never contains API keys.

### Server-side enforcement (implemented in step 3)

`/api/mcp` now enforces the shared risk table instead of trusting the page alone:

- The server resolves each tool call's tier with the same table (`tool-tiers.js` is shared by the page and server).
- Tier 0 calls pass as today.
- Tier 1+ calls require a short-lived **run grant** the server issued for a confirmed Deep Search run (or a Tool
  Library confirmation). The grant names the target, level and tool list, and the call must match all three. There is
  no scope list (decision C).
- Calls without a matching grant are refused with HTTP 403 and a clear reason.
- Tests cover: the main search cannot run Tier 1+; a grant for one target cannot be reused for another; expired
  grants fail.

The Tool Library issues a two-minute, one-use grant after the matching confirmations. It also protects
Tier 0 tools that spend credits or have side effects. The grant is bound to the endpoint, tool name and exact
arguments in addition to the visible target and selected level. Deep Search uses a 15-minute grant for its reviewed
plan, runs the selected calls sequentially with a two-minute per-tool limit, cancels the in-flight upstream request
when the browser cancels, and appends the final outcome to `work/deep-search-audit.jsonl` with mode 0600.

## Step 4: Review Omega for passive coverage (in progress)

Re-check Omega's 79 Tier 0 tools against real output and add the useful ones to the main search's reviewed list
(`OMEGA_AUTO_SEARCH_TOOLS`), for example `omega_breach`, `omega_archive` and `omega_threatintel`. The Tier 0 invariant
test keeps this safe.

First live review, 2026-11-11: `omega_breach` returned structured target and breach data and is approved for automatic
search. `omega_archive` and `omega_threatintel` returned only a generic `completed` marker for `example.com`, so they
remain Tool Library-only until they expose usable findings.

Identity review: `omega_email` returned structured format, domain and MX data for a reserved address, and
`omega_gitrecon` returned public repositories for GitHub's `octocat` test account; both are approved. `omega_username`
failed with an asyncio event-loop error and `omega_phoneosint` returned only `completed`, so both remain manual.

Network batch, 2026-11-11: none approved. `omega_recon` (`example.com`), `omega_ipdossier` and `omega_geoint`
(`8.8.8.8`) returned only `completed`. `omega_torcheck` (`8.8.8.8`) and `omega_typosquat` (`example.com`) did not
finish within the app's 45-second proxy limit, even when run one at a time. `omega_social` (`example.com`) returned only
a mention count (`hackernews: 15`) with no links, which is not a usable finding. `omega_shodan` was skipped because it
may spend API credits.

Root cause of the `completed` placeholders: omega-cli prints its result tables to stdout, which is the MCP stdio
channel. The bridge rejects those lines as invalid JSON-RPC (they appear in `work/logs/omega.log`, for example
"IP Geolocation: 8.8.8.8" and "Total mentions found: 15"), and the tool then returns only `completed`. Capturing
module stdout inside the Omega server and returning it as the result would likely make many manual tools reviewable.

Fixed 2026-11-11: `scripts/run-omega-mcp-captured.py` wraps omega-mcp's shared `_run_omega_module` helper, redirects
stdout while a module runs and returns the printed text (ANSI stripped, capped at 20,000 characters) when the module
returned nothing. Structured results and errors are unchanged. Live after the fix: `omega_geoint` (`8.8.8.8`) returns
location, ISP and ASN; `omega_recon` (`example.com`) returns WHOIS, DNS and IP sections; `omega_ipdossier` returns an
IP dossier; `omega_whois` and `omega_email` return the same structured JSON as before; the Omega log shows no
JSON-RPC parse errors. None of these was added to automatic search in this change: re-review every tool previously
marked `completed` (archive, threatintel, phoneosint, recon, ipdossier, geoint) against its new text output first.

Text-output review, 2026-11-11 (after the fix):

| Tool | Live result | Decision |
|---|---|---|
| `omega_ipdossier` (`8.8.8.8`) | PTR, Shodan InternetDB open ports and hostnames, BGP prefix, 8-list DNSBL check, risk score, in ~1.3 s | **Approved** for IP searches. Caveat: it reported AS3356 (the covering 8.0.0.0/9 prefix from bgp.he.net), not Google's AS15169, and its geolocation section was empty |
| `omega_geoint` (`8.8.8.8`) | Location, ISP and ASN (AS15169) | Manual: duplicates the approved `omega_ipinfo` |
| `omega_threatintel` (`example.com`) | URLhaus "unknown"; AbuseIPDB needs a key omega-cli does not have | Manual: no findings without keys |
| `omega_phoneosint` (`+12025550100`) | Country and region from the number, "Spam Rating 5/5" for a reserved test number | Manual: the rating is unreliable |
| `omega_recon` (`example.com`) | Output included a port scan, subdomain brute force, HTTP/SSL probes and cloud-bucket checks | **Re-tiered to Active (2)**; never automatic |
| `omega_archive` (`example.com`) | Output showed it submitted the target to the Wayback Machine's Save Page Now | **Flagged side-effects**; manual |

The captured text is tidied before it is returned: the ASCII-art banner, panel borders and rules are dropped (section
titles kept), and "Saved → /Users/…" report paths are removed so this Mac's home folder never reaches results or
evidence. The result dialog renders multi-line text as preformatted text.

## Decisions (owner, 2026-11-11)

| | Question | Decision |
|---|---|---|
| A | Sources panel inline, or a collapsible tab? | **Inline**, after the findings |
| B | Include Intrusive in Deep Search? | **Yes**, behind the typed confirmation |
| C | Require a saved scope list for Active and Intrusive? | **No** |
| D | Confirm or correct the 14 best-guess tiers | **Confirmed** as set |
