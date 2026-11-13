import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSearchReport} from '../public/search-report.js';
import {renderRankedReport} from '../public/search-results-view.js';

const escapeHtml=(value='')=>String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const helpers={escapeHtml,openKeys:null,
  renderArray:items=>`[A:${items.length}]`,
  renderRecord:data=>`[R:${typeof data==='string'?data:JSON.stringify(data)}]`,
  renderBody:data=>`[B:${typeof data==='string'?data:JSON.stringify(data)}]`,
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
  assert.match(html,/OpenSanctions \(via Open OSINT\)/);
  assert.match(html,/<details class="search-details" data-details-key="search-details">/);
  assert.ok(html.indexOf('Top results')<html.indexOf('search-details'));
  assert.match(html,/41 results from 2 tools/);
});
test('folds non-matching items under Show N more',()=>{
  const html=renderRankedReport(main(),helpers);
  assert.match(html,/<details class="more-results" data-details-key="more:get_news_rss"><summary>Show 38 more from News RSS that don&#39;t mention your search<\/summary>/);
});
test('opens Search details and says so when there are no results',()=>{
  const html=renderRankedReport(build({tools:['get_opensanctions','get_news_rss'],outcomes:[{kind:'empty'},{kind:'empty'}]}),helpers);
  assert.match(html,/Nothing found for &#39;Rosneft&#39;\./);
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
// Final review #1: Search details only opens by default once a finished search has no results.
const carriedKeys=html=>new Set([...html.matchAll(/<details\b([^>]*)>/g)].map(([,attrs])=>attrs)
  .filter(attrs=>/\sopen\b/.test(attrs)&&!/\sdata-default-open\b/.test(attrs)&&/data-details-key="/.test(attrs))
  .map(attrs=>attrs.match(/data-details-key="([^"]*)"/)[1]));
test('a running search with no answers yet neither says "No results" nor opens Search details',()=>{
  const running=renderRankedReport(build({tools:['get_opensanctions','get_news_rss'],outcomes:[undefined,undefined]}),helpers);
  assert.doesNotMatch(running,/Nothing found/);
  assert.match(running,/<details class="search-details" data-details-key="search-details">/);
  const finished=renderRankedReport(main(),{...helpers,openKeys:carriedKeys(running)});
  assert.match(finished,/<details class="search-details" data-details-key="search-details">/);
});
test('a finished search with no results opens Search details by default and marks it so',()=>{
  const html=renderRankedReport(build({tools:['get_opensanctions'],outcomes:[{kind:'empty'}]}),helpers);
  assert.match(html,/Nothing found for &#39;Rosneft&#39;\./);
  assert.match(html,/<details class="search-details" data-default-open data-details-key="search-details" open>/);
  assert.equal(carriedKeys(html).size,0);
});
// Final review #2: single records and facts keep their nested objects and lists (renderBody, as renderCategory shows them).
test('a single record renders through renderBody so nested data is kept',()=>{
  const whois={registrar:'Rosneft Registrar',nameservers:['ns1.rosneft.ru'],contact:{org:'Rosneft'}};
  const html=renderRankedReport(build({tools:['get_whois'],outcomes:[{kind:'data',data:whois}]}),helpers);
  assert.ok(html.includes(`[B:${JSON.stringify(whois)}]`));
});
test('facts render through renderBody so nested data is kept',()=>{
  const data={found:['github'],owner:{name:'x'},results:[{name:'Rosneft'}]};
  const html=renderRankedReport(build({tools:['get_opensanctions'],outcomes:[{kind:'data',data}]}),helpers);
  assert.ok(html.includes(`[B:${JSON.stringify({found:['github'],owner:{name:'x'}})}]`));
});
// Final review #5, #9, #10.
test('Search details has its own summary and no inner heading',()=>{
  const html=renderRankedReport(main(),helpers);
  assert.match(html,/data-details-key="search-details"><summary>Search details<\/summary>/);
  assert.doesNotMatch(html,/<h3>Search details/);
});
test('the status line pluralises results and tools',()=>{
  const html=renderRankedReport(build({tools:['get_opensanctions'],outcomes:[{kind:'data',data:{results:[{name:'Rosneft'}]}}]}),helpers);
  assert.match(html,/1 result from 1 tool</);
});
test('the running count is never negative',()=>{
  const data=build({tools:['a','b'],outcomes:[{kind:'data',data:{x:1}}]});
  assert.match(renderRankedReport({...data,modulesQueried:0},helpers),/0 of 0 tools answered…/);
});
test('a string top result keeps its text layout (renderRecord)',()=>{
  const html=renderRankedReport(build({tools:['omega_intel'],outcomes:[{kind:'data',data:'Report\nRosneft owns this'}]}),helpers);
  assert.ok(html.includes('<div class="top-result"><p class="result-source">omega_intel (via Open OSINT)</p>[R:Report\nRosneft owns this]</div>'));
});

// Phase 2 wording: say where a result came from, why items are folded, and what to do when nothing was found.
const emptyData=()=>build({tools:['get_opensanctions','get_news_rss'],outcomes:[{kind:'empty'},{kind:'empty'}]});
test('sources read as "<tool> (via <server>)"',()=>{
  const html=renderRankedReport(main(),helpers);
  assert.match(html,/OpenSanctions \(via Open OSINT\)/);
  assert.doesNotMatch(html,/OpenSanctions · Open OSINT/);
});
test('folded items say why they are folded',()=>{
  assert.match(renderRankedReport(main(),helpers),/<summary>Show 38 more from News RSS that don&#39;t mention your search<\/summary>/);
});
test('no results names the search and points at Search details',()=>{
  const out=renderRankedReport({...emptyData(),query:'<b>Rosneft</b>'},helpers);
  assert.match(out,/Nothing found for &#39;&lt;b&gt;Rosneft&lt;\/b&gt;&#39;\. Try a shorter name, or open Search details to see which sources answered\./);
  assert.match(renderRankedReport({...emptyData(),query:''},helpers),/Nothing found\. Try a shorter name, or open Search details to see which sources answered\./);
});
