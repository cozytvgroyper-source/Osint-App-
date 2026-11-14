import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readAppSource} from './helpers/app-source.mjs';

const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=readAppSource(),progress=read('deep-progress.js'),styles=read('ui.css');
const deep=html.match(/<section id="deep"[\s\S]*?<section id="news"/)[0];
// One named function's source, so a check can't be satisfied by unrelated code elsewhere in app.js.
const fn=name=>{const start=app.indexOf(`async function ${name}(`);assert.ok(start>=0,name);const end=app.indexOf('\nasync function ',start+1);return app.slice(start,end<0?undefined:end);};

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
  assert.match(fn('startDeepSearch'),/window\.addEventListener\('beforeunload',warnDeepUnload\)/);
  assert.match(app,/deepProgressHeading[^\n]*focus/);
  assert.match(app,/deepResultsHeading[^\n]*focus/);
  assert.match(app,/deepTarget[^\n]*focus/);
  assert.match(app,/Stop the search\? What&#39;s been found so far will be kept\.|Stop the search\? What's been found so far will be kept\./);
  assert.match(fn('cancelDeepSearch'),/await confirmAction\(\{title:'Stop the search\?'/);
});

test('audit starts before the engine and completed runs are always stored',()=>{
  const started=app.indexOf("outcome:'started'");
  const engine=app.indexOf('runDeepEngine({');
  assert.ok(started>0&&engine>started);
  const run=fn('startDeepSearch');
  assert.match(run.slice(run.lastIndexOf('}finally{')),/^\}finally\{\s*await api\('\/api\/deep-search\/runs',run\)/);
});

test('history offers stored results',()=>{
  assert.match(app,/entry\.runId[\s\S]{0,180}Open results/);
  assert.match(app,/data-open-deep/);
  assert.match(app,/Results weren(?:\\'|')t kept for this run/);
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

const history=html.match(/<section class="deep-history"[\s\S]*?<\/section>/)[0];

test('Run history has Delete all, a status line and a busy note',()=>{
  assert.match(history,/<button class="text-button" id="deleteAllDeepHistory" hidden>Delete all<\/button>/);
  assert.match(history,/id="deepHistoryStatus"[^>]*role="status"/);
  assert.match(history,/<p id="deepHistoryBusy" class="subtle" hidden>Wait for the current search to finish before deleting\.<\/p>/);
  assert.match(history,/<h2 id="deepHistoryHeading" tabindex="-1">Run history<\/h2>/);
});

test('each history row gets an escaped Delete button',()=>{
  assert.match(app,/data-delete-deep-run="\$\{escapeHtml\(entry\.runId\)\}"/);
  assert.match(app,/aria-label="Delete search: \$\{escapeHtml\(entry\.target\)\}"/);
  assert.match(app,/data-delete-deep-time="\$\{escapeHtml\(entry\.time\)\}" data-delete-deep-target="\$\{escapeHtml\(entry\.target\)\}"/);
});

test('deletes go through confirmAction with the exact wording',()=>{
  assert.match(app,/confirmAction\(\{title:'Delete this search\?',message:"Its results and its history entry will be removed for good\. This can't be undone\.",confirmLabel:'Delete'\}\)/);
  assert.match(app,/title:count===1\?'Delete this search\?':count\?`Delete all \$\{count\} searches\?`:'Delete all searches\?'/);
  assert.match(app,/state\.deepHistoryCount=total>entries\.length\?null:runs\.length/);
  assert.match(app,/message:"Every search's results and history entry will be removed for good\. This can't be undone\.",confirmLabel:'Delete all'/);
  assert.match(app,/api\(`\/api\/deep-search\/runs\/\$\{encodeURIComponent\(runId\)\}\/delete`,\{\}\)/);
  assert.match(app,/api\('\/api\/deep-search\/history\/delete',\{time,target\}\)/);
  assert.match(app,/api\('\/api\/deep-search\/history\/delete-all',\{\}\)/);
});

test('deleting is blocked while a search runs',()=>{
  assert.match(app,/async function deleteDeepRun\([^)]*\)\{\s*if\(state\.deepRun\)return;/);
  assert.match(app,/async function deleteAllDeepRuns\(\)\{\s*if\(state\.deepRun\)return;/);
  assert.match(app,/const busy=Boolean\(state\.deepRun\)/);
  assert.match(app,/\$\{busy\?' disabled':''\}/);
  assert.match(app,/\$\('#deepHistoryBusy'\)\.hidden=!busy/);
  // Once a search is marked as running, the history is redrawn straight away, so its Delete buttons turn off.
  assert.match(app,/state\.deepRun=\{id,target,level\};(?:(?!state\.deepRun=)[\s\S]){0,400}?window\.addEventListener\('beforeunload',warnDeepUnload\);loadDeepHistory\(\)/);
});

test('after a delete, focus and status move sensibly',()=>{
  assert.match(app,/function setDeepHistoryStatus\(text\)\{const box=\$\('#deepHistoryStatus'\);if\(box\.textContent!==text\)box\.textContent=text;\n?\}/);
  assert.match(app,/afterDeepDelete\(\{runId:runId\|\|null\},'Search deleted\.'\)/);
  assert.match(app,/afterDeepDelete\(\{all:true\},'All searches deleted\.'\)/);
  assert.match(app,/await loadDeepHistory\(\);setDeepHistoryStatus\(message\);/);
  assert.match(app,/setDeepHistoryStatus\(''\);/);
  assert.match(app,/if\(state\.deepCurrent&&\(all\|\|state\.deepCurrent\.id===runId\)\)\{state\.deepCurrent=null;\$\('#deepResults'\)\.hidden=true;\$\('#deepResults'\)\.innerHTML='';\$\('#deepSetup'\)\.hidden=false;\}/);
  assert.match(app,/\$\('#deepHistoryHeading'\)\.focus\(\)/);
});

test('person result modules and app use the refined-result versions',()=>{
  assert.match(app,/deep-search\.js\?v=5/);
  assert.match(app,/deep-adapters\.js\?v=2/);
  assert.match(app,/deep-linking\.js\?v=2/);
  assert.match(app,/deep-results-view\.js\?v=2/);
  assert.match(html,/src="\/app\.js\?v=61"/);
});

test('result links use the accessible theme color',()=>assert.match(styles,/#deepResults a\{color:var\(--accent-dark\)\}/));

// ---- Minor review fixes: Deep Search page quirks ----

test('stopping a search keeps the keyboard place and never errors if the search already finished',()=>{
  const cancel=fn('cancelDeepSearch');
  assert.match(cancel,/state\.deepController\?\.abort\(\)/);
  assert.doesNotMatch(cancel,/state\.deepController\.abort\(\)/);
  assert.match(cancel,/deepProgressHeading[\s\S]*deepResultsHeading[\s\S]*focus\(\)/);
});

test('while a search runs, opening an old result or starting another brings back the live progress',()=>{
  assert.match(app,/function showLiveDeepSearch\(\)\{\s*if\(!state\.deepRun\)return false;/);
  assert.match(fn('openDeepResults'),/^async function openDeepResults\(runId\)\{\s*if\(showLiveDeepSearch\(\)\)return;/);
  assert.match(app,/function resetDeepSearch\(value=''\)\{\s*if\(showLiveDeepSearch\(\)\)return;/);
  assert.match(app,/data-open-deep="\$\{escapeHtml\(entry\.runId\)\}"\$\{busy\?' disabled':''\}>Open results/);
});

test('a tool that answers with a plain list keeps the heading order',()=>{
  assert.match(app,/if\(Array\.isArray\(payload\)\)return `<section class="result-category"><div class="category-head"><div><p class="eyebrow">RESULT<\/p><h3>Findings<\/h3><\/div><\/div>\$\{renderArray\(payload\)\}<\/section>`;/);
});
