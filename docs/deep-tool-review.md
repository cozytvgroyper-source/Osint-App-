# Deep Search tool review

Date: 2026-11-13 · Branch: `deep-search/redesign`

This review records the real answers captured through the local Public Desk server. Raw answers remain in the ignored `tests/fixtures/deep/raw/` directory. The committed fixtures replace the owner's identifiers with `owner@example.com`, `ownername`, `+15555550100`, `owner-site.example`, and `192.0.2.10`. Other email-shaped values are deterministically replaced with `leadN@example.net` aliases. Display names, biographies, locations, account IDs, profile images and linked-profile fields in people fixtures are also replaced with explicit example values.

The recording covered a real email, username and phone number, Passive checks of `example.com`, and Passive through Intrusive checks of an owner-controlled private IP. Controlled website tools were not run because the owner did not provide a website they own.

## Corrected automatic tool table

Tools are listed in run order. Every people tool is Passive. Website and IP tools run only at or below the selected level.

| Target | Level | Tools |
|---|---|---|
| Email | Passive | `holehe_email_search`, `ghunt_google_search`, `omega_email`, `omega_breach`, `omega_identity` |
| Username | Passive | `maigret_username_search`, `sherlock_username_search`, `blackbird_username_search`, `omega_social`, `omega_socmint`, `omega_gitrecon`, `omega_identity` |
| Phone | Passive | `phoneinfoga_scan`, `omega_phoneosint` |
| Website | Passive | `whois_lookup`, `dns_lookup`, `crtsh_certificate_search`, `wayback_snapshots`, `dnstwist_lookalike_domains`, `theharvester_domain_search`, `omega_intel`, `omega_spoofcheck` |
| Website | Light touch | `omega_headers`, `omega_ssl`, `omega_tech`, `omega_cors`, `omega_mailsec`, `omega_certhunt`, `omega_cvemap`, `omega_deepweb`, `omega_docosint`, `omega_harvester`, `omega_infra`, `omega_opsec`, `omega_phishcheck`, `omega_screenshot`, `omega_typosquat` |
| Website | Active | `omega_ports`, `omega_crawl`, `omega_dnsbrute`, `omega_subdomains`, `dnsrecon_domain_scan`, `spiderfoot_scan`, `omega_recon`, `omega_apiosint`, `omega_assetmap`, `omega_attackmap`, `omega_buckets`, `omega_cloud`, `omega_cloud2`, `omega_creds`, `omega_jscan`, `omega_secrets`, `omega_spider`, `omega_webcrawl`, `omega_dossier` |
| Website | Intrusive | `omega_vuln`, `omega_fuzzer`, `omega_exfil` |
| IP | Passive | `get_bgp`, `get_greynoise`, `get_whois`, `omega_ipinfo`, `omega_ipdossier`, `omega_intel`, `omega_asn`, `omega_reverseip` |
| IP | Light touch | `omega_ssl`, `omega_headers`, `omega_infra`, `omega_network`, `omega_torcheck`, `omega_cvemap` |
| IP | Active | `omega_ports`, `spiderfoot_scan`, `omega_recon`, `omega_assetmap`, `omega_attackmap`, `omega_c2` |
| IP | Intrusive | `omega_vuln`, `omega_pivot`, `omega_exfil` |

`get_opensanctions` is conditional rather than an email tool: run it only for a name established by at least two linked sources. A returned record remains a possible match requiring human review.

### Changes approved after recording

| Change | Real-output reason |
|---|---|
| Remove `omega_persona` from people searches | It generated a fictional identity rather than reporting evidence about the target. |
| Remove `omega_username` | Its wrapper failed with an event-loop error. |
| Remove `omega_socmint` from email searches | It treated the full email as a social-media handle and constructed invalid profile URLs. It remains useful for usernames. |
| Make `get_opensanctions` conditional | Its documented input is a name, country, or program—not an email address. |
| Remove `omega_crypto` from websites and IPs | The implementation is Blockchain OSINT and rejected an IP as an unknown cryptocurrency-address format. |
| Remove `omega_deception` from IPs | It returned `Unknown action` for the target instead of a check. |
| Remove `omega_redteam` from websites and IPs | It required an opaque `omega auto` report and produced no independently sourced findings. |
| Change Sherlock to text output | The installed CLI rejected the wrapper's CSV flags; text mode returned profile URLs successfully. |

GHunt remains listed because its target and output fit the design, but this recording reported that GHunt needs a valid local login.

## Recorded answer shapes

| Tool | Target | Input field | Observed answer | Notes |
|---|---|---|---|---|
| `holehe_email_search` | Email | `email` | Text list of registered and unregistered services | Registered services are verified accounts for the searched email. |
| `ghunt_google_search` | Email | `identifier` | Error text | Needs a valid GHunt login; keep failure in Search details. |
| `omega_email` | Email | `target` | Object with format, domain and MX facts | Facts apply directly to the searched email. |
| `omega_breach` | Email | `target` | Object with a `breaches` list | Empty in this recording; each non-empty entry becomes a breach finding. |
| `omega_identity` | Email | `target` | Text with derived handle patterns and platform URLs | Accounts need evidence linking; derived username alone is possible. |
| `maigret_username_search` | Username | `username` | Object keyed by site with URLs and extracted profile fields | `all_sites:true`; extracted emails, names and links become evidence. |
| `sherlock_username_search` | Username | `username` | Text profile URLs | Supported mode is `output_format:'txt'`; username-only matches are possible. |
| `blackbird_username_search` | Username | `username` | Text profile URLs plus update messages | Strip update chatter; username-only matches are possible. |
| `omega_social` | Username | `target` | Object containing the target and any platform results | Empty result is dropped. |
| `omega_socmint` | Username | `target` | Text platform table with status and URL | Status alone does not prove identity; linking fields are required. |
| `omega_gitrecon` | Username | `target` | Object with repositories, secrets and dork hits | Empty in this recording; repository links can become developer accounts. |
| `omega_identity` | Username | `target` | Text platform URLs | Username-only matches remain possible unless another linked identifier appears. |
| `phoneinfoga_scan` | Phone | `number` | Text facts and search URLs | Facts apply directly to the searched number; extracted identifiers are leads. |
| `omega_phoneosint` | Phone | `target` | Text with E.164, country and line information | Direct facts about the searched number. |
| `whois_lookup` | Website | `domain` | RDAP-style object with status, events, nameservers and contacts | Owner and registration facts; contacts can be leads, not person links by themselves. |
| `dns_lookup` | Website | `domain` | Object with DNS records | Hosts, IPs, MX and TXT records. |
| `crtsh_certificate_search` | Website | `domain` | Object with certificates, hostnames and emails | Certificate hosts and dates; emails are leads. |
| `wayback_snapshots` | Website | `url` | Object containing newest-first snapshot URLs | History facts. |
| `dnstwist_lookalike_domains` | Website | `domain` | Object with look-alike records | Related/possible look-alikes, not ownership claims. |
| `theharvester_domain_search` | Website | `domain` | Object with command, hosts and Shodan data | Hosts and IPs; command metadata is dropped. |
| `omega_intel` | Website | `target` | Text from threat-intelligence sources | Keep sourced reputation facts; warnings and missing-key text are details only. |
| `omega_spoofcheck` | Website | `target` | Object with SPF, DMARC and DKIM results | Produces mail-security problems from explicit failures or missing policy. |
| `get_bgp` | IP | `query` | Data object with routing context | Direct fact; private/reserved answers may be empty or explanatory. |
| `get_greynoise` | IP | `query` | Error object | Keep as a failed call only. |
| `get_whois` | IP | `query` | Data object with registry information | Direct network-owner and allocation facts. |
| `omega_ipinfo` | IP | `target` | Text with geolocation and WHOIS status | Direct facts; failure fields are not findings. |
| `omega_ipdossier` | IP | `target` | Text with PTR, ASN, hosting and reputation checks | Direct IP facts with source labels. |
| `omega_intel` | IP | `target` | Text threat-intelligence response | Keep sourced reputation facts; missing-key text is not a finding. |
| `omega_asn` | IP | `target` | Error envelope | DNS failure in this recording; keep as a failed call only. |
| `omega_reverseip` | IP | `target` | Array of related domains | Empty in this recording; non-empty domains are other-host leads. |
| `omega_ssl` | IP | `target` | Object or object-shaped error | TLS facts/problems only when a service answers. |
| `omega_headers` | IP | `target` | Object or object-shaped error | Header problems only when an HTTP service answers. |
| `omega_infra` | IP | `target` | Text infrastructure tree | Extract IP, ASN, hosting and CDN facts. |
| `omega_network` | IP | `target` | Text topology report | Extract IP, DNS, hosting and CDN facts. |
| `omega_torcheck` | IP | `target` | Text Tor exit/relay checks | Direct fact about the searched IP. |
| `omega_cvemap` | IP | `target` | Array | Empty in this recording; non-empty CVEs require service evidence. |
| `omega_ports` | IP | `target` | Object with `ports`, `open_count`, `scanned` | Open services become problems under the severity rules below. |
| `spiderfoot_scan` | IP | `target` | Object keyed by SpiderFoot event type | Rich hosts, emails, registry and affiliation facts; every item keeps its event source. |
| `omega_recon` | IP | `target` | Text multi-section reconnaissance report | Extract only explicit, sourced facts and problems. |
| `omega_assetmap` | IP | `target` | Object with target, nodes and subdomains | Inventory facts and other-host leads. |
| `omega_attackmap` | IP | `target` | Text ATT&CK mapping report | Show mapped techniques only when backed by a cited report. |
| `omega_c2` | IP | `target` | Text TLS fingerprint and banner checks | Positive C2 indicators are High severity. |
| `omega_vuln` | IP | `target` | Text vulnerability-intelligence report | Show only target-specific CVEs; the global database count is metadata. |
| `omega_pivot` | IP | `target` | Text IOC graph summary | Extract explicit nodes/edges; do not infer relationships. |
| `omega_exfil` | IP | `target` | Text open-port and exfiltration-channel check | Positive leak/C2 channels are High severity. |

Controlled website-only tools remain in the corrected table provisionally. Their descriptions and schemas fit websites, but their real outputs still need an owner-controlled domain before adapters for those shapes are considered verified.

## Problem severity rules

No problem is emitted without the tool and server source. Absence of data is never a clean bill of health.

| Tool or family | Condition | Severity | Plain meaning | Suggested fix |
|---|---|---:|---|---|
| `omega_vuln`, `omega_cvemap` | Known-exploited or Critical/High target-specific vulnerability | High | A service appears affected by a serious known weakness. | Confirm the service and version, then patch or isolate it promptly. |
| `omega_secrets`, `omega_exfil` | Exposed credential, secret, or confirmed leak channel | High | Sensitive access material or an outbound leak path may be exposed. | Revoke the secret, close the path, and investigate access logs. |
| `omega_c2` | Positive C2 fingerprint or banner match | High | A service resembles known command-and-control infrastructure. | Isolate the host and investigate the process and network traffic. |
| `omega_ssl`, `omega_certhunt` | Expired, invalid, hostname-mismatched, or weak TLS | High | Visitors cannot reliably authenticate the encrypted service. | Replace the certificate and disable obsolete protocols/ciphers. |
| `omega_ssl`, `omega_certhunt` | Certificate expires within 30 days | Medium | The encrypted service may soon show certificate errors. | Renew and verify automatic renewal. |
| `omega_cors` | Arbitrary origin accepted with credentials | High | Another site may be able to read authenticated responses. | Allow only trusted origins and review credentialed requests. |
| `omega_headers` | Missing HSTS, CSP, frame protection, or MIME protection | Medium | The site is missing a browser protection. | Add the named header with a policy tested for the site. |
| `omega_mailsec`, `omega_spoofcheck` | SPF permits spoofing or DMARC explicitly fails | High | Attackers may be able to impersonate the domain in email. | Correct SPF and publish an enforced DMARC policy. |
| `omega_mailsec`, `omega_spoofcheck` | SPF or DMARC is absent/monitor-only | Medium | Email receivers lack a strong anti-spoofing instruction. | Publish SPF and move DMARC toward quarantine or reject after monitoring. |
| `omega_ports` | Exposed database, remote-admin, or unauthenticated management service | High | A sensitive service is reachable from the tested network. | Restrict it with a firewall/VPN and require strong authentication. |
| `omega_ports` | Other unexpected open service | Medium | The host exposes more network surface than expected. | Confirm the service is needed, patch it, or close the port. |
| `omega_phishcheck`, `omega_typosquat` | Confirmed malicious or credential-collection look-alike | High | A related site appears designed to deceive users. | Preserve evidence and report it to the registrar/host and affected brand. |
| Other explicit configuration warning | Target-specific warning with a stated failing condition | Low | A smaller configuration issue was reported. | Follow the source's named remediation and verify the change. |

## Account categories

| Sites | Category |
|---|---|
| GitHub, GitLab, Bitbucket, PyPI, npm, Stack Overflow | Developer |
| X/Twitter, Instagram, Facebook, TikTok, Mastodon, Bluesky, LinkedIn, Reddit, YouTube, Pinterest | Social |
| Hacker News, Discourse, phpBB, MyAnimeList forums and other discussion boards | Forums |
| Amazon, eBay, Etsy, Depop, Vinted, Wish and marketplace profiles | Shopping |
| Every unlisted site | Other |

Site matching is case-insensitive and uses the URL host when available. A category never changes whether an account is linked or possible.
