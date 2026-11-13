import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The Search page for non-technical people: a labeled box, example searches that fill it, recent searches that can be
// run again, and one plain line about connected sources instead of technical connection panels.
const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=read('app.js');
const workspace=html.match(/<section id="workspace"[\s\S]*?<\/section>\s*<section/)[0];

test('the search box has a visible label and a plain button',()=>{
  assert.match(workspace,/<label for="query" class="search-label">What do you want to look up\?<\/label>/);
  assert.match(workspace,/<button type="submit">Search<\/button>/);
  assert.match(workspace,/Add a file \(picture, video, PDF, Word, text, CSV or JSON\)/);
});

test('example searches fill the box with a plain value',()=>{
  const chips=[...workspace.matchAll(/data-prompt="([^"]+)">([^<]+)</g)].map(m=>[m[2],m[1]]);
  assert.deepEqual(chips,[['A company: Rosneft','Rosneft'],['A website: example.com','example.com'],['An IP address: 8.8.8.8','8.8.8.8'],['A username: @jdoe','@jdoe'],['An event: earthquakes in Chile','earthquakes in Chile']]);
  assert.match(workspace,/role="group" aria-label="Example searches"/);
});

test('technical connection panels left the Search page',()=>{
  for(const id of ['workflowGrid','dataSourceStrip','connectionSummary','serverStatus'])assert.doesNotMatch(workspace,new RegExp(`id="${id}"`),id);
  assert.match(workspace,/id="sourcesStatus"[^>]*role="status"/);
  assert.match(workspace,/<h2>Recent searches<\/h2>/);
});

test('every element app.js looks up by id exists on the page',()=>{
  // Ids in the page, plus ids app.js creates itself in its templates (e.g. id="retryIntelNews").
  const ids=new Set([...(html+app).matchAll(/\bid=\\?"([\w-]+)/g)].map(m=>m[1]));
  for(const m of app.matchAll(/\$\('#([\w-]+)/g))assert.ok(ids.has(m[1]),`#${m[1]} is missing from index.html`);
});

test('only main searches can be run again',()=>{
  const fn=app.match(/function renderRecentSearches\(\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn,/Array\.isArray\(item\.sourceLog\)/);
  assert.match(fn,/data-rerun="\$\{escapeHtml\(item\.title\)\}"/);
});

test('the sources status explains an empty connection list',()=>{
  assert.match(app,/No MCP servers are connected, so searches can(?:'|\\')t run yet\./);
  assert.match(app,/data-view-link="servers">Open MCP servers</);
});

test('page switches do not animate for people who ask for less motion',()=>{
  assert.match(app,/matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\?'auto':'smooth'/);
});
