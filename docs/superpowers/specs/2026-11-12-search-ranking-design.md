# Main search: most relevant results first, results-only view

Date: 2026-11-12
Status: approved in conversation, awaiting written-spec review

## Goal

In the workspace's main search:

1. Show the most relevant results first.
2. By default, show only results. Each one names the tool and the server it came from.
3. Keep every existing search feature. Anything that is not a result moves into one collapsed "Search details" section.

## Decisions

| Topic | Decision |
|---|---|
| Information that is not a result | Moves into one **Search details** section, closed by default. It is never removed. |
| Layout | **Top results** (the best items from all tools combined, at most 10), then **one section per tool**. Sections and the items within them are sorted by relevance. |
| Relevance signals | (1) How well an item matches the search subject. (2) A record about the subject ranks above general context. Recency and multi-tool agreement are **not** used. |
| Items that do not mention the subject | Kept in their tool's section but folded behind "Show N more from <tool>". They never appear in Top results. |
| Approach | A single, generic ranking module (approach A). No per-tool handlers. |

## 1. Ranking step — new `public/search-ranking.js`

A module with no DOM code, testable with `node --test`.

**Inputs:** the search subject, the intent's preferred tool names (`intent.tools`), and one entry for each tool that returned data: `{tool, data}`, in plan order.

**Search subject:** comes from a new export in `search-query.js`, `searchSubjectFor(query)`. It applies the cleaning `argsForSearch` already does, without the per-tool parts:

- If the query contains a target (domain, IP, email and so on), the subject is the target's value.
- Otherwise it is the trimmed phrase from `searchSubject` ("OFAC sanctions on Rosneft" becomes "Rosneft").

`argsForSearch` is refactored to use this function, and its output does not change.

**1. Finding items.** A tool's items are found by walking its data:

- Every array whose elements are all objects is a list of items. Each element is one item, and the module remembers the path to that array.
- If no such array exists and the data is a non-empty object, the whole object is one item (examples: a WHOIS record, a CVE record).
- Arrays of strings or numbers are not items. `search-dedup.js` still handles them for Consolidated Findings.

**2. Match score** (0–3). The text checked is the item's `title`, `name`, `headline`, `place`, `description`, `summary`, `snippet` and `text` fields that hold strings, joined together and lowercased. For a single-record item with none of those fields, the text is all of its top-level string values.

| Condition | Score |
|---|---|
| Contains the subject as an exact phrase | 3 |
| Contains every word of the subject, but not as one phrase | 2 |
| Contains at least one word of the subject | 1 |
| Contains none of them | 0 (non-matching) |

Words are split on spaces and punctuation. One- and two-letter words are ignored, unless that leaves no words at all.

**3. Direct versus context.** A tool is *direct* if its name is in `intent.tools`. Every other tool is *context*.

**4. Ordering.**

- Items are sorted by match score (high to low), then direct before context, then the tool's original order.
- Each tool's items are split into `matching` (score ≥ 1) and `nonMatching` (score 0). Each part keeps the sort order.
- Sections are ordered by their best item, using the same comparison. Ties keep plan order.
- `topResults` holds the first 10 matching items from all tools combined, using the same sort.

**5. Empty subject.** If the subject is empty, every item gets a score of 1. The original order is kept, and nothing is folded.

**Output** (stored as `ranking`; contains plain JSON only):

```json
{
  "subject": "Rosneft",
  "topResults": [{"toolName": "get_opensanctions", "tool": "OpenSanctions", "server": "Open OSINT", "score": 3, "direct": true, "item": {}}],
  "sections": [
    {"toolName": "get_opensanctions", "tool": "OpenSanctions", "server": "Open OSINT", "direct": true,
     "single": false, "matching": [{}], "nonMatching": [{}]}
  ]
}
```

- `sections` is in display order.
- `single: true` means the tool returned one record (it is rendered as a fact list).
- Items are copies of the tool's own objects, so the renderer can reuse the existing `renderArray` and `renderRecord`.

## 2. Search window layout

From top to bottom:

1. **Status line:** "12 results from 4 tools". While tools are still running: "3 of 6 tools answered…". This is the only non-result text visible by default.
2. **Top results:** at most 10 cards, using the same card markup as today. Each card has a tag such as `OpenSanctions · Open OSINT`, and the pivot buttons stay.
3. **Results by tool:** one section per entry in `ranking.sections`.
   - The header shows the tool name and server only (no description).
   - Matching items come first. The existing limit of 25 items per list applies.
   - Non-matching items go inside `<details>`, with the summary "Show N more from <tool>".
   - A single-record tool renders as a fact list.
   - Any part of a tool's data that is not an item (for example, top-level facts beside a list) still renders, as it does today.
4. **Consolidated Findings:** unchanged, placed after the tool sections.
5. **Search details:** `<details>`, closed by default. It contains:
   - Sources: arguments, start and finish times, risk tier, and the reason each tool was picked
   - Still Running
   - every error and "no matching records" note, shown even when other tools returned results
   - Related Links
   - Planner Diagnostics (development mode only)
   - each tool's full description

**No results:** the window shows "No results for this search". Search details starts **open**.

**Live updates:** the report is still rebuilt as each tool answers. Before each redraw, the window records which `<details>` elements are open, using a stable `data-details-key` attribute (`search-details`, or `more:<toolName>`). After the redraw it reopens them. Scroll position is kept, as it is today.

## 3. Compatibility

- **Only additions:** `buildSearchReport` keeps every field it returns today: `report` and its named sections, `errors`, `sourceLog`, `modulesQueried`, `modulesWithResults`, `durationMs`, `servers`, `finished`, `findingCount`. It adds `data.ranking` to the payload.
- **Older saved evidence** (cases and history saved before this change) has no `ranking`. `renderReadableResult` renders it with the current layout. Saved data and its SHA-256 fingerprints are never rewritten.
- **"Add to case"** saves the new payload, including `ranking`. **Case reports** (Markdown and HTML) render saved evidence generically, so they need no change.
- **Not affected:** Deep Search, Self-check, file uploads and single-tool runs from the Tool Library. They do not call `buildSearchReport`.

## Files

| File | Change |
|---|---|
| `public/search-ranking.js` | New: finding items, scoring, sorting, Top results |
| `public/search-query.js` | Export `searchSubjectFor(query)`, and use it inside `argsForSearch` |
| `public/search-report.js` | Call the ranking step and add `ranking` to the payload |
| `public/app.js` | New results layout, Search details, keeping `<details>` open across redraws, falling back to the old layout when `ranking` is missing |
| `public/results.css` | Top results card tag, "Show more" summary, Search details styles |

`app.js` imports modules with a version query (`search-report.js?v=2`), so browsers don't keep running cached copies. Bump the version on every changed import and add one to the new module's import.

## Testing

- **`tests/search-ranking.test.mjs` (new):**
  - a phrase match scores above all words, which scores above some words, which scores above none
  - direct beats context only when match scores tie
  - Top results stops at 10 and leaves out non-matching items
  - a record with no item list counts as one item
  - an empty subject keeps the original order and folds nothing
  - string arrays are not treated as items
- **`tests/search-query.test.mjs`:**
  - `searchSubjectFor` cases ("OFAC sanctions on Rosneft" gives "Rosneft"; a domain query gives the domain)
  - `argsForSearch` output is unchanged for the existing cases
- **`tests/search-report.test.mjs`:**
  - `ranking` is present and every existing field is unchanged
  - sections reorder correctly as results arrive while the search is still running
- **App and UI tests:**
  - Search details is closed by default and open when there are no results
  - a saved report without `ranking` renders with the old layout
- **Verification:** `npm test` passes. Then a live check in the app with "OFAC sanctions on Rosneft", using passive tools only.

## Known limits

- Finding items uses general rules. A tool that nests its items inside something other than an array of objects falls back to being treated as a single record.
- Matching is on words, so a subject spelled differently in a source (for example "Rosneft" and "Роснефть") does not match.
