import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSearchReport} from '../public/search-report.js';
import {renderRankedReport} from '../public/search-results-view.js';

const escapeHtml=(value='')=>String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const helpers={escapeHtml,openKeys:null,
  renderArray:items=>`[A:${items.length}]`,
  renderRecord:data=>`[R:${typeof data==='string'?data:JSON.stringify(data)}]`,
  renderCategory:name=>`[C:${name}]`,
  renderSources:()=>'[S]'};
const labels={get_opensanctions:'OpenSanctions',get_news_rss:'News RSS'};
const mkTool=(name,serverName='Open OSINT')=>({name,serverName,serverId:'open-osint',description:`${name} description`});
const parse=built=>JSON.parse(built.result.content[0].text).data;
const build=({tools,outcomes,serverName,subject='Rosneft'})=>{
  const plan=tools.map((name,i)=>({tool:mkTool(name,serverName),score:10,reason:'r',args:{query:subject},startedAt:`2026-11-11T12:00:0${i}.000Z`}));
  const outs=outcomes.map((o,i)=>o&&({status:'fulfilled',value:{tool:plan[i].tool,outcome:o},finishedAt:`2026-11-11T12:00:1${i}.000Z`}));
  return parse(buildSearchReport({query:subject,intent:{id:'x',label:'X'},plan,outcomes:outs,links:[],
    categoryForTool:item=>`Cat ${item.name}`,sourceLabel:name=>labels[name]||name,subject,preferredNames:['get_opensanctions']}));
};
const articles=Array.from({length:40},(_,i)=>({title:i<2?`Rosneft story ${i}`:`Unrelated ${i}`}));
const main=opts=>build({tools:['get_opensanctions','get_news_rss'],serverName:opts?.serverName,outcomes:[
  {kind:'data',data:{results:[{name:'Rosneft'}]}},{kind:'data',data:{articles}}]});

test('shows only results by default, with tool and server on each top result',()=>{
  const html=renderRankedReport(main(),helpers);
  assert.match(html,/OpenSanctions · Open OSINT/);
  assert.match(html,/<details class="search-details" data-details-key="search-details">/);
  assert.ok(html.indexOf('Top results')<html.indexOf('search-details'));
  assert.match(html,/2 results? from 2 tools|\d+ results from 2 tools/);
});
test('folds non-matching items under Show N more',()=>{
  const html=renderRankedReport(main(),helpers);
  assert.match(html,/<details class="more-results" data-details-key="more:get_news_rss"><summary>Show 38 more from News RSS<\/summary>/);
});
test('opens Search details and says so when there are no results',()=>{
  const html=renderRankedReport(build({tools:['get_opensanctions','get_news_rss'],outcomes:[{kind:'empty'},{kind:'empty'}]}),helpers);
  assert.match(html,/No results for this search/);
  assert.match(html,/data-details-key="search-details" open/);
});
test('reports progress while tools are still running',()=>{
  const tools=['a','b','c','d','e','f'];
  const data=build({tools,outcomes:[{kind:'data',data:{x:1}},{kind:'data',data:{x:2}},{kind:'data',data:{x:3}}]});
  assert.match(renderRankedReport(data,helpers),/3 of 6 tools answered…/);
});
test('a redraw keeps open exactly the details that were open',()=>{
  const html=renderRankedReport(main(),{...helpers,openKeys:new Set(['more:get_news_rss'])});
  assert.match(html,/data-details-key="more:get_news_rss" open/);
  assert.doesNotMatch(html,/data-details-key="search-details" open/);
});
test('escapes HTML in tool labels and server names',()=>{
  const html=renderRankedReport(main({serverName:'<img src=x onerror=1>'}),helpers);
  assert.doesNotMatch(html,/<img/);
  assert.match(html,/&lt;img/);
});
