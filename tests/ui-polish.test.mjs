import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=read('app.js'),css=read('styles.css');

// The page header names the page and explains it in one plain line, so a view must not repeat that name as its
// own heading (one name per page, one h1 per document).
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

test('long tool descriptions are clamped in Tool Library cards, with the full text kept',()=>{
  assert.match(css,/\.tool-card \.tool-desc\{[^}]*-webkit-line-clamp:4/);
  assert.match(app,/<p class="tool-desc" title="\$\{escapeHtml\(t\.description/);
});

test('the main search box has a visible label',()=>{
  assert.match(html,/<label for="query"[^>]*>[^<]{10,}<\/label>/);
});

test('the ⌘K button is named for what it does: it focuses the search box',()=>{
  assert.match(html,/<button class="ghost" id="cmdButton"><kbd>⌘<\/kbd><kbd>K<\/kbd> Search<\/button>/);
});

test('the main search passes its subject and preferred tools to the report',()=>{
  assert.match(app,/subject:searchSubjectFor\(query\)/);
  assert.match(app,/preferredNames:intent\.tools/);
  assert.match(app,/target:!!extractTarget\(query\)/);
});
test('ranked reports use the results-only view; older saved reports keep the old layout',()=>{
  assert.match(app,/payload\?\.ranking&&payload\?\.report\)return renderRankedReport\(/);
});
test('the ranked view gets the same record body renderCategory shows',()=>{
  assert.match(app,/function renderBody\(data\)/);
  assert.match(app,/renderRankedReport\(payload,\{[^}]*renderBody[^}]*\}\)/);
  assert.match(app,/\$\{renderBody\(data\)\}<\/section>/);
});
test('a live redraw keeps open details open',()=>{
  assert.match(app,/details\[data-details-key\]\[open\]:not\(\[data-default-open\]\)/);
});
test('changed and new modules are imported with a version',()=>{
  assert.match(app,/search-report\.js\?v=\d+/);
  assert.match(app,/search-results-view\.js\?v=\d+/);
});

// Phase 2: the results panel is large, explains Pivot once, and its save button says which case it saves into.
test('the results panel is large and names the case it saves into',()=>{
  assert.match(read('ui.css'),/dialog\.result-dialog\{width:min\(1100px,calc\(100vw - 32px\)\);max-height:90vh\}/);
  const fn=app.match(/function saveButtonLabel\(activeCase\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn,/`Save to \$\{activeCase\.name\} case`/);
  assert.match(fn,/'Save to a new case'/);
  assert.match(app,/\$\('#saveEvidence'\)\.textContent=saveButtonLabel\(state\.activeCase\)/);
});
test('Pivot is explained once, at the top of results that have pivots',()=>{
  assert.match(app,/querySelector\('\.pivot-button'\)[\s\S]{0,200}pivot-note[\s\S]{0,80}term\('pivot'\)/);
});
