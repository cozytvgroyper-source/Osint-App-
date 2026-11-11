# Omega tool review

Every Omega MCP tool, its risk tier and whether the main search may run it automatically. Tiers and the automatic
column are generated from `public/tool-tiers.js` and `public/search-planner.js`; notes come from the source review and
live tests of 2026-11-11 (details in `docs/search-overhaul.md`, step 4). Only Passive tools can ever run automatically.

Method: each tool's omega-cli module (and every module it imports) was read for requests to a target-derived host, raw
sockets, subprocesses, POSTs, AI calls and brute-force wordlists. Tools whose source showed third-party lookups only were
run live against reserved or public test targets; tools that contact the target were tiered from source and not run.

## Passive (tier 0) — 60 tools

Nothing: it asks public databases and third parties.

| Tool | Automatic | Flags | Notes |
|---|---|---|---|
| `omega_asn` | **yes** |  | ASN lookup |
| `omega_breach` | **yes** |  | Breach lookup |
| `omega_crtsh` | **yes** |  | Certificate Transparency (crt.sh) |
| `omega_cve` | **yes** |  | CVE keyword lookup |
| `omega_cvssrank` | **yes** |  | CVSS + EPSS + CISA KEV ranking |
| `omega_dns` | **yes** |  | DNS records |
| `omega_dorks` | **yes** |  | Search-engine dork links |
| `omega_email` | **yes** |  | Email format, domain and MX |
| `omega_gitrecon` | **yes** |  | Public GitHub repositories |
| `omega_intel` | **yes** |  | AlienVault OTX (+GreyNoise for IPs); pulse counts are noisy |
| `omega_ipdossier` | **yes** |  | PTR, Shodan InternetDB, BGP, DNSBLs; ASN can be the covering prefix's |
| `omega_ipinfo` | **yes** |  | IP geolocation and ASN |
| `omega_malware` | **yes** |  | Hash lookup (VirusTotal, MalwareBazaar) |
| `omega_reverseip` | **yes** |  | Reverse IP (third party) |
| `omega_spoofcheck` | **yes** |  | SPF/DMARC records |
| `omega_threatfeed` | **yes** |  | Threat feeds (abuse.ch) |
| `omega_wayback` | **yes** |  | Wayback snapshots (read only) |
| `omega_whois` | **yes** |  | WHOIS via third-party registries |
| `omega_agents_list` | no |  | Lists local agents |
| `omega_ai_analyst` | no | credits |  |
| `omega_aiassist` | no | credits |  |
| `omega_aisummary` | no | credits |  |
| `omega_archive` | no | side-effects | Submits the target to Wayback Save Page Now |
| `omega_autocorr` | no |  | Works on saved reports |
| `omega_briefing` | no |  | Summarises saved reports |
| `omega_codetrace` | no |  | Duplicates omega_gitrecon; adds unreliable developer-profile guesses |
| `omega_compare` | no |  | Diffs saved reports |
| `omega_cryptoosint` | no |  | Works (blockchain explorers); search has no crypto-address target type |
| `omega_dark` | no |  | Ahmia unreachable without Tor |
| `omega_executive` | no | credits | Calls OpenAI when a key is set |
| `omega_finance` | no |  | Only news for "Apple"; no SEC/OpenCorporates hits |
| `omega_geoint` | no |  | Works; duplicates omega_ipinfo |
| `omega_graph` | no |  | Graphs saved reports |
| `omega_hunt` | no |  | Works on saved reports, not a fresh search |
| `omega_identity` | no |  | Works (30 sites); duplicates Sherlock/Blackbird |
| `omega_imgosint` | no |  | Needs a file |
| `omega_leaked` | no |  | Reports "no breaches" when HIBP refuses the missing key (false clean result) |
| `omega_memory_search` | no |  | Searches local agent memory |
| `omega_mldetect` | no |  | Works on saved reports |
| `omega_notifier` | no | side-effects |  |
| `omega_org` | no |  | Only "No job postings"; useful lookups need arguments MCP never passes |
| `omega_osintdb` | no | side-effects |  |
| `omega_pastewatch` | no | side-effects |  |
| `omega_pdfreport` | no | side-effects |  |
| `omega_persona` | no |  | Generates a fake sock-puppet identity; not an investigation tool |
| `omega_phoneosint` | no |  | Spam rating unreliable for test numbers |
| `omega_reportgen` | no | side-effects |  |
| `omega_reporthtml` | no | side-effects |  |
| `omega_riskcore` | no |  | Scores saved reports |
| `omega_satellite` | no |  | Aircraft/vessel IDs only |
| `omega_shodan` | no |  |  |
| `omega_social` | no |  | Only a mention count, no links |
| `omega_socmint` | no |  | Ambiguous 403s, 10 s; duplicates Sherlock/Blackbird |
| `omega_stix` | no |  | Exports saved reports as STIX |
| `omega_supply` | no |  | Looked up an npm package for "requests" (wrong ecosystem) |
| `omega_threatintel` | no |  | Needs keys omega-cli lacks |
| `omega_timeline` | no |  | Reads local monitor history |
| `omega_timeline3d` | no |  | Writes a timeline file from saved reports |
| `omega_username` | no |  | Fails with an asyncio error |
| `omega_viz` | no |  | Works on saved reports |

## Light touch (tier 1) — 23 tools

A normal visit or connection, like one browser loading the site.

| Tool | Automatic | Flags | Notes |
|---|---|---|---|
| `omega_certhunt` | no |  |  |
| `omega_cors` | no |  |  |
| `omega_crypto` | no |  |  |
| `omega_cvemap` | no |  | Fingerprints the target site |
| `omega_deepweb` | no |  | Fetches .onion targets via tor2web |
| `omega_docosint` | no |  |  |
| `omega_firmware` | no |  |  |
| `omega_harvester` | no |  | Fetches the target's own pages |
| `omega_headers` | no |  |  |
| `omega_infra` | no |  |  |
| `omega_ioc` | no |  |  |
| `omega_mailsec` | no |  |  |
| `omega_mobile` | no |  |  |
| `omega_monitor` | no | side-effects | Not implemented in omega-cli (always fails) |
| `omega_network` | no |  |  |
| `omega_opsec` | no |  |  |
| `omega_phishcheck` | no |  |  |
| `omega_screenshot` | no |  |  |
| `omega_ssl` | no |  |  |
| `omega_tech` | no |  |  |
| `omega_torcheck` | no |  | Fetches .onion targets via tor2web |
| `omega_typosquat` | no |  | HTTP requests to each look-alike domain; too slow |
| `omega_watcher` | no | side-effects |  |

## Active (tier 2) — 23 tools

Probing or enumeration that is likely to show in its logs or alerts.

| Tool | Automatic | Flags | Notes |
|---|---|---|---|
| `omega_apiosint` | no |  | Requests API paths on the target |
| `omega_assetmap` | no |  |  |
| `omega_attackmap` | no |  |  |
| `omega_auto` | no |  |  |
| `omega_buckets` | no |  |  |
| `omega_c2` | no |  | JARM fingerprint and banner grabs |
| `omega_cloud` | no |  |  |
| `omega_cloud2` | no |  |  |
| `omega_crawl` | no |  |  |
| `omega_creds` | no |  |  |
| `omega_dashboard` | no | side-effects | Runs port scan and subdomain brute force |
| `omega_deception` | no |  |  |
| `omega_dnsbrute` | no |  |  |
| `omega_dossier` | no |  | Port scan and subdomain brute force |
| `omega_jscan` | no |  |  |
| `omega_livedash` | no | side-effects | Port connects and subdomain wordlist |
| `omega_ports` | no |  |  |
| `omega_recon` | no |  | Port scan, subdomain brute force, HTTP/SSL probes |
| `omega_secrets` | no |  |  |
| `omega_spider` | no |  |  |
| `omega_subdomains` | no |  |  |
| `omega_webcrawl` | no |  |  |
| `omega_wordlist` | no |  |  |

## Intrusive (tier 3) — 10 tools

Attack-style testing. Only run it on systems you own or have written permission to test.

| Tool | Automatic | Flags | Notes |
|---|---|---|---|
| `omega_agent_run` | no | credits |  |
| `omega_autopilot` | no | credits |  |
| `omega_chain` | no |  |  |
| `omega_exfil` | no |  |  |
| `omega_fuzzer` | no |  |  |
| `omega_pivot` | no |  |  |
| `omega_plugin` | no | side-effects |  |
| `omega_proxy` | no | side-effects |  |
| `omega_redteam` | no |  |  |
| `omega_vuln` | no |  |  |

Totals: 116 tools — 60 Passive, 23 Light touch, 23 Active, 10 Intrusive; 18 run automatically.
