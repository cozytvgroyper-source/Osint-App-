import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=read('app.js'),css=read('styles.css');

test('each page header says something different from the panel heading below it',()=>{
  const labels=Object.fromEntries([...app.match(/const labels=\{([^}]*)\}/)[1].matchAll(/(\w+):'([^']*)'/g)].map(m=>[m[1],m[2]]));
  for(const view of ['servers','library','deep','news','evidence']){
    const section=html.match(new RegExp(`<section[^>]*id="${view}"[\\s\\S]*?</section>`))?.[0]||'';
    const heading=section.match(/<h2[^>]*>([^<]+)<\/h2>/)?.[1];
    assert.ok(heading,`${view} has a panel heading`);
    assert.notEqual(labels[view],heading,`${view}: header and panel both say "${heading}"`);
  }
});

test('long tool descriptions are clamped in Tool Library cards, with the full text kept',()=>{
  assert.match(css,/\.tool-card \.tool-desc\{[^}]*-webkit-line-clamp:4/);
  assert.match(app,/<p class="tool-desc" title="\$\{escapeHtml\(t\.description/);
});

test('the main search box has an accessible name',()=>{
  assert.match(html.match(/<input[^>]*id="query"[^>]*>/)[0],/aria-label="[^"]{10,}"/);
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
  assert.match(app,/payload\?\.ranking\)return renderRankedReport\(/);
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
  assert.match(app,/search-report\.js\?v=3/);
  assert.match(app,/search-results-view\.js\?v=1/);
});
