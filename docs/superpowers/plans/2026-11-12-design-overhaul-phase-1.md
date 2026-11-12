# Design Overhaul, Phase 1: Foundation and Navigation, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the accessible foundation for the redesign and fix the navigation and page headers. It provides:
- design tokens that meet the contrast rules
- shared building blocks and a plain-language glossary
- a skip link, visible focus and reduced motion
- grouped navigation with real page names and intros
- dialogs that announce their titles

**Architecture:**
- **New modules:**
  - `public/ui.js` holds pure functions that return escaped HTML strings, so `node --test` can check them.
  - `public/glossary.js` holds the plain-language terms.
  - `public/ui.css` holds the tokens and building-block styles. It loads first and owns the color palette.
- **Existing pages:** they keep their current markup except the navigation, the page header and each view's duplicate top heading. Phases 2–4 move each page onto the building blocks.

**Tech Stack:** Plain HTML, CSS and ES modules, with `node --test` on Node ≥ 22. axe-core is used only inside the built-in test browser (Task 6).

**Spec:** `docs/superpowers/specs/2026-11-12-design-overhaul-design.md` (this plan covers its release phase 1)

## Global Constraints

- Plain HTML, CSS and ES modules: no framework, no build step, no new runtime dependencies.
- Text sizes (px): 13 (captions and small print only), 16 (body), 18, 22, 28, 34. Nothing smaller than 13.
- Spacing (px): 4, 8, 12, 16, 24, 32, 48. Radius (px): 8 for controls, 14 for cards, 20 for panels.
- Contrast: text against its background ≥ 4.5:1. Large text, icons, borders and focus outline ≥ 3:1. Both themes.
- Focus: a 3 px outline on `:focus-visible` for every focusable element, in both themes. `outline: 0` is never used without a replacement.
- Motion: transitions of 150 ms or less. Under `prefers-reduced-motion: reduce`, transitions and the pulse animation are turned off.
- Target size: interactive targets at least 24×24 px.
- These four terms keep their names: **MCP server**, **Tool library**, **Passive / Light touch / Active / Intrusive**, **Pivot**. "Run grant" is never shown on the page.
- Safety behavior is unchanged: run confirmations, typed names, authorization checkboxes, tiers and grants.
- Every interpolated value in `ui.js` goes through `escapeHtml`.
- Bump the `?v=` query on every stylesheet and module `index.html` or `app.js` loads that this phase changes. Each new file loads with `?v=1`.

## Review Focus

1. **Hostile text** (`<img onerror>`, quotes) in labels, hints, card titles and badge text passed to `ui.js`: it is escaped and never becomes markup. Covered in Task 1.
2. **An icon-only button created without a label:** this is a programming error. `button()` throws instead of emitting an unlabeled control. Covered in Task 1.
3. **The collapsed sidebar** (≤1050 px, icons only) and the phone tab bar (≤720 px): every entry still has an accessible name, and the existing layout and phone tab-bar tests keep passing. Covered in Task 4.
4. **Dark theme:** the contrast test and the focus outline are checked in both themes, not only light. Covered in Task 2.
5. **Opening a dialog from the keyboard and closing it with Escape:** focus returns to the button that opened it. Covered in Task 5 (`openDialog`) and the Task 6 keyboard pass.

---

### Task 1: Shared building blocks and glossary

**Files:**
- Create: `public/ui.js`, `public/glossary.js`
- Modify: `public/app.js` (remove the local `escapeHtml` at line 66 and import it from `./ui.js?v=1`)
- Test: `tests/ui.test.mjs`, `tests/glossary.test.mjs`

**Interfaces:**
- Produces, in `ui.js` (each returns a string):
  - `escapeHtml(value = ''): string`. This is the existing function, moved unchanged.
  - `pageHeader({title, intro}): string`. Produces `<h1>` and `<p class="page-intro">`.
  - `navItem({view, icon, label, current = false}): string`. Produces `<button class="nav" data-view>` with `<span aria-hidden="true">` around the icon and `aria-current="page"` when `current` is true.
  - `button({label, kind = 'secondary', icon = '', iconOnly = false, attrs = {}}): string`.
    - `kind` is `primary`, `secondary` or `quiet`, giving class `btn btn-<kind>`.
    - When `iconOnly` is true, `label` becomes the `aria-label` and the icon is `aria-hidden`.
    - It throws `Error('button needs a label')` when `label` is empty.
    - `attrs` are escaped `name="value"` pairs.
    - Output always includes `type="button"` unless `attrs.type` is given.
  - `field({id, label, hint = '', error = '', control}): string`.
    - `control` is an object `{tag: 'input'|'select'|'textarea', attrs, options?}`.
    - Produces `<label for=id>`.
    - The hint gets id `${id}-hint` and the error gets id `${id}-error`, both listed in `aria-describedby`.
    - `aria-invalid="true"` is set when there is an error.
  - `card({title, body = '', actions = '', headingLevel = 3}): string`. `body` and `actions` are trusted HTML from other `ui.js` calls; `title` is escaped.
  - `badge({text, tone = 'neutral', icon = ''}): string`. Always contains `text`.
  - `emptyState({title, text, action = ''}): string`. `action` is trusted HTML.
  - `term(key): string`.
    - Produces `<span class="term" title="<explain>">` holding the label, followed by `<span class="visually-hidden">: <explain></span>`.
    - It throws `Error('Unknown glossary term: <key>')` for an unknown key.
- Produces, in `glossary.js`:
  - `export const GLOSSARY` with entries `{label, explain, technical?}`.
  - Keys and values, copied from the spec:

    | Key | Label | Explanation |
    |---|---|---|
    | `mcpServer` | MCP server | A service Public Desk asks when you search. |
    | `toolLibrary` | Tool library | Every tool your MCP servers offer. |
    | `passive` | Passive | the `targetSees` text from `TIERS` in `tool-tiers.js` |
    | `light` | Light touch | the `targetSees` text from `TIERS` |
    | `active` | Active | the `targetSees` text from `TIERS` |
    | `intrusive` | Intrusive | the `targetSees` text from `TIERS` |
    | `pivot` | Pivot | Search this value next. |
    | `unverified` | Not checked yet | (none) |
    | `confirmed` | Confirmed | (none) |
    | `ruledOut` | Ruled out | (none) |
    | `fingerprint` | Fingerprint (SHA-256) | Proves this saved result hasn't changed. |
    | `dataSource` | Data source | An API key that unlocks more results for some tools. |

  - The four tier entries are built from `TIERS` (import from `./tool-tiers.js`), so the wording has one source.

- [ ] **Step 1: Write the failing tests**

```js
// tests/ui.test.mjs
import {escapeHtml,pageHeader,navItem,button,field,card,badge,emptyState,term} from '../public/ui.js';
const hostile='<img src=x onerror=alert(1)>"\'';
test('escapes every interpolated value',()=>{
  for(const html of [pageHeader({title:hostile,intro:hostile}),button({label:hostile}),card({title:hostile}),badge({text:hostile}),emptyState({title:hostile,text:hostile}),
    field({id:'q',label:hostile,hint:hostile,error:hostile,control:{tag:'input',attrs:{value:hostile}}})])
    assert.doesNotMatch(html,/<img/);
});
test('one h1 per page header, with its intro',()=>{assert.equal((pageHeader({title:'Search',intro:'Look up'}).match(/<h1/g)||[]).length,1);});
test('nav items hide their icon from screen readers and mark the current page',()=>{
  const html=navItem({view:'evidence',icon:'◇',label:'Evidence',current:true});
  assert.match(html,/<span aria-hidden="true">◇<\/span>/);assert.match(html,/aria-current="page"/);assert.match(html,/data-view="evidence"/);
  assert.doesNotMatch(navItem({view:'news',icon:'x',label:'News'}),/aria-current/);
});
test('icon-only buttons get their label as an accessible name, and a label is required',()=>{
  assert.match(button({label:'Clear history',icon:'⌫',iconOnly:true}),/aria-label="Clear history"/);
  assert.match(button({label:'Go'}),/type="button"/);
  assert.throws(()=>button({label:''}),/button needs a label/);
});
test('fields link their label, hint and error',()=>{
  const html=field({id:'endpoint',label:'Endpoint',hint:'Must start with https://',error:'Not a URL',control:{tag:'input',attrs:{type:'url'}}});
  assert.match(html,/<label for="endpoint">/);assert.match(html,/aria-describedby="endpoint-hint endpoint-error"/);
  assert.match(html,/aria-invalid="true"/);assert.match(html,/id="endpoint-error"/);
});
test('badges always carry text',()=>{assert.match(badge({text:'Passive',tone:'safe'}),/Passive/);});
test('glossary terms carry their explanation for screen readers',()=>{
  assert.match(term('pivot'),/Pivot/);assert.match(term('pivot'),/visually-hidden">: Search this value next\./);
  assert.throws(()=>term('nope'),/Unknown glossary term: nope/);
});
```

```js
// tests/glossary.test.mjs
import {GLOSSARY} from '../public/glossary.js';
import {TIERS} from '../public/tool-tiers.js';
test('the kept terms keep their names and the tiers reuse their tier text',()=>{
  assert.equal(GLOSSARY.mcpServer.label,'MCP server');assert.equal(GLOSSARY.toolLibrary.label,'Tool library');assert.equal(GLOSSARY.pivot.label,'Pivot');
  for(const tier of TIERS)assert.equal(GLOSSARY[tier.key].explain,tier.targetSees);
  assert.equal(GLOSSARY.unverified.label,'Not checked yet');
});
test('"run grant" is never a shown term',()=>{assert.ok(!JSON.stringify(GLOSSARY).toLowerCase().includes('run grant'));});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/ui.test.mjs tests/glossary.test.mjs`. Expected: FAIL, because the modules are not found.
- [ ] **Step 3: Implement `ui.js` and `glossary.js` with the interfaces above.** Then change `app.js` to `import {escapeHtml} from './ui.js?v=1';` and delete its local copy.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `feat(ui): shared accessible building blocks and plain-language glossary`.

---

### Task 2: Tokens, contrast, focus and motion (`ui.css`)

**Files:**
- Create: `public/ui.css`
- Modify:
  - `public/index.html`: load `ui.css?v=1` **first**, before `styles.css`, and bump the other stylesheets' `?v=`.
  - `public/styles.css`:
    - Delete the two palette blocks at lines 2–3 (`:root{…}` and `[data-theme="dark"]{…}`), which move to `ui.css`.
    - Remove every `outline:0`.
    - Raise every `font-size` and `font:` shorthand below 13 px to 13 px.
    - Delete the local `--deep:#d98a12` in `.deep-view`, and change `.nav-deep{color:#a76508}` to `color:var(--deep)`, so Deep Search uses the contrast-checked token.
  - `public/results.css` and `public/theme.css`: the same font-size floor and the same `outline:0` removal.
- Test: `tests/design-tokens.test.mjs`

**Interfaces:**
- **Palette:** `ui.css` owns both palettes, keeping every existing variable name (`--bg --surface --surface-2 --ink --muted --line --accent --accent-dark --blue --purple --orange --cyan --navy --silver --shadow --radius --sans --mono`).
- **New tokens:**
  - text sizes: `--text-xs:13px --text-sm:16px --text-md:18px --text-lg:22px --text-xl:28px --text-2xl:34px`
  - spacing: `--space-1:4px` … `--space-7:48px`
  - radius: `--radius-control:8px --radius-card:14px --radius-panel:20px`
  - colors: `--field-border`, `--focus`, `--action`, `--on-action`, `--deep`
- **Colors that change for contrast** (light / dark); all other colors are unchanged:

  | Token | Light | Dark |
  |---|---|---|
  | `--muted` | `#4f6885` | `#9fbae0` (unchanged) |
  | `--accent` | `#c8102e` | `#ff6378` |
  | `--deep` | `#8f5606` | `#f0a63a` |
  | `--field-border` | `#6f8aa8` | `#5a83bd` |
  | `--focus` | `#0868dc` | `#22bdf4` |
  | `--action` | `#0868dc` | `#0868dc` |
  | `--on-action` | `#ffffff` | `#ffffff` |

- **Rules:**
  - `:focus-visible{outline:3px solid var(--focus);outline-offset:2px}`.
  - Text inputs and selects get `border-color:var(--field-border)`.
  - `.primary` and `.btn-primary` use `background:var(--action);color:var(--on-action)`. The gradient in `theme.css` is removed.
  - Body: `font-size:var(--text-sm);line-height:1.5`.
  - `@media (prefers-reduced-motion: reduce){*,*::before,*::after{transition:none!important;animation:none!important}}`.
  - Transitions are 150 ms or less.
  - `.visually-hidden` uses the standard clip pattern.
  - Classes for Task 1's output: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-quiet`, `.field`, `.field-hint`, `.field-error`, `.card`, `.badge`, `.empty-state`, `.page-intro`, `.term` (dotted underline).
  - Interactive controls get `min-height:24px` or more.

- [ ] **Step 1: Write the failing tests** (`tests/design-tokens.test.mjs`). The tests read the CSS files as text and parse the `:root` and `[data-theme="dark"]` blocks of `ui.css`.

```js
const ratio=(a,b)=>{/* WCAG relative luminance contrast of two #rrggbb colors */};
const PAIRS=[['ink','bg',4.5],['ink','surface',4.5],['ink','surface-2',4.5],['muted','bg',4.5],['muted','surface',4.5],['muted','surface-2',4.5],
  ['accent-dark','bg',4.5],['accent-dark','surface',4.5],['accent-dark','surface-2',4.5],['accent','bg',4.5],['accent','surface',4.5],['accent','surface-2',4.5],
  ['deep','bg',4.5],['deep','surface',4.5],['on-action','action',4.5],['field-border','bg',3],['field-border','surface',3],['focus','bg',3],['focus','surface',3],['focus','surface-2',3]];
test('every text and control color meets WCAG AA in both themes',()=>{
  for(const theme of ['light','dark'])for(const [fg,bg,min] of PAIRS)
    assert.ok(ratio(token(theme,fg),token(theme,bg))>=min,`${theme} ${fg} on ${bg}`);
});
test('no text smaller than 13 px in any stylesheet',()=>{
  for(const file of ['ui.css','styles.css','results.css','theme.css'])for(const m of read(file).matchAll(/font(?:-size)?:[^;}]*?(\d+(?:\.\d+)?)px/g))
    assert.ok(Number(m[1])>=13,`${file}: ${m[0]}`);
});
test('focus is always visible',()=>{
  for(const file of ['ui.css','styles.css','results.css','theme.css'])assert.doesNotMatch(read(file),/outline:\s*(?:0|none)\b/,file);
  assert.match(read('ui.css'),/:focus-visible\{outline:3px solid var\(--focus\)/);
});
test('motion is short and stops for people who ask for less',()=>{
  assert.match(read('ui.css'),/@media \(prefers-reduced-motion: reduce\)\{[^}]*\{[^}]*animation:none!important/);
  for(const file of ['ui.css','styles.css','results.css','theme.css'])for(const m of read(file).matchAll(/transition:[^;}]*?(\d+)ms/g))assert.ok(Number(m[1])<=150,`${file}: ${m[0]}`);
});
test('ui.css loads before the other stylesheets',()=>{const html=read('index.html');assert.ok(html.indexOf('/ui.css?v=')<html.indexOf('/styles.css?v='));});
```

  - The font-size regex must not count `line-height` or letter-spacing values. Only the size in a `font:` shorthand counts: the number right before `px` that follows the weight.
  - Write `ratio` with the standard sRGB relative-luminance formula. `token(theme,name)` reads the dark value from the dark block and falls back to `:root`.
  - Transitions written in seconds (`.2s`) count as 200 ms. Convert them, or rewrite them in ms.
- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/design-tokens.test.mjs`. Expected: FAIL, because `ui.css` is missing.
- [ ] **Step 3: Create `ui.css`, move the palettes into it, and apply the floors and removals listed above.** Inputs that lost `outline:0` keep their existing container `:focus-within` style; the global `:focus-visible` adds the outline.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures. If `tests/layout.test.mjs` or `tests/mobile-nav.test.mjs` fail because a rule's text changed, update only the edited value. Keep their intent.
- [ ] **Step 5: Commit** `feat(ui): design tokens with WCAG AA contrast, visible focus and reduced motion`.

---

### Task 3: Skip link and page headers

**Files:**
- Modify:
  - `public/index.html`
    - Skip link: add `<a class="skip-link" href="#main">Skip to content</a>` as the first child of `<body>`, and give `<main>` `id="main" tabindex="-1"`.
    - Header: replace `<h1 id="pageTitle">Hello Groyper</h1>` with `<h1 id="pageTitle">Search</h1><p id="pageIntro" class="page-intro">…</p>`, and remove the `INVESTIGATION CONSOLE` eyebrow.
    - In each of these views, remove the top heading element that repeats the page name, together with its intro paragraph. Keep its buttons and controls:

      | View | Heading removed |
      |---|---|
      | `#servers` | h2 "MCP servers" |
      | `#library` | h2 "Tool library" |
      | `#deep` | `.deep-hero` h2 "Deep Search" and its `<p>` |
      | `#news` | h2 "News" |
      | `#evidence` | h2 "Evidence notebook" |

  - `public/app.js` `switchView` (line 71): it sets `#pageTitle` and `#pageIntro` from a `PAGES` table and sets `document.title` to `<title> · Public Desk`.
  - `public/ui.css`: `.skip-link` is visually hidden until focused, then appears top-left.
- Test: `tests/ui-polish.test.mjs`. Replace the test `each page header says something different from the panel heading below it` with the tests below.

**Interfaces:**
- `PAGES` in `app.js`, with titles and intros copied from the spec:

  | View | Title | Intro |
  |---|---|---|
  | `workspace` | Search | Look up a person, company, website, IP address, username or event. Public Desk asks connected sources and shows the best matches first. |
  | `evidence` | Evidence | Save findings into cases, mark what you've checked, and export a report. Cases are stored on this Mac. |
  | `news` | News | Live public events from IntelMap. Always open the original source before relying on a report. |
  | `servers` | MCP servers | MCP servers are the services Public Desk asks when you search. The first four are included; you can add your own. |
  | `library` | Tool library | Every tool your MCP servers offer, grouped by how visible it is to the target. The main search only uses Passive tools. |
  | `deep` | Deep Search | Run stronger checks against one target you own or have written permission to test. Nothing runs until you confirm. |

- [ ] **Step 1: Write the failing tests**

```js
test('the page header names the page and explains it; no view repeats the name',()=>{
  const pages=Object.fromEntries([...app.match(/const PAGES=\{([\s\S]*?)\n\};/)[1].matchAll(/(\w+):\{title:'([^']*)',intro:'([^']*)'\}/g)].map(m=>[m[1],{title:m[2],intro:m[3]}]));
  assert.deepEqual(Object.keys(pages).sort(),['deep','evidence','library','news','servers','workspace']);
  assert.equal(pages.workspace.title,'Search');
  for(const [view,{title,intro}] of Object.entries(pages)){
    assert.ok(intro.length>20,view);
    const section=html.match(new RegExp(`<section[^>]*id="${view}"[\\s\\S]*?</section>`))[0];
    assert.doesNotMatch(section,new RegExp(`<h[12][^>]*>${title}</h[12]>`),`${view} repeats "${title}"`);
  }
  assert.doesNotMatch(html+app,/Hello Groyper/);
});
test('a skip link leads to the main content',()=>{
  assert.match(html,/<body>\s*<a class="skip-link" href="#main">Skip to content<\/a>/);
  assert.match(html,/<main id="main" tabindex="-1">/);
  assert.equal((html.match(/<h1/g)||[]).length,1);
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/ui-polish.test.mjs`. Expected: the 2 new tests FAIL.
- [ ] **Step 3: Make the `index.html`, `app.js` and `ui.css` changes above.** `PAGES` is written one entry per line, in the form `workspace:{title:'Search',intro:'…'},`, so the test's parser matches it.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `feat(ui): skip link and real page names with plain intros`.

---

### Task 4: Grouped, accessible navigation

**Files:**
- Modify:
  - `public/index.html` `<nav>`: rewrite it into three groups. Each group is a `<div class="nav-group" role="group" aria-labelledby="nav-g-<n>">` with a small visible heading `<p id="nav-g-<n>" class="nav-group-label">`:
    1. Search, Evidence, News. This group has a visually hidden label "Main".
    2. "Tools and services": MCP servers, Tool library, Deep Search.
    3. "Outside sites": IntelMap, Situation Room.
  - Every icon span or `img` inside a nav entry: `aria-hidden="true"`. `img` keeps `alt=""`.
  - External links: accessible names `Open IntelMap (opens in a new tab)` and `Open Situation Room (opens in a new tab)`.
  - `public/app.js` `switchView`: set `aria-current="page"` on the active `.nav` and remove it from the others. The visual `.active` class stays.
  - `public/styles.css` / `ui.css`: nav labels at `var(--text-sm)`, the active entry marked with a left bar and bold text (not color alone), and group labels at `var(--text-xs)`.
- Test: `tests/navigation.test.mjs`. Also keep `tests/mobile-nav.test.mjs` and `tests/layout.test.mjs` passing. If the group wrappers stop the phone tab bar scrolling, flatten the groups at ≤720 px with `display:contents` on `.nav-group` and hide `.nav-group-label`.

**Interfaces:**
- **Unchanged:** the `data-view` values (`workspace evidence news servers library deep`). The `workspace` entry's visible label becomes "Search".

- [ ] **Step 1: Write the failing tests**

```js
const html=read('index.html'),app=read('app.js');const nav=html.match(/<nav[\s\S]*?<\/nav>/)[0];
test('navigation lists the app sections in task order, then tools, then outside sites',()=>{
  const order=[...nav.matchAll(/data-view="(\w+)"/g)].map(m=>m[1]);
  assert.deepEqual(order,['workspace','evidence','news','servers','library','deep']);
  assert.ok(nav.indexOf('Tools and services')<nav.indexOf('data-view="servers"'));
  assert.ok(nav.indexOf('Outside sites')<nav.indexOf('intelmap.watch'));
  assert.match(nav,/data-view="workspace"[^>]*>[\s\S]*?Search</);
});
test('nav icons are hidden from screen readers and outside links say they open a new tab',()=>{
  for(const m of nav.matchAll(/<(?:button|a) class="nav[^"]*"[\s\S]*?<\/(?:button|a)>/g)){
    assert.doesNotMatch(m[0].replace(/<(span|img)[^>]*aria-hidden="true"[^>]*>(?:[^<]*<\/span>)?/g,''),/<span>[^\w<]+<\/span>/,'decorative icon exposed: '+m[0].slice(0,60));
  }
  assert.match(nav,/aria-label="Open IntelMap \(opens in a new tab\)"/);
  assert.match(nav,/aria-label="Open Situation Room \(opens in a new tab\)"/);
});
test('the current page is announced',()=>{assert.match(app,/setAttribute\('aria-current','page'\)/);assert.match(app,/removeAttribute\('aria-current'\)/);});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/navigation.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Rewrite the nav and update `switchView` and the CSS as above.**
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures, including mobile-nav and layout.
- [ ] **Step 5: Commit** `feat(ui): grouped navigation with hidden icons and announced current page`.

---

### Task 5: Dialogs and icon-only buttons

**Files:**
- Modify:
  - `public/index.html`:
    - Dialogs: every `<dialog>` gets `aria-labelledby` pointing at its `h2`. The headings with ids today are `#keyDialogTitle`, `#runToolName` and `#resultTitle`; add the id `serverDialogTitle` to "Add MCP server".
    - Close buttons keep `aria-label="Close"`.
    - Clear history: `#clearHistory` gets `aria-label="Clear history"`, and its `⌫` gets `aria-hidden="true"`.
    - Theme toggle: `#themeToggle`'s glyph is wrapped in `aria-hidden="true"`.
  - `public/app.js`:
    - Add `openDialog(dialog, trigger = document.activeElement)`. It calls `showModal()`, focuses the first enabled `input, select, textarea` (or else the close button), and on `close` returns focus to `trigger` if it is still in the document.
    - Replace every direct `.showModal()` call with `openDialog(...)`. The result dialog's refresh path must not move focus when it is already open.
    - Theme toggle: set `aria-pressed` (`true` when dark) and `aria-label` (`Dark theme` or `Light theme`), both on load and on toggle.
- Test: `tests/a11y-structure.test.mjs`

**Interfaces:**
- Produces: `openDialog(dialog: HTMLDialogElement, trigger?: Element): void` in `app.js`. Phases 2–4 use it for every new dialog.

- [ ] **Step 1: Write the failing tests**

```js
test('every dialog is titled by its heading',()=>{
  for(const m of html.matchAll(/<dialog([^>]*)>([\s\S]*?)<\/dialog>/g)){
    const id=(m[1].match(/aria-labelledby="([^"]+)"/)||[])[1];assert.ok(id,`dialog without aria-labelledby: ${m[1]}`);
    assert.match(m[2],new RegExp(`<h2 id="${id}"`));
  }
});
test('every icon-only button has a name',()=>{
  for(const m of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)){
    const text=m[2].replace(/<[^>]*aria-hidden="true"[^>]*>[^<]*<\/[^>]+>/g,'').replace(/<[^>]+>/g,'').trim();
    if(!/\w/.test(text))assert.match(m[1],/aria-label="[^"]+"/,`unnamed button: ${m[0].slice(0,80)}`);
  }
});
test('every form control has a label',()=>{
  for(const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)){
    if(/type="(?:hidden|checkbox)"/.test(m[2])&&!/id=/.test(m[2]))continue;
    const before=html.slice(0,m.index);const inLabel=before.lastIndexOf('<label')>before.lastIndexOf('</label>');
    assert.ok(inLabel||/aria-label="[^"]+"/.test(m[2]),`unlabeled ${m[1]}: ${m[0].slice(0,80)}`);
  }
});
test('dialogs open through openDialog, which returns focus',()=>{
  assert.doesNotMatch(app.replace(/function openDialog[\s\S]*?\n\}/,''),/\.showModal\(\)/);
  assert.match(app,/function openDialog\(dialog,trigger=document\.activeElement\)/);
});
test('the theme switch says which theme is on',()=>{assert.match(app,/setAttribute\('aria-pressed'/);});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/a11y-structure.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Make the `index.html` and `app.js` changes above.** Write `openDialog` with that exact signature on one line, followed by its body.
- [ ] **Step 4: Run `npm test`.** Expected: 0 failures.
- [ ] **Step 5: Commit** `feat(ui): titled dialogs that return focus, and named icon-only buttons`.

---

### Task 6: Browser audit and keyboard pass (verification; no code unless it finds a problem)

- [ ] **Step 1: Start the branch's server.** Run `PORT=4174 PUBLIC_DESK_TOKEN=<throwaway> node server.mjs`, then open `http://127.0.0.1:4174/` in the built-in browser.
- [ ] **Step 2: Run axe-core on every view in both themes.** Load axe-core 4.10.2 (`https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js`) into the page from the test browser only.
  - The page's CSP blocks outside scripts, so fetch the script text in Node and pass it to the browser with `javascript_tool` as an evaluated string.
  - For each `data-view` and each theme, run `await axe.run(document, {runOnly: ['wcag2a','wcag2aa','wcag21aa','wcag22aa']})`.
  - **Expected:** zero `serious` or `critical` violations. For `moderate` or `minor` violations, list them in the PR as phase 2–4 work.
- [ ] **Step 3: Keyboard pass.** Using only the keyboard (Tab, Shift+Tab, Enter, Space, Escape), check each of these:
  - The skip link appears on the first Tab and moves focus into `<main>`.
  - Every nav entry is reachable, and the focus outline is visible on each one in both themes.
  - The Add MCP server, Run and Data source dialogs open with focus inside and close with Escape. Focus then returns to the button that opened them.
  - The page heading and the browser tab title change with the page.
- [ ] **Step 4: Fix and re-check if needed.** Fix any serious or critical finding in the task that owns that code, re-run `npm test` and this audit, and commit.
- [ ] **Step 5: Record the results** (axe counts per view and theme, plus the keyboard pass) for the phase PR description.
