# Deep Search redesign: design

Date: 2026-11-13 · Status: ready for approval · Branch: `deep-search/redesign`

## 1. Intent

Deep Search should be something a regular person can use to get **everything useful that the connected tools can find about one target**, shown in the app as a clear results page, even if the search takes 5 minutes or more.

The owner's main use is **people and accounts**: you start from an **email address or username**, and Deep Search shows where that identity appears online and what is publicly known about it. Deep Search also keeps working for **websites and IP addresses**, which is where the Light touch, Active and Intrusive tools apply.

### What it does today, and why that isn't enough

- **Results are thrown away.** Each tool runs, the log says "Finished whois_lookup.", and the answer is discarded (`runDeepSearch` in `public/app.js`).
- **Most tools are never offered.** A fixed list (`DEEP_SEARCH_TOOLS` in `public/deep-search.js`) covers 11 of the 50 reviewed Light touch, Active and Intrusive tools. People searches use 3 tools for an email, 4 for a username and 1 for a phone number, although the servers have many more (GHunt, Maigret with all sites, the Omega identity and social tools, sanctions…).
- **It doesn't follow leads.** An email found on a profile is never searched.
- **Long runs would break.** A Deep Search permission (run grant) lasts 15 minutes and covers at most 25 calls. The server keeps at most 100 grants and drops the oldest. Granted calls time out after 120 seconds, and Passive calls, which need no grant, after 45 seconds. Maigret on 3,000+ sites or a SpiderFoot scan takes longer.
- **It's built for experts.** You choose a level, build a plan, tick tools and confirm. Nothing tells a regular person what will happen or what was found.

## 2. Goals, non-goals, anti-goals

**Goals**
1. Easy for a regular person: one box, plain words, the app works out what kind of search it is.
2. No limit on the number of tools. Every reviewed tool that fits the target and the chosen level runs, and higher levels use more Light touch, Active and Intrusive tools.
3. For people: follow leads. New identifiers found along the way are searched too, for up to 3 rounds.
4. While it runs, a working progress page shows real progress.
5. When it finishes, a results page shows only relevant findings from all the tools. Every finding says which tool and server found it and why it's relevant.
6. Finished results are kept so the Run history can reopen them.

**Non-goals**
- Searching by a person's **name** alone: too many strangers share a name. The main search still accepts names.
- AI summaries or AI-based matching.
- Running searches when the app's tab is closed. The owner chose to run searches in the page (approach 1 below).
- Comparing profile photos.

**Anti-goals** (failures even if everything "works")
- A finding shown as belonging to the person when nothing actually links it. "Make no mistakes" means **no unproven links**.
- Running any tool above Passive against a person's accounts, or above Light touch against a website the user never confirmed.
- A results page that dumps raw tool output, or repeats the same thing once per tool.
- Losing safety: the server must still enforce every level and confirmation, however the page behaves.

## 3. Constraints

- **Tech:** plain HTML, CSS and ES modules; Node ≥ 22; `node --test`; no framework, no build step, no new runtime dependencies. The CSP stays `script-src 'self'; style-src 'self'`.
- **Design system:** the phase 1–5 building blocks: `ui.css` tokens and `ui.js` (`pageHeader`, `button`, `field`, `card`, `badge`, `emptyState`, `term`). View modules are DOM-free and return escaped HTML strings, like `search-results-view.js`.
- **Accessibility:** WCAG 2.2 AA in both themes at 1280 and 375 px, with the patterns used so far:
  - visible 3 px focus
  - `aria-pressed` toggles and `<details>` folds
  - status updates that are polite and written only when their text changes
  - focus moved somewhere sensible after every action
  - reduced motion respected
- **Words:**
  - Keep "MCP server", "Tool library", "Passive / Light touch / Active / Intrusive" and "Pivot".
  - Never show "Run grant".
  - Plain words for everything else.
- **Safety model** (`public/tool-tiers.js`, `scripts/run-grants.mjs`):
  - Tiers are per server and tool.
  - Unreviewed tools count as Intrusive.
  - Tools flagged for paid credits or side effects never run automatically.
  - Server tool annotations `readOnlyHint:false` or `destructiveHint:true` exclude a tool.
  - The server checks every call above Passive against a confirmed permission (run grant).
- **Where it runs (owner's choice): in the app page.** If the tab is closed, reloaded or put to sleep, the run stops. The page has to say so honestly.

## 4. Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| 1 | **Run in the app page** (as today), with new run-grant and timeout rules on the server | Smallest change, reuses today's code. A closed tab or reload ends the run. | **Chosen by the owner** |
| 2 | Run on the local server as a background job | Survives closing the tab and centralises safety, but needs much more new server code. | Not chosen |
| 3 | Page runs the search, server stores checkpoints | Survives a reload but not a closed tab; the cost of both without the main benefit. | Not chosen |

Consequences of approach 1, decided:
- The progress page says **"You can switch to other pages in the app. Keep this tab open until it finishes."**
- The browser asks for confirmation (`beforeunload`) if you try to close or reload during a run.
- A run that ends early (cancelled, tab closed) keeps whatever was already saved; see §9.

## 5. The search page: one box

Mockup choice: **A, one box**.

- **Heading:** "Find everything about one email, username, website or IP". Below it: "Takes a few minutes. Keep this tab open."
- **One text box** (`deepTarget`). As you type, a line under it (`role="status"`, written only when it changes) says what the app understood and what will happen:
  - **Email or username:** "Looks like a username. We'll check thousands of sites and follow any leads we find. Only public sources are used for people; nothing is sent to the person."
  - **Website or IP:** "Looks like a website. How far may we go?" The **level picker** appears, using the four tier names with their "what the site sees" line (from `TIERS`).
  - **Phone number, CVE or file fingerprint** (still supported, as today): a one-line description, Passive only, no lead following.
  - **A single word with no spaces** (2–32 letters, digits, `.`, `_` or `-`, with or without `@`) counts as a **username**. The status line says so before you start, so a mistaken "Smith" is visible. For a common word most findings will be possible matches, not linked ones. This only applies in Deep Search; the main search's detection doesn't change. *(My call.)*
  - **Anything else, such as a name with spaces:** "Deep Search needs an email, username, website or IP. To search a name, use Search." with a link to the main search. The Start button stays disabled.
- **Confirmations**, shown only when needed:
  - **Person searches:** none to tick. A short notice: "Uses public sources only. Use it lawfully and respectfully." *(Builder's call: wording.)*
  - **Website or IP, every level** (unchanged from today): "I own this target or have written permission to test it." At **Intrusive**, you also type the target exactly.
- **One button: Start Deep Search.** The old steps "Build plan / Review the plan / tick tools" are gone from the main path. **"Choose tools"** (a `<details>` fold under the button) still shows the tools with checkboxes for people who want it, all ticked by default. Nothing is lost. For a person search it lists every tool the run may use, grouped by identifier type (email, username, phone, website), because leads can bring in other types. Unticking a tool leaves it out of the whole run, lead rounds included. *(My call.)*
- **Run history** stays below. Each finished run now has **Open results**.

## 6. How a search runs (the engine)

A new DOM-free module, **`public/deep-engine.js`**, plans and drives a run. `app.js` gives it two functions, `callTool` and `requestGrant`, and listens to its events. Keeping it DOM-free means it can be tested with `node --test` and recorded fixtures.

### 6.1 Choosing tools: no count limit

For each target, the tools that run are **every connected tool** that meets all of these:
1. It is reviewed (`toolRisk(tool).reviewed`).
2. Its tier is at or below the chosen level (people: always Passive).
3. It has no `credits` or `side-effects` flag and no write or destructive annotation.
4. It **fits the target type**, according to the table in §6.6 (new `DEEP_TOOLS` map, replacing `DEEP_SEARCH_TOOLS`).

No `maxTools` cap. Order: Passive first, then each higher tier, then by the order in the map.

### 6.2 Running them

- **Passive tools:** up to **4 at a time**. They only ask third parties, so the target sees nothing either way.
- **Light touch, Active and Intrusive tools:** **one at a time**, so the target is never hit by parallel probes. *(Builder's call: the concurrency constant.)*
- **Per-tool timeout:** 120 seconds by default. Known slow tools get longer, up to a hard cap of 10 minutes: Maigret with `all_sites`, Sherlock, Blackbird, SpiderFoot. Values come from `DEEP_TOOLS`.
- **Arguments:** start from `argsForSearch`. Deep Search overrides:
  - `maigret_username_search`: `all_sites:true`
  - `holehe_email_search`: `only_used:true`
  - `sherlock_username_search`: `output_format:'csv'`
  - per-site `timeout` values sized for a long run
  - SpiderFoot `use_case`: builder's call from real output
- **Cancel** aborts the call in progress (`AbortController`, as today) and stops scheduling. Results gathered so far are kept and shown as "Stopped early".
- **One tool failing never stops the run.** Failures are listed under Search details.

### 6.3 Following leads (people searches)

- **Round 1** runs every fitting tool on what you typed.
- After each round, **leads** are taken from **linked** findings only (§7.1), never from possible matches:
  - emails
  - usernames (only from explicit fields such as `username` or `handle`, or a profile URL pattern on a known site)
  - phone numbers
  - personal websites
- A lead is searched in the **next round** with the tools for its type. **Rounds 2 and 3** work the same way. **Nothing is searched twice**: identifiers are normalised (lower-case emails and usernames, no leading `@`, E.164 phones, bare host names).
- **Websites found in a person search** are checked with **Passive and Light touch tools only**, never higher. In the results, each one has a **Deep Search this site** button, which starts a website search with its own confirmations.
- **Safety cap:** at most **25 identifiers** in a run (the starting one plus leads), so a run can't snowball. Extra leads are listed on the results page as "More leads we didn't follow", each with a Deep Search button. This caps targets, not tools. *(Builder's call: the number.)*

Website and IP searches have **one round**. Related hosts found (subdomains, linked IPs) are listed with Deep Search buttons, not followed automatically, because the owner's permission covers the target typed, not other hosts.

### 6.4 Server changes for long runs (safety kept)

`scripts/run-grants.mjs`, `server.mjs`:

- **Run grants for Deep Search** are requested **one round at a time** for the calls above Passive, sent in chunks of at most 25 calls (current limit, kept).
  - **Lifetime:** each `deep-search` grant lives until its calls are used, with a hard cap of **30 minutes per grant** (today: a fixed 15). Other grants keep the 2-minute lifetime. *(Builder's call within this cap.)*
  - **Running past a grant:** if a grant expires before its calls are used, or a round needs more chunks, the page asks for a new grant for the remaining calls, reusing the confirmations given at the start of the run. Confirmations are per run, and the server checks them again each time. *(My call.)*
  - **No silent eviction:** grants carry the run id. The 100-grant limit evicts expired grants first, then the oldest grant that doesn't belong to a run still in progress. A run's grants are released when the run ends. *(My call.)*
  - Every other check stays exactly as it is:
    - each call is used once
    - the target must match
    - the tier must be at or below the level
    - the confirmations are checked
- **Long timeouts for Passive calls:** a Deep Search call may send `deepSearch:true` with a `timeoutMs`. The server honours it **only** when the tool is in `DEEP_TOOLS` with that timeout or less (capped at 10 minutes), and otherwise uses 45 seconds. Today, Passive calls can't get more than 45 s.
- **Where the person-search permission comes from:** person lookups are all Passive and need no grant (unchanged). **Websites discovered during a person search** get Passive and Light touch checks **without asking** (owner's decision, Q1). The server allows a `deep-search` grant whose **level is at most Light touch** with the acknowledgement alone, as the Tool library already does for Light touch tools (`runRequirements`). The person-search notice on the search page is the acknowledgement, recorded with the run. Grants at **Active or Intrusive** still need "I own this target or have written permission", and Intrusive also needs the typed target, exactly as today. A test proves the server refuses an Active call under an acknowledgement-only grant.

### 6.5 Progress events

The engine emits plain objects that the page renders:
- `stage` (with name and round)
- `tool-start` and `tool-end` (with outcome)
- `lead` (new identifier, with where it came from)
- `counts` (linked, possible, tools done/total)
- `done`

The page keeps the latest state and re-renders the progress view at most a few times a second.

### 6.6 Which tools fit which target (`DEEP_TOOLS`, to be confirmed against real output)

**People** (all Passive):
- **Email:**
  - `holehe_email_search`, `ghunt_google_search`
  - `omega_email`, `omega_breach`, `omega_identity`, `omega_persona`, `omega_socmint`
  - `get_opensanctions` (name from linked findings only; see §7.1)
- **Username:**
  - `maigret_username_search`, `sherlock_username_search`, `blackbird_username_search`
  - `omega_username`, `omega_social`, `omega_socmint`, `omega_gitrecon`, `omega_identity`, `omega_persona`
- **Phone:** `phoneinfoga_scan`, `omega_phoneosint`

**Website** (by level):
- **Passive:** today's list
  - `whois_lookup`, `dns_lookup`, `crtsh_certificate_search`, `wayback_snapshots`, `dnstwist_lookalike_domains`, `theharvester_domain_search`
  - `omega_intel`, `omega_spoofcheck`
  - plus every other reviewed Passive domain tool (builder lists them from the tool review)
- **Light touch:**
  - today's: `omega_headers`, `omega_ssl`, `omega_tech`, `omega_cors`, `omega_mailsec`
  - added: `omega_certhunt`, `omega_crypto`, `omega_cvemap`, `omega_deepweb`, `omega_docosint`, `omega_harvester`, `omega_infra`, `omega_opsec`, `omega_phishcheck`, `omega_screenshot`, `omega_typosquat`
- **Active:**
  - today's: `omega_ports`, `omega_crawl`, `omega_dnsbrute`, `omega_subdomains`
  - added: `dnsrecon_domain_scan`, `spiderfoot_scan`, `omega_recon`, `omega_apiosint`, `omega_assetmap`, `omega_attackmap`, `omega_buckets`, `omega_cloud`, `omega_cloud2`, `omega_creds`, `omega_jscan`, `omega_secrets`, `omega_spider`, `omega_webcrawl`, `omega_dossier`
- **Intrusive:**
  - today's: `omega_vuln`, `omega_fuzzer`
  - added: `omega_redteam`, `omega_exfil`

**IP** (by level):
- **Passive:** today's list
- **Light touch:** `omega_ssl`, `omega_headers`, `omega_infra`, `omega_network`, `omega_torcheck`, `omega_cvemap`, `omega_crypto`
- **Active:** `omega_ports`, `spiderfoot_scan`, `omega_recon`, `omega_assetmap`, `omega_attackmap`, `omega_c2`, `omega_deception`
- **Intrusive:** `omega_vuln`, `omega_pivot`, `omega_redteam`, `omega_exfil`

**Never in Deep Search**, with the reason:

| Tools | Reason |
|---|---|
| `omega_firmware`, `omega_mobile` | Need a file, not a target |
| `omega_ioc` | Needs text to scan |
| `omega_wordlist` | Output is a wordlist, not a finding |
| `omega_auto`, `omega_chain` | Re-run other modules as one opaque pipeline; their parts already run individually |
| Any flagged or unreviewed tool | Safety model |

This table is built from tool descriptions. **Task 1 of the plan checks each tool's real input and output** and corrects the table before any code relies on it.

## 7. What counts as relevant

### 7.1 People: linked vs possible

Every finding gets one of three statuses, by **rules the page can explain**. There is no scoring by guesswork.

- **Linked**, with its reason recorded:
  1. **Exact identifier.** The tool's answer is about the exact identifier searched, and the tool checks that identifier itself:
     - Holehe "registered on site X" for that email
     - breach records for that email
     - the GHunt account for that email
     - PhoneInfoga for that number

     Reason: "Registered with jane@mail.com".
  2. **Profile shows a known identifier.** Profile data from the tool (Maigret's extracted fields, Omega identity, socmint or gitrecon data) contains an email, phone or link already in the run's linked set. Reason: "Profile shows jane@mail.com".
  3. **Links to a linked account.** A profile links to a URL that's already a linked account. Reason: "Links to github.com/jsmith88 (linked)".
  4. **Chain.** Linked through a chain of the above, recorded step by step. This is the folded trail on the results page.
- **Possible:** only the username matches (Sherlock, Blackbird, or Maigret with no linking fields), or only a display name matches. Reason: "Same username; nothing else links it."
- **Dropped:** empty answers, errors, "not found", echoes of the query, and records that don't mention the identifier at all. Errors appear only in Search details.

A **name** found on linked profiles (for example, "Jane Smith" from GHunt) is shown in the summary card with its source. Sanctions or PEP lists are checked with that name only when the name comes from at least two linked sources. A hit there is shown as **"Possible sanctions match: check"**, never as a fact.

### 7.2 Websites and IPs

- Everything about the typed target from a fitting tool is relevant. Empty, error and echo answers are dropped.
- Repeated items (hosts, IPs, emails, URLs) are listed once with every source that found them, reusing `extractIndicatorLists` and `consolidateIndicatorLists` from `public/search-dedup.js`.
- **Things to fix** come from tools that report problems:
  - open ports
  - missing security headers
  - TLS problems
  - mail spoofing
  - CORS
  - vulnerabilities and exposed secrets
  - expiring certificates

  Each problem has a **severity** (High, Medium or Low) set by a per-tool rule. *(Builder's call: the rules, written from real output and listed in a table in the plan.)* No problem is shown without a source.

### 7.3 Adapters

Each tool's raw answer goes through `classifyToolResult` (existing), then a **per-tool adapter** in `public/deep-adapters.js`. The adapter turns the answer into findings:

```
{kind:'account'|'breach'|'fact'|'host'|'problem'|'lead', ...}
```

Each finding carries its source tool and server and its evidence fields. If a tool has no adapter, a generic one picks out indicators and plain facts. **Adapters are written and tested against recorded real outputs** (see §11).

## 8. Progress page

Mockup choice: **A, show the work**. It replaces the setup area while a run is going.

- **Header:** the target. Below it: "About N minutes left" (estimated from tools remaining and average time so far, shown only after 5 tools finish) and "You can switch to other pages in the app. Keep this tab open until it finishes."
- **Progress bar:** `<progress>` with tools done / total. The total grows when leads add tools.
- **Stages, each with a tick when done:**
  1. Checking what you typed
  2. Following leads (round 2 of 3)
  3. Checking linked websites
  4. Putting the results together

  New leads appear under their stage as they're found: "Found 2 new leads: jane.smith@mail.com, @janesmith".
- **Live counts:** linked so far · possible · tools done of total.
- **Cancel search** opens a `confirmAction` dialog ("Stop the search? What's been found so far will be kept."). After stopping, the results page opens marked "Stopped early".
- **Screen readers:**
  - One polite status line announces stage changes and new leads, not every tool.
  - The progress bar has an accessible name.
  - Counts are plain text.
- **Returning to Deep Search** while a run is going shows this page again. Starting a second run is blocked until the first finishes or is cancelled.

## 9. Results pages

The results appear on the Deep Search page and replace the progress view. **New search** goes back to the box. The view is built by a new DOM-free module, **`public/deep-results-view.js`**. Every finding names its tool and server.

### 9.1 Person results

Mockup choice: **A, summary card first, with B's trail folded inside**.

1. **Header:** "Deep Search results", the target, duration, and a "Stopped early" or "N tools didn't answer" note if needed.
2. **What we know** (card). Every line comes from linked findings:
   - **Names used:** with sources
   - **Emails, usernames, phone numbers**
   - **Places mentioned**
   - **⚠ In N data breaches:** years and names
   - **Possible sanctions match**, only if it applies
3. **Linked accounts (N)**, grouped by kind: Social, Developer, Forums, Shopping, Other.
   - **Each account:** site, profile link (external, "opens in a new tab"), **Why linked:** one line, and tool · server.
   - **How we found this** (`<details>`): the chain from what you typed to this account, step by step.
4. **Websites found:** each with what Passive and Light touch checks showed, plus a **Deep Search this site** button.
5. **More leads we didn't follow** (only if the cap was hit): each with a Deep Search button.
6. **Show N possible matches** (`<details>`, closed): each with its reason ("Same username; nothing else links it").
7. **Search details** (`<details>`, closed): every tool that ran, with its result (found / nothing / failed and why), the rounds, and the time taken.
8. **Actions:** **Save to evidence** (the whole report as one finding in a case, like the main search) and **Pivot** buttons on emails, usernames and sites (existing behaviour).

### 9.2 Website and IP results

Mockup choice: **B, overview first**.

1. **Header** as above, with the level used.
2. **Overview** (card):
   - owner and registration dates
   - hosted by, and IP addresses
   - what it runs on
   - "N things to fix (see below)", shown when there are any
3. **Sections** (`<details>`, the first two open):
   - **Subdomains and hosts**
   - **Related sites:** look-alikes and same owner
   - **History:** archive snapshots
   - **Email setup**
   - **Certificates**

   Each item is listed once, with every source that found it.
4. **Things to fix (N)**, most serious first. Each problem has:
   - a plain-words meaning
   - what to do
   - tool · server

   At Passive and Light touch there may be none; then this section says what the higher levels would check.
5. **Other hosts found:** each with a Deep Search button.
6. **Search details** and **Save to evidence**, as for people.

### 9.3 Saving and reopening

- When a run ends (finished, stopped or failed), the page posts the result to a new `POST /api/deep-search/runs`.
- The server stores it as `work/deep-search-runs/<id>.json`, with the same size limits and file permissions as cases. The audit log entry gets the run id.
- **What's stored:** the findings with their statuses, reasons and trails; every tool's outcome; and each tool's **raw answer**, trimmed to 1 MB per tool and 20 MB per run, with a note where trimmed. Because raw answers are kept, **Open results** re-runs the current adapters, so a later adapter fix also improves old runs. *(My call.)*
- **Save to evidence** stores the results report (findings, reasons, sources), not the raw answers.
- **The audit log** gets the run id and the number of tools. Its tool-name list stays capped at 25; the full list is in the run file.
- `GET /api/deep-search/runs/<id>` returns it.
- Run history shows **Open results** for runs with a stored result. Older runs, from before this change, say "Results weren't kept for this run".

## 10. Accessibility and wording checklist

- Every new control is reachable by keyboard and has a visible focus ring. Folds are native `<details>`.
- Heading order in each view:
  - h1: the page
  - h2: card or section
  - h3: group
  - h4: item
- Focus after actions:
  - **Start:** the progress heading
  - **Done:** the results heading
  - **Cancel confirmed:** the results heading
  - **New search:** the box
  - **Deep Search this site:** the box, filled in, with the level picker
- External links say "(opens in a new tab)". Pivot button names start with "Pivot" (phase 5 rule).
- Colour is never the only signal: severities and statuses have text.
- **axe-core 4.10.2, zero violations** on these states, both themes, at 1280 and 375 px:
  - the box: empty, person, website at Intrusive, and an unsupported input
  - the progress page
  - person results with every section open
  - website results with every section open
  - Stopped early

## 11. Testing ("make no mistakes")

1. **Real outputs first.** Before writing adapters, record real answers from every tool in §6.6 into `tests/fixtures/deep/`. Use **identifiers the owner provides and owns**: their own email, username and phone, and their own domain or IP for the Active and Intrusive tools. Strip anything personal the owner doesn't want committed. Adapters and linking rules are then tested against these recordings, not invented samples.
2. **Unit tests**, `node --test`, DOM-free:
   - tool selection per type and level (no cap, all exclusions)
   - lead extraction and normalisation, and nothing searched twice
   - linking rules: every rule linked, possible and dropped, each with its reason
   - chain trails
   - severity rules
   - grant chunking, and the server's lifetime and timeout limits, including refusals: a timeout not allowed, a grant over the level, a grant reused
   - the progress estimate
   - results views, as escaped HTML with heading order checked
3. **A simulated full run:** fake `callTool` returns the recorded outputs with delays, through 3 rounds, with cancel mid-round and a failing tool.
4. **Browser checks:** axe (above), a keyboard pass of the whole flow, and one real person search and one real website search run by the owner from the launcher.
5. **Whole-branch review** before the PR.

## 12. Left to the builder

- Exact wording of the notices and stage labels, within the plain-words rule.
- Concurrency number, identifier cap and per-tool timeouts, within the limits above.
- Severity rules per tool and the account-kind grouping, from real output.
- How the progress estimate is smoothed.
- File and function names beyond those named here.
- Splitting the work into PRs. Suggested:
  1. engine, adapters and server changes
  2. pages

## 13. Open questions for the owner

- **Q1. Websites discovered during a person search: how far may they be checked?** **Answered: Passive and Light touch, without asking** (§6.4). Never higher; each site has a Deep Search this site button for more.
- **Q2. Real tool outputs: who records them, and with which identifiers?** **Answered:** the owner gives their own email, username, phone (optional), website and IP when building starts. The builder records every tool in §6.6 through the local server, started from the launcher. The recordings come first in the plan; adapters, linking rules, severity rules and the corrected tool table wait for them. Personal values are replaced with stand-ins before anything is committed, unless the owner says otherwise.
