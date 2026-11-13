# Deep Search person results: refine design

Date: 2026-11-13 · Status: approved by the owner · Size: project

## 1. Intent

The owner ran a real username search and found that:
1. **None of the result links opened a working page.**
2. They want to **see everything found in connection to the person**: names, other usernames, other emails, IPs.

Investigation of that saved run (`work/deep-search-runs/226f79d7-….json` in the owner's app folder; values not reproduced here) found three problems:

- **Broken links.** Omega tools return a JSON envelope (`{"status":"ok","result":"…"}`) whose `result` text is escaped, so line breaks arrive as the two characters `\n`. The adapters read the outer text as-is. `URL_PATTERN` doesn't stop at a backslash, so every link ends in `\n`. Several URLs are also API/data addresses (`…/about.json`, `/api/users/…`, `/v2/users/…`) that are not pages.
- **False "linked" accounts.** The run reported 78 linked accounts, and almost none are proven:
  - `omega_socmint` answers with a status table (`200` found, `❌ 404` not found, `403`/`429`/`401` couldn't check). `profileTextAdapter` ignored the status and turned **every** row into an account, including rows the tool said **don't exist**.
  - `profileTextAdapter` puts the searched username into each finding's evidence (`usernames:[subject.value]`). Maigret entries also echo it through their URL. `linkFindings` then matches that echo against the seed and calls the account linked ("Profile shows <username>."). That is circular: the design's rule is that a username-only match is *possible*, not linked.
- **Connected details thrown away.** Maigret returned profile details for 50 of 201 sites (`data.fullname`, `bio`, `location`, `links`, `created_at`, …), but nothing reads them into names, links or leads.

This design fixes the bugs and changes how person results are shown. Website/IP results are out of scope.

## 2. Goals, non-goals, anti-goals

**Goals**
- Every link shown on a person results page opens the actual profile page, or is shown as plain text when no page address is known.
- An account is only **confirmed** by real evidence (rules in §5), never by the searched username alone.
- A **Connected details** section lists every name, username, email, phone, IP, website and location that comes from **confirmed** sources, each with where it came from.
- Accounts are grouped **Confirmed** (open) / **Same username, not confirmed** (folded) / **Not found or couldn't check** (folded).
- New emails and usernames found on confirmed sources keep being followed as leads (up to 3 rounds, as today).
- Re-opening an older saved run shows it the new way. This works because `rebuildDeepFindings` re-reads the saved raw answers through the adapters.

**Non-goals**
- Website and IP results ("Things to fix" etc.).
- Searching by a person's name. Names are shown, never searched.
- AI or photo matching (unchanged non-goals).
- Phone layout.

**Anti-goals**
- Showing a stranger's details as the person's: details from unconfirmed accounts never appear in Connected details.
- Any link that doesn't open what it claims.
- Calling an account found when the tool said "not found".
- A confirmation that only rests on the searched username.

## 3. Constraints

- No dependencies, no build step. View modules stay DOM-free and return escaped HTML strings. WCAG 2.2 AA, heading order h1 → h2 → h3, CSP `script-src 'self'; style-src 'self'`.
- Keep the terms "Passive", "Pivot" etc. Pivot buttons keep accessible names starting "Pivot:".
- Tests first. Fixtures use stand-ins only (`ownername`, `owner@example.com`, `Owner Example`, `owner-site.example`). Never commit owner values.
- Main Search is unchanged.

## 4. Approaches

1. **Fix at the source, then show** *(chosen)*: correct how answers are read (adapters), how accounts are confirmed (linking), and how results are shown (view). The saved data, Evidence and lead-following all become correct.
2. *Patch only the results page* (strip `\n`, relabel): rejected. Wrong links and false confirmations would stay in saved runs, in Evidence and in the leads the engine follows.

## 5. Decisions (the owner's)

- **Unconfirmed same-username accounts stay folded,** as today.
- **Connected details come only from confirmed sources.** Details found on an unconfirmed account are shown under that account inside the folded section.
- **An account is confirmed when any of these holds:**
  - **a. Registered email.** A check says the searched email is registered there (Holehe "registered"; GHunt once signed in).
  - **b. Links to something confirmed.** Its profile details show a detail that is already confirmed: a link to a confirmed website or account, a confirmed email, or a confirmed username other than the one searched.
  - **c. Corroborated.** Two or more accounts **on different sites** with the searched username independently show the **same extra detail**: the same full name, the same personal website/link, or the same email. All of those accounts become confirmed.

  Rule b then lets confirmation spread from any account confirmed by a or c, and repeats until nothing changes. The searched username itself never counts as a detail for a, b or c.
- **Confirmation level.** Every confirmed account says how many of the three rules back it, as a level:

  | Rules that hold | Level |
  |---|---|
  | all three (a, b and c) | **Level 1** (highest) |
  | two of them | **Level 2** |
  | one of them | **Level 3** (lowest) |

  The account records which rules held (`confirmedBy: ['a','c']`), and its level follows from the count. The card shows the level in words and numbers, never colour alone, for example "Level 2 · backed by 2 of 3 rules". "How we found this" lists each rule that held, with its reason.

## 6. Design

### 6.1 Reading answers (`public/deep-adapters.js`)

- **Envelope unwrap.** When the tool text parses as JSON with a string `result` (or `output`) field, adapters read that inner string. Real line breaks follow from the parse.
- **URL cleanup.** `URL_PATTERN` stops at backslashes and whitespace. A trailing literal `\n`, `\r`, `\t` or punctuation (`.`, `,`, `)`, `]`) is trimmed from every extracted URL.
- **Socmint status table** (`omega_socmint`, and `omega_social` if it uses the same table): parse each row as platform / status / URL.
  - `200` → account `presence:'found'`
  - `404` or `❌` → `presence:'not-found'`
  - `401`/`403`/`429`/other → `presence:'unchecked'`

  Rows with no URL are ignored. The searched username is **not** added to the evidence.
- **Profile page addresses.** A table of known data addresses → profile pages, from the real answers:

  | Data address | Profile page |
  |---|---|
  | `reddit.com/user/<u>/about.json` | `https://www.reddit.com/user/<u>` |
  | `hacker-news.firebaseio.com/v0/user/<u>.json` (or a cut-off `.jso`) | `https://news.ycombinator.com/user?id=<u>` |
  | `dev.to/api/users/by_username?url=<u>` | `https://dev.to/<u>` |
  | `en.gravatar.com/<u>.json` | `https://gravatar.com/<u>` |
  | `hub.docker.com/v2/users/<u>/` | `https://hub.docker.com/u/<u>` |
  | `api.twitch.tv/helix/users?login=<u>` | `https://www.twitch.tv/<u>` |

  Any other URL whose host starts `api.` or contains `firebaseio`, or whose path contains `/api/` or ends in `.json`, has no known page. The account keeps `url` empty and `rawUrl` set, and the view shows the site name as text.
- **Maigret profile details.** From each entry's `data`:
  - `fullname` → name
  - `links` (string or list) → websites (URLs, cleaned as above)
  - `location` → place
  - emails, phones and usernames from the existing extractors, run over `data` **excluding** the entry's own `url` and any value equal to the searched username

  Maigret entries are all `presence:'found'`.
- **Sherlock and Blackbird.** Each URL they return is `presence:'found'`, with no extra details.
- **Holehe "registered".** Unchanged: `verified:true`, which is rule a.
- **`omega_identity`** ("Found on N platforms" list, no status column): every row is `presence:'found'`, with the echo removed. `omega_social` returns a JSON object, not a table, so it keeps the generic reading.
- **Account findings** gain `presence` (`found` | `not-found` | `unchecked`) and `details` (`{names:[], usernames:[], emails:[], phones:[], ips:[], websites:[], places:[]}`), taken from that account's own profile only.
  - **Linking and leads use `details`, not raw `evidence`.** *(Builder call.)* Raw evidence collects every URL in an answer, including avatar and image addresses on shared hosts. If those counted, two strangers' accounts could be "linked" through a shared image host.
  - `details` excludes image fields (`image`, `image_bg`, `avatar`, any value ending in an image extension), the account's own URL, and every searched identifier.
  - `evidence` stays only as the record of what the tool said.

### 6.2 Confirming accounts (`public/deep-linking.js`)

For person searches:
- Status `linked` (shown as **Confirmed**) only by rules a/b/c in §5. The current "Profile shows <seed>" path no longer fires when the only matching identifier is the searched username itself.
- Rule c compares normalised details across accounts with `presence:'found'` on **different sites**:
  - names: case-folded, trimmed, inner whitespace collapsed, at least 2 characters, and not equal to the searched username
  - websites: host and path without `www.`, trailing slash or query; the account's own site host excluded
  - emails: exact, lower case
- Reasons, shown in "How we found this":
  - a: `Registered with <email>.`
  - b: `Profile links to <detail>, which is confirmed.`
  - c: `<N> profiles with this username share <the name "…" | the website … | the email …>.`
- `presence:'not-found'` and `presence:'unchecked'` accounts are never confirmed and never possible. They get status `dropped`, with reason `Not found.` / `Couldn't check (<status>).`, so the view can list them.
- Leads come only from confirmed findings' details: emails, usernames, phones and websites (domains), never names. Websites keep being checked at Passive and Light touch, as the owner decided before and as the engine does today. *(Answered already.)*
- **"Searched identifiers" means the seed plus every lead the engine has searched.** *(Builder call.)* None of them ever counts as a detail for a, b or c, because they are echoes. A lead was taken from a confirmed source, so it is itself confirmed. That means rule a covers a lead email too: Holehe "registered" for a lead email confirms that account. Accounts found for a lead username follow the same rules. The folded section is titled "Same username, not confirmed" and, when more than one username was searched, groups its cards under each username (h3).
- **Non-account findings about a searched identifier keep today's path.** *(Builder call.)* Breach records, GHunt's name fact, and generic facts/hosts/leads returned by a tool that was asked about that identifier stay linked as "Found while checking <identifier>". These are statements *about* the searched identifier, not claims that some account belongs to it. Only **accounts** need rules a/b/c.
- **One account across tools.** *(Builder call.)* Findings merge by normalised profile URL. Normalising strips `www.`, case, trailing slash and query, maps data addresses to their page (§6.1), and treats `twitter.com` and `x.com` as the same host. Presence precedence: **found** by any tool beats **unchecked**, which beats **not found**. When tools disagree (e.g. Maigret found it, socmint said 404), the account is shown as found, and "How we found this" lists the disagreement (`Socmint: not found (404)`). Nothing is hidden, and the anti-goal is kept: no single tool's "not found" is ever shown as "found".
- **"Different site" for rule c** means a different normalised host (same aliases as above). The same account reported by two tools is one site, so it can never back itself up.

### 6.3 Showing results (`public/deep-results-view.js`, person view only)

```
Deep Search results — ownername                                  [Save to Evidence] [New search]
6 accounts found · 2 confirmed · details: 1 name, 1 website

Connected details                (h2; from confirmed sources only)
  Names       Owner Example ............. GitHub, Twitter (Maigret)
  Usernames   …    Emails   …    Phones   …    IPs   …
  Websites    owner-site.example ........ GitHub profile        [Pivot →]
  Locations   Example City .............. Twitter (Maigret)

Confirmed accounts (2)          (h2; open; cards as today, link opens the profile)
  GitHub   github.com/ownername   [Open profile]   How we found this ▸

▸ Same username, not confirmed (4)      (folded <details>; each card shows its own details)
▸ Not found or couldn't check (23)      (folded; plain list: site — Not found / Couldn't check (403))

▸ Search details                        (unchanged)
```

- **Connected details** replaces "What we know". *(Builder call.)* Its sources are:
  - the `details` of **confirmed** accounts
  - the values of **linked non-account findings** (e.g. GHunt's name, a linked personal-website host, linked facts)

  IPs appear when a linked finding or a confirmed account's details contain one; person tools rarely return IPs, so the group is often absent. It shows only the groups that have values. Each value lists its sources (tool + site), and website/email/username values keep a **Pivot** button. Empty state: "No details were confirmed. Accounts that only share the username are listed below."
- **Confirmed accounts** replaces "Linked accounts". The existing grouping by kind (h3) stays. Within each kind, accounts are listed by level (1 first), then by site name. *(Builder call.)* Each card shows its level badge, e.g. "Level 1 · backed by 3 of 3 rules".
- **Evaluating all rules.** To count rules, linking checks a, b and c for every found account and records each one that holds. It doesn't stop at the first. Rule b is re-checked until nothing changes, so an account confirmed by a or c can also gain b.
- An account card's link is an `<a>` only when `url` is set. Otherwise the site name is plain text with "No page address" in muted text.
- **Summary line** under the heading: accounts found (presence found), confirmed, and the count of each kind of connected detail.

### 6.4 What stays the same

Engine, rounds and limits, run storage, Evidence saving (`deepEvidenceRecord` keeps saving findings without raw answers), delete, reopen, site results.

## 7. Testing

Test first, from the recorded shapes:
- **Adapters, built on the committed socmint fixture** (`omega-mcp--omega-socmint--username.json`): no URL ends in `\n` or a backslash; 404 rows → `not-found`, 403/429/401 → `unchecked`, 200 → `found`; the Reddit and HackerNews data addresses map to their profile pages; the evidence never contains `ownername` as an echo.
- **Maigret fixture:** `fullname`, `links` and `location` become details; the searched username isn't a detail.
- **Linking:**
  - username-only → never confirmed
  - rule a → confirmed
  - rule c: two sites with the same full name → both confirmed; the same name on the same site twice → not confirmed
  - rule b: chaining from a confirmed account's website to another account linking it
  - not-found and unchecked → dropped with the right reasons
- **View:**
  - headings in order
  - Connected details lists only confirmed-source values, with sources
  - unconfirmed details appear only inside the folded section
  - accounts without a page address render no `<a>`
  - hostile text is escaped
  - Pivot names start "Pivot:"
- **Reopen:** `rebuildDeepFindings` on a stored run fixture gives the new statuses.
- `npm test` 0 failures; axe 0 violations on a person results page in both themes at 1280 px.
- **Live check with the owner:** re-open the 11:41 run and confirm links open and statuses make sense; then one fresh username search.

## 8. Also in this branch

**Website detection bug.** `www.example.com` is detected as a *username* because the strict match compares the typed text with the extracted `example.com`. `example.com/path` isn't detected at all. Fix in `detectDeepTarget`: accept a leading `www.` and a path, and detect the domain. *(Builder call.)* The target becomes the bare domain (path dropped), and the status line and the typed-target box (Intrusive) use that detected domain, which the page already shows. This change is limited to `detectDeepTarget`'s typed-input path. Turning evidence URLs into identifiers during linking is replaced by `details` (§6.1), so it is unaffected. Test first.

## 9. Left to the builder

File and function names; the exact parsing code for the socmint table; summary-line wording within the plain-words rule; CSS for the details list using existing tokens.
