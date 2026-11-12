# Design overhaul: easy to use for non-technical people

Date: 2026-11-12
Status: approved in conversation, awaiting written-spec review

## Goal

Someone with no OSINT or MCP background can open Public Desk, run a search, understand the results, and save and review findings without help. The app also meets WCAG 2.2 AA.

**Not in scope:** an easier way to start and stop the app. That is a separate follow-up spec. Installation is not covered either.

## Decisions

| Topic | Decision |
|---|---|
| Who it's for | Non-technical people |
| Navigation | Every feature stays in the main navigation, explained in plain words. Nothing is hidden behind an "Advanced" mode. |
| First run | No tour and no welcome screen. Each page has to explain itself. |
| Look | A refresh of the current look: same palette and personality, with bigger text, more spacing, clearer buttons and consistent cards |
| Screens | Desktop first. Phones and tablets stay usable but are not optimized. |
| Wording | Plain words with a one-line explanation, except for four terms that keep their current names (see the Glossary) |
| Accessibility standard | WCAG 2.2 AA |
| Approach | Shared building blocks first, then pages one at a time, released in phases |
| Technology | Plain HTML, CSS and ES modules, as today: no framework, no build step, no new runtime dependencies |
| Safety | Run confirmations, typed target names, authorization checkboxes, risk tiers and run grants keep their exact behavior. Only their wording and layout change. |

## 1. Foundation

### Files
- **`public/ui.css`:** design tokens and the styles for the shared building blocks.
- **`public/ui.js`:** pure functions that return HTML strings for the building blocks. They have no DOM access, and every interpolated value goes through `escapeHtml` (moved from `app.js` into `ui.js` and imported by `app.js`). This module can be tested with `node --test`.
- **`public/glossary.js`:** the shared word list (see Glossary).
- **Retired:** `styles.css`, `results.css` and `theme.css` shrink page by page and are deleted in the last phase.

### Tokens
| Token | Values |
|---|---|
| Text sizes (px) | 13 (captions and small print only), 16 (body), 18, 22, 28, 34. Nothing smaller than 13. |
| Line height | 1.5 for body text, 1.25 for headings |
| Spacing (px) | 4, 8, 12, 16, 24, 32, 48 |
| Radius (px) | 8 for controls, 14 for cards, 20 for panels |
| Colors | Today's palette (navy ink, blue accent `--accent-dark`, red accent `--accent`, light and dark themes), adjusted only where contrast falls short |
| Contrast | Text against its background ≥ 4.5:1; large text, icons, borders and focus outline ≥ 3:1. This holds in both themes. |
| Focus | A 3 px outline on `:focus-visible` for every focusable element, in both themes. `outline: 0` is never used without a replacement. |
| Motion | Transitions of 150 ms or less. Under `prefers-reduced-motion: reduce`, transitions and the pulse animation are turned off. |
| Target size | Interactive targets at least 24×24 px (WCAG 2.5.8), 44×44 px where the layout allows |

### Shared building blocks (`ui.js`)
| Function | Output and accessibility it includes |
|---|---|
| `pageHeader({title, intro})` | The page's single `h1` and a one-line plain explanation |
| `navItem({view, icon, label, current})` | A button with a visible label; the icon has `aria-hidden="true"`; `aria-current="page"` when it is the current page |
| `button({label, kind, icon, attrs})` | `kind` is primary, secondary or quiet. An icon-only button requires `label`, which becomes its `aria-label`. |
| `field({id, label, hint, error, input})` | A visible `<label for>`. Hint and error are linked through `aria-describedby`. An error sets `aria-invalid="true"`. |
| `card({title, body, actions, headingLevel})` | A consistent card layout |
| `badge({text, tone, icon})` | Always shows text; tone is only a supporting color |
| `emptyState({title, text, action})` | What the page is, why it's empty, and one next action |
| `term(key)` | A glossary term with its explanation (see Glossary) |

**Dialogs** keep using `<dialog>`. A shared helper `openDialog(dialog, trigger)` in `app.js`:
- sets `aria-labelledby` to the dialog's heading
- moves focus to the first field, or to the close button
- returns focus to `trigger` on close

Escape closes dialogs (native behavior).

### Page-wide
- A "Skip to content" link as the first focusable element. It targets `<main id="main" tabindex="-1">`.
- Exactly one `<main>` and one `<nav aria-label="Primary">`.
- The toast and search progress use polite live regions (the toast already does).
- The theme switch has a visible label and `aria-pressed`, and its label names the current theme.
- `<html lang="en">` stays.

### Glossary (`glossary.js`)
Each entry is `{label, explain, technical?}`. Pages show the label, and the explanation sits next to it or appears on focus and hover.

These four keep their current names and gain an explanation:
- **MCP server:** "A service Public Desk asks when you search."
- **Tool library:** "Every tool your MCP servers offer."
- **Passive / Light touch / Active / Intrusive:** each keeps its name with the current `targetSees` text as its explanation (from `tool-tiers.js`).
- **Pivot:** "Search this value next."

Other terms:
- Evidence statuses are labeled "Not checked yet" (stored value `unverified`), "Confirmed" and "Ruled out".
- "Fingerprint (SHA-256)" is explained as "Proves this saved result hasn't changed."
- "Data source" is explained as "An API key that unlocks more results for some tools."
- "Run grant" is never shown on the page.

## 2. Navigation and Search

### Navigation
- **Order and grouping:**
  1. **Search**, **Evidence**, **News**
  2. a group labeled "Tools and services": **MCP servers**, **Tool library**, **Deep Search**
  3. a group labeled "Outside sites": **IntelMap ↗** and **Situation Room ↗**. Each has an accessible name ending in "(opens in a new tab)".
- **Labels:** 16 px text, with the current page highlighted (the highlight is more than color alone, e.g. a bar and bold text).
- **Page heading:** replaces the "Hello Groyper" greeting with the page's real name (`labels` in `app.js` becomes page titles).
- **Narrow windows:** at 720 px and below, today's tab-bar behavior stays, restyled with the new building blocks. Every page stays reachable.
- **View name:** the `workspace` view keeps its id. Its visible name becomes "Search".

### Search page, top to bottom
1. **Header:** `pageHeader` "Search", with the intro "Look up a person, company, website, IP address, username or event. Public Desk asks connected sources and shows the best matches first."
2. **Search box:**
   - Visible label "What do you want to look up?" and an 18 px input.
   - A Search button with a text label, and the ⌘K hint.
   - "Add a file" lists the accepted types in plain words.
3. **Example searches:** these fill the box but do not run the search.
   - "A company: Rosneft"
   - "A website: example.com"
   - "An IP address: 8.8.8.8"
   - "A username: @jdoe"
   - "An event: earthquakes in Chile"
4. **Results panel:** the existing `#resultDialog`, made larger (up to 1100 px wide, 90 vh tall). It keeps the PR 81 layout and data unchanged:
   - **Status line:** unchanged.
   - **Top results:** cards show their source as "<tool label> (via <server>)".
   - **Pivot:** the button keeps its name, and the first one on the page carries the explanation "Pivot: search this value next".
   - **Folded items:** the summary reads "Show N more from <tool> that don't mention your search".
   - **Search details:** unchanged.
   - **Save button:** "Save to evidence" is the primary button and names the target case ("Save to Rosneft case"). With no case, it reads "Save to a new case".
5. **Below the search:**
   - "Recent searches" lists today's history; each item reruns its search.
   - A one-line "Sources status": "4 MCP servers connected · 6 data sources set up · Manage". It replaces the server grid, data source strip and health panel on this page, which stay on the MCP servers page.

### States
- **No MCP server connected:** "No MCP servers are connected, so searches can't run yet." with the button "Open MCP servers".
- **No results:** "Nothing found for '<query>'. Try a shorter name, or open Search details to see which sources answered."

## 3. Evidence and News

### Evidence
- **Header:** "Evidence", with the intro "Save findings into cases, mark what you've checked, and export a report. Cases are stored on this Mac."
- **Case bar:**
  - A labeled "Case" select, plus buttons "New case", "Rename" and "Delete".
  - Delete opens a confirmation dialog that names the case and says it can't be undone.
  - The summary reads "<n> findings: <c> confirmed, <u> not checked yet, <r> ruled out".
- **Finding card:**
  - Title, the time it was found, and its source.
  - **Status:** a labeled group of three toggle buttons ("Not checked yet", "Confirmed", "Ruled out") with `aria-pressed`. Each carries text and an icon.
  - **Note:** labeled, with a character count (limit 4000, as the server enforces).
  - **Open:** shows the saved result in the results panel.
  - **Remove:** asks for confirmation.
  - **Fingerprint:** shown in small print with its glossary explanation.
- **Export:** one "Export" button opens a menu of three items. The menu is accessible: arrow keys move through it and Escape closes it. Each item has a one-line description.
  - Report (Markdown)
  - Report (printable page / PDF)
  - Raw data (JSON)
- **Browser-only findings:** the import notice keeps its behavior, worded as "<n> findings are saved only in this browser. Move them into this case so they're kept on this Mac."
- **Empty states:**
  - **No case:** "You don't have a case yet. Create one, then use 'Save to evidence' on any search result." with the button "New case".
  - **Empty case:** "This case has no findings yet. Run a search and save results here."

### News
- **Header:** "News", with the intro "Live public events from IntelMap. Always open the original source before relying on a report."
- **Toolbar:** a labeled "Search news" field, a "Category" select, and a "Refresh" button showing the last update time.
- **Metrics:** the four numbers keep their values. Each has a plain label and an explanation, e.g. "Signal index: IntelMap's overall activity score".
- **Cards:**
  - A category badge.
  - The relative time in `<time datetime>`, with the exact time as accessible text.
  - Title, source, and "Open source ↗", whose accessible name says it opens in a new tab.
- **Load more:** after loading, focus moves to the first new card.
- **States:**
  - Loading: "Loading news…", in a polite live region.
  - Error: "Couldn't reach IntelMap. Check your internet connection and try again." with a "Try again" button.

## 4. Technical pages

### MCP servers
- **Header:** "MCP servers", with the intro "MCP servers are the services Public Desk asks when you search. The first four are included; you can add your own."
- **Server card:**
  - Name.
  - A one-line purpose:
    - **Open OSINT:** "Public databases and news feeds; never contacts your target."
    - **OSINT Toolbox:** "Well-known open-source lookup tools."
    - **Omega MCP:** "A large toolkit; some tools contact the target and need confirmation."
    - **Consensus:** "Search published research papers."
  - Status in words: "Connected · <n> tools", "Not running", or "Needs sign-in".
  - Actions: "Reconnect", "Remove", and "Sign in" (for Consensus).
- **Add MCP server dialog:**
  - Labeled fields with hints. The endpoint hint is "Must start with https://". The token hint is "Kept only until you close this tab".
  - Errors appear next to the field they belong to.
- **Data sources:**
  - Each card leads with what it improves (from `DATA_SOURCES`), then its status.
  - The key dialog has labeled fields and a link to where to get a key.
- **Tool self-check:** shown as "Tool self-check: test that each search tool still works". The results table has headers, and pass and fail are shown with text and an icon.

### Tool library
- **Header:** "Tool library", with the intro "Every tool your MCP servers offer, grouped by how visible it is to the target. The main search only uses Passive tools."
- **Tier filter chips:** keep their tier names and show their explanations. They are toggle buttons with `aria-pressed`.
- **Tool card:**
  - Name, server and description.
  - The tier badge, which always shows text.
  - Where it's used: "Used by the main search" or "Tool library only".
  - Its flags, written out.
- **Run dialog:**
  - The safety steps are unchanged.
  - The arguments field is labeled "Tool settings (JSON)", with the hint "Leave as {} to use the defaults".
  - Each confirmation is a labeled checkbox.

### Deep Search
- **Header:** "Deep Search", with the intro "Run stronger checks against one target you own or have written permission to test. Nothing runs until you confirm."
- **Three numbered steps, each a section with its own heading:**
  1. Target and maximum level, with each level explained.
  2. Review the plan, listing each tool and what the target sees.
  3. Confirm and run.
- **Safety:** the typed-target check and the authorization checkbox are unchanged.
- **Run log:** stays a polite live region.
- **Run history:** a table with `<th scope="col">` headers.

## Testing

**Unit tests (`node --test`):**
- every `ui.js` function: labels, ARIA attributes, and escaping of hostile input
- the glossary has an entry for every term used in the page
- **contrast:** every text and background token pair, and every icon or border and background pair, meets its threshold in both themes (relative luminance computed in the test)

**Page structure tests** (parse `index.html` together with the rendered `ui.js` output):
- one `h1` per view
- every input, select and textarea has a label
- every icon-only button has an accessible name
- every `<dialog>` has `aria-labelledby`
- there is a skip link
- there is no `outline:0` without a `:focus-visible` replacement

**Automated audit:**
- axe-core is loaded only into the built-in test browser and run on every view, in both themes, with zero serious or critical violations.
- axe-core is never added to the app or its dependencies.

**Keyboard pass:** every feature can be reached and used with Tab, Shift+Tab, Enter, Space and Escape alone. This is recorded in each phase's PR.

**Safety regression:** the tests for tool tiers, run grants, Deep Search and the planner keep passing unchanged.

## Release phases

Each phase is its own PR. The app works after each one.

1. Foundation (`ui.css`, `ui.js`, `glossary.js`, tokens, skip link, focus and motion) and navigation
2. Search page and results panel
3. Evidence and News
4. MCP servers, Tool library and Deep Search
5. Delete the old CSS files and run the final full audit

## Known limits

- Phones and tablets stay usable but are not optimized.
- The plain-language wording is English only.
- Custom MCP server tokens still last only for the browser tab. That is unchanged, and now stated in the dialog.
