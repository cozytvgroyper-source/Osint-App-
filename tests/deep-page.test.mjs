import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=read('app.js'),progress=read('deep-progress.js');
const deep=html.match(/<section id="deep"[\s\S]*?<section id="news"/)[0];

test('Deep Search is one clear box with one start button and optional tool choices',()=>{
  assert.match(deep,/Find everything about one email, username, website or IP/);
  assert.equal((deep.match(/id="deepTarget"/g)||[]).length,1);
  assert.match(deep,/id="deepStatus"[^>]*role="status"/);
  assert.match(deep,/id="deepLevelWrap"[^>]*hidden/);
  for(const id of ['deepLevel','deepAuthorize','deepTypedTarget'])assert.match(deep,new RegExp(`id="${id}"`));
  assert.equal((deep.match(/id="startDeepSearch"/g)||[]).length,1);
  assert.match(deep,/<details[^>]*>[\s\S]*<summary>Choose tools<\/summary>/);
});

test('unsupported input explains the limit, links to Search and disables Start',()=>{
  assert.match(progress,/Deep Search needs an email, username, website or IP\. To search a name, use Search\./);
  assert.match(app,/data-view-link="workspace"/);
  assert.match(app,/startDeepSearch[^\n]*disabled/);
});

test('the run guard, unload warning, focus and cancel confirmation are wired',()=>{
  assert.match(app,/if\(state\.deepRun\)[\s\S]{0,180}deepProgressHeading/);
  assert.match(app,/beforeunload/);
  assert.match(app,/deepProgressHeading[^\n]*focus/);
  assert.match(app,/deepResultsHeading[^\n]*focus/);
  assert.match(app,/deepTarget[^\n]*focus/);
  assert.match(app,/Stop the search\? What&#39;s been found so far will be kept\.|Stop the search\? What's been found so far will be kept\./);
  assert.match(app,/confirmAction/);
});

test('audit starts before the engine and completed runs are always stored',()=>{
  const started=app.indexOf("outcome:'started'");
  const engine=app.indexOf('runDeepEngine({');
  assert.ok(started>0&&engine>started);
  assert.match(app,/finally\{[\s\S]*\/api\/deep-search\/runs/);
});

test('history offers stored results',()=>{
  assert.match(app,/entry\.runId[\s\S]{0,180}Open results/);
  assert.match(app,/data-open-deep/);
  assert.match(app,/Results weren\\'t kept for this run/);
});

test('opening stored results re-adapts raw answers and links them again',()=>{
  assert.match(app,/adaptToolResult/);
  assert.match(app,/linkFindings/);
  assert.match(app,/\/api\/deep-search\/runs\/\$\{encodeURIComponent\(runId\)\}/);
  assert.match(app,/JSON\.parse\(raw\)/);
});

test('Deep Search targets reopen the setup with site controls visible',()=>{
  assert.match(app,/data-deep-target/);
  assert.match(app,/resetDeepSearch\(deepTarget\.dataset\.deepTarget\)/);
  assert.match(app,/deepLevelWrap[^\n]*hidden=!target\|\|person/);
  assert.match(app,/scrollTo\(\{top:0/);
});

test('saving Deep Search results uses the evidence record and existing case workflow',()=>{
  assert.match(app,/data-deep-save/);
  assert.match(app,/state\.lastResult=deepEvidenceRecord\(state\.deepCurrent\)/);
  assert.match(app,/saveLastResultToCase\(\)/);
});
