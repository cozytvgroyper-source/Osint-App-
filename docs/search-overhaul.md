# Search overhaul: risk tiers, a Sources panel and Deep Search

Status: agreed 2026-11-11. Step 1 is merged (PR #33); steps 2–4 are not built. The owner decided A–D on 2026-11-11
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

Also in this step: merge duplicate findings across tools (one subdomain list from crt.sh, theHarvester and
HackerTarget, with "found by 3 sources"), pivot buttons on IPs, emails and domains in results, and the source log
saved with each search in history and evidence.

## Step 3: Deep Search page

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

### Server-side enforcement (part of step 3)

Today `/api/mcp` runs whatever tool call it receives; only the page decides. With Deep Search, risky tools gain a
legitimate route, so the server must decide too:

- The server resolves each tool call's tier with the same table (`tool-tiers.js` is shared by the page and server).
- Tier 0 calls pass as today.
- Tier 1+ calls require a short-lived **run grant** the server issued for a confirmed Deep Search run (or a Tool
  Library confirmation). The grant names the target, level and tool list, and the call must match all three. There is
  no scope list (decision C).
- Calls without a matching grant are refused with HTTP 403 and a clear reason.
- Tests cover: the main search cannot run Tier 1+; a grant for one target cannot be reused for another; expired
  grants fail.

## Step 4: Review Omega for passive coverage

Re-check Omega's 79 Tier 0 tools against real output and add the useful ones to the main search's reviewed list
(`OMEGA_AUTO_SEARCH_TOOLS`), for example `omega_breach`, `omega_archive` and `omega_threatintel`. The Tier 0 invariant
test keeps this safe.

## Decisions (owner, 2026-11-11)

| | Question | Decision |
|---|---|---|
| A | Sources panel inline, or a collapsible tab? | **Inline**, after the findings |
| B | Include Intrusive in Deep Search? | **Yes**, behind the typed confirmation |
| C | Require a saved scope list for Active and Intrusive? | **No** |
| D | Confirm or correct the 14 best-guess tiers | **Confirmed** as set |
