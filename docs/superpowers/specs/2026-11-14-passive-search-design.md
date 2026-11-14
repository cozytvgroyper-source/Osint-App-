# Passive search: names, companies and news

Date: 2026-11-14 · Status: draft for the owner's approval

## Why

The owner uses the main Search page to look up **people, companies and news events**. Live searches gave poor answers:

- **"Donald Trump"** put his son first and folded the president away.
- **"JD Vance"** showed mostly unrelated Hacker News stories. The one relevant result was folded, and the same ten results were then listed again.

The owner wants the page to feel like a real search for those three things. Everything technical (websites, IPs, usernames, emails) belongs to Deep Search.

## What was found (2026-11-14, live, passive public sources only)

1. **The right answer is fetched but ranked as irrelevant.**
   - `search-ranking.js` scores an item on `title, name, headline, place, description, summary, snippet, text`.
   - Wikidata puts the entity's name in `label`, which is never read, so an item is judged on its `description` alone:
     - "President of the United States (2017–2021; since 2025)" scores 0 and is folded.
     - "American businessman, son of Donald Trump" matches and becomes the top result.
   - JD Vance ("Vice President of the United States since 2025") is folded for the same reason.
2. **Two-letter words are dropped from matching.** "JD Vance" matches on "vance" alone.
3. **Every result is shown twice.** The view lists "Top results" (the best 10), then each tool's matching items again.
4. **No news reaches the app at all.**
   - The Open OSINT data service fetches RSS feeds and GDELT through its own routes (`${ctx.origin}/api/rss-proxy?url=…`, `/api/intelligence/v1/search-gdelt-documents`).
   - Public Desk's preload `scripts/require-loopback-token.mjs` requires the launch token on every request to that service, including those internal self-calls, which carry no token.
   - So every feed returns HTTP 401: `get_news_rss`, `get_regional_conflict_feeds` (8/8 feeds) and `get_gdelt` ("Authentication required").
5. **Names use the wrong sources.** The `entity` intent uses `get_wikidata`, `get_news_rss` and `get_hn_search`.
   - Hacker News is a tech-news site.
   - `get_news_rss` takes no query; it returns current headlines and relies on filtering.
   - Better sources exist and work: `get_opensanctions`, `get_sec_filings` and `get_wikidata` returned correct answers live.
   - `get_offshore_leaks` and `get_opencorporates` answered but returned empty results (`get_opencorporates` notes a rate-limited free tier). They stay as sources; empty answers are shown only in Search details.

## Goals

- One search box for **a person's name, a company or a news event**, named **Passive search** in the page header and navigation.
- Results grouped by **what they tell you**, each result shown **once**:
  1. **Who or what this is:** the identity card from Wikidata (label, description, dates, website, Wikipedia link).
  2. **News:** from the RSS feeds and GDELT, with **Newest first** / **Most relevant** sorting.
  3. **Records:** sanctions (OpenSanctions, OFAC), offshore leaks, company registers (OpenCorporates), SEC filings.
- The exact person or company searched for ranks first: an exact name or alias match beats "mentions the name".
- A **Save to case** button on every result. It saves that one result to the selected case, or creates a case first if none is selected (as Save does today).
- **Event searches** ("earthquakes in Chile", "Sudan ceasefire") show news newest first.
- News works again, by fixing the token preload so the data service's calls to itself are authorised.

## Non-goals

- No change to Deep Search, the Tool library, Evidence or MCP servers, beyond the hand-off described below.
- No new data sources or paid keys.
- No change to how cases store evidence. A saved result is an ordinary finding; the add route only learns to accept the finding's note.

## Anti-goals (failure even if it "works")

- A relevant result folded away while an unrelated one is shown on top.
- The same result shown twice.
- Website/IP/username tools running from Passive search.
- Weakening the data service's token lock for anything other than its own loopback address.

## Decisions (owner)

- **Website, IP address, username, email, phone, CVE or hash typed into Passive search:** nothing runs. A short message says this belongs in Deep Search, with a button that opens Deep Search with the input filled in. The example chips for a website, IP and username are removed.
- **File upload ("Add a file") stays.**
- **The focus box around the search field is removed completely**:
  - the `.search-row:focus-within` outline;
  - the global `:focus-visible` outline on `#query` only.

  Every other control keeps its focus marker. The owner accepted the trade-off: keyboard users won't see focus in that one field.
- **The "⌘K Search" header button, the ⌘K shortcut and the "⌘K jumps here" hint are removed.** "＋ New investigation" stays.
- **Live passive searches may be used** to check results before and after (public sources only, nothing paid, nothing that contacts a target).

## Approaches considered

- **A. Grouped by meaning (chosen).** Who/what, News and Records, each result once, News sortable. It reads like a search engine and fixes the root causes (ranking fields, duplicates, sources, news connection).
- **B. Keep the per-tool layout and patch the bugs.** Less work, but results stay organised by which tool found them, which the owner found unintuitive.

## Design

### Recognising the search

- **Target searches** (`extractTarget` finds a domain, IP, email, username, phone, CVE or hash): show the Deep Search hand-off instead of running tools. The button calls the existing `resetDeepSearch(value)` after switching to Deep Search.
- **Pivot buttons and "Search again" for a target value** go straight to Deep Search with the value filled in, and are never started automatically. *(Builder's call.)* Pivots and reruns of names, companies and events stay in Passive search.
- **Everything else** is a name, company or event:
  - **Every search runs the identity and news sources on its subject.** The subject is the query with topic and request words removed (`searchSubjectFor`, as today).
    - "Donald Trump news" and "Rosneft sanctions" still get the Wikidata card and the Records.
    - The card is shown only for a strong match (ranking tiers 1–2 below), so "earthquakes in Chile" doesn't get a misleading card unless Wikidata matches "Chile" exactly. *(Builder's call.)*
  - **Topic intents.** `searchIntent`'s topic intents only **add** their own sources. *(Builder's call; settles all 21 intents.)*
    - `organization`, `filings` and `offshore` count as **company** searches: they add the company Records sources.
    - `sanctions` adds its sources to **Records**.
    - Every other topic intent adds its sources to the group that fits its answers (see Groups).
  - **Event** = the query matched a topic intent other than `organization`, `filings`, `offshore` or `sanctions`, or contains a news word (latest, recent, news, today…). Event searches open News sorted Newest first.

### Groups

Four groups, in this order. A group with nothing to show is left out.

1. **Who or what this is:** Wikidata.
2. **News:** dated articles: RSS feeds, GDELT, and topic news feeds (cyber, maritime, aviation, defence, energy, regional).
3. **Related data:** topic sources that return data rather than articles, shown as today's readable records. *(Builder's call; the design originally said "part of News", which doesn't fit data.)* Examples: earthquake lists, ship positions, prices, quotes, NOTAMs, arXiv papers.
4. **Records:** OpenSanctions, OFAC sanctions, Offshore Leaks, OpenCorporates, SEC filings.

### Sources per search

- **The source list is exact.** Passive search runs exactly the sources listed below: its fixed sources plus the matched topic's own sources. *(Builder's call.)*
  - The planner's word-matching of other tools and its 6-tool cap are not used for Passive search.
  - The planner's exclusion rules (passive, reviewed, no paid or side-effect tools) still apply to every source.

- **Name or company:** `get_wikidata`, `get_opensanctions`, `get_offshore_leaks`, `get_news_rss`, `get_gdelt`.
  - Company-looking names (Wikidata says the entity is an organisation, or the query ends in Inc, Ltd, LLC, plc, AG, GmbH, SA, Corp or Company) also use `get_opencorporates` and `get_sec_filings`.
  - Because the type is only known once Wikidata answers, the company-only sources run as soon as either signal is seen.
- **Event:** `get_news_rss`, `get_gdelt`, plus the topic's own sources.
- **`get_hn_search` is no longer used by Passive search.** It stays in the Tool library.
- Only passive, reviewed tools run, as today (the planner's exclusion rules are unchanged).

### Ranking

- Text fields include `label`, `aliases` and `title`, plus the existing ones.
- Short words count: every word of two or more letters is matched ("jd" counts). A one-letter word is ignored.
- Score order, best first:
  1. the label equals the query (or one alias does), ignoring case, dots and spacing ("J. D. Vance" = "JD Vance");
  2. the whole query appears in the title or label;
  3. the whole query appears anywhere in the item;
  4. every word appears;
  5. some words appear.
- Items with no word of the query are hidden behind "Show N more that don't mention your search", per group.
- **Who or what this is** shows the single best Wikidata entity as a card, with other close matches listed under "Other people or things with this name" (for example Donald Trump Jr.).

### News

- Merged from all news sources and de-duplicated by link, then by normalised title.
- Each item shows date, source, title (linked) and a short snippet when one is available.
- **Sort:** a control with "Newest first" and "Most relevant".
  - Default is Newest first for events, Most relevant for names and companies.
  - Items without a date sort last under Newest first.
  - The choice applies to the open result only.

### Save to case

- Every result has a **Save to case** button.
- **What it saves:** a single finding with:
  - title: the item's title or label;
  - result: the item itself;
  - server: the tool's label;
  - the search query in the finding's note field: "From Passive search: <query>".
- It uses the same case API and default-case flow as today's Save button.
- **The note is saved in one step.** The case server's add-evidence route accepts an optional `note` (text, same limit as notes today), so the note is stored with the finding. *(Builder's call.)* This is a small, tested server change; it adds no new stored field.
- **After saving:** the button reads "Saved" (disabled) for that result, and a message names the case.
- The existing "Save whole report" button stays.

### Fixing the news connection

- `scripts/require-loopback-token.mjs` also wraps `globalThis.fetch` inside the data service. A request to the service's own loopback origin gets `Authorization: Bearer <launch token>` when it has no Authorization header.
  - "Own loopback origin" means: protocol `http:`, host `127.0.0.1` or `localhost`, and the port the service listens on (8080, read from the listening server, with 8080 as the fallback).
  - Requests anywhere else are untouched, so the token never leaves the machine or goes to another service.
- Tests:
  - a self-request gets the header;
  - a request to another host or port does not;
  - an existing Authorization header is kept.
- **The owner must restart Public Desk once** (Stop, then Start) for the fix to take effect. This will be said plainly in the PR and the hand-off.

### Page and copy

- The navigation item and page header say **Passive search**.
- Header line: "Look up a person, company or news event in public sources. Nothing here contacts anyone."
- Placeholder: "e.g. Donald Trump, Rosneft or earthquakes in Chile".
- Example chips: a person (Donald Trump), a company (Rosneft), an event (earthquakes in Chile).
- The ⌘K hint is removed.

## Constraints

- No dependencies; plain ES modules; views stay DOM-free and escape all values (`escapeHtml`, `safeHttpUrl` for links).
- CSP `script-src 'self'; style-src 'self'`: no inline scripts or styles.
- Heading order h1 → h2 → h3 inside the result dialog. Pivot names start with "Pivot:". Save buttons are named "Save to case: <title>".
- Accessibility scan (axe) stays at 0 violations, light and dark.
- Tests first for every behaviour. Browser tests (`tests/browser-flows.test.mjs`) cover:
  - the grouped results and exact-name ranking;
  - the Deep Search hand-off;
  - Save to case;
  - the news sort.

  They use stubbed tool answers recorded from the live checks, with stand-in names only.
- The owner's real identifiers never go into fixtures; public figures used in live checks are not stored in fixtures either. Fixtures use stand-ins.

## Left to the builder

- Exact HTML structure and class names of the groups, and the sort control (a `<select>` or two toggle buttons).
- How Wikidata `positionHeld` / `occupation` IDs are shown. They're unresolved `wd:Q…` IDs and may be omitted.
- Order of the Records sources.
