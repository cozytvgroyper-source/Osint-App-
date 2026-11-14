import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPassiveResults,renderPassiveHandOff} from '../public/passive-results-view.js';
import {escapeHtml,safeHttpUrl} from '../public/ui.js';

const helpers={escapeHtml,safeHttpUrl,renderRecord:o=>'<dl>'+escapeHtml(JSON.stringify(o))+'</dl>',renderArray:l=>'<ul>'+escapeHtml(JSON.stringify(l))+'</ul>'};
const empty=()=>({query:'Owner Example',subject:'Owner Example',event:false,identity:{best:null,others:[]},news:[],data:[],records:[],hidden:{news:[],records:[]},failed:[],pending:[]});
const news=(key,title,date,tier=4,extra={})=>({key,title,link:`https://news.example/${key}`,date,source:'news.example',snippet:'',tier,tool:'get_news',item:{},...extra});
const full=()=>({
  ...empty(),
  identity:{best:{id:'Q1',label:'Owner Example',description:'Example person',aliases:[],wikiUrl:'https://wiki.example/Q1',facts:{instanceOf:'human'},key:'identity:get_wikidata:0',tier:5},
    others:[{id:'Q2',label:'Owner Example Jr',description:'Another one',aliases:[],wikiUrl:'https://wiki.example/Q2',facts:{},key:'identity:get_wikidata:1',tier:3}]},
  news:[news('news:a:0','Old story','2026-01-01T00:00:00.000Z',5),news('news:a:1','New story','2026-06-01T00:00:00.000Z',3)],
  data:[{key:'group:data:get_x:2',tool:'get_x',label:'Example data',items:[{key:'data:get_x:0',tier:3,item:{a:1}}],hidden:[{key:'data:get_x:1',tier:0,item:{b:2}}],hiddenCount:1}],
  records:[{key:'records:get_sec:0',title:'Example Corp filing',detail:'10-K · 2026',link:'https://news.example/r',tier:4,tool:'get_sec_filings',item:{}}],
  hidden:{news:[news('news:a:2','Unrelated','2026-02-01T00:00:00.000Z',0)],records:[{key:'records:get_sec:1',title:'Other filing',detail:'',link:'',tier:0,tool:'get_sec_filings',item:{}}]},
  failed:[{label:'Offshore Leaks',error:'timed out'}],pending:['Court records']
});
const render=(r,o={})=>renderPassiveResults(r,{sort:'newest',savedKeys:new Set(),...helpers,...o});

test('groups appear in order and empty ones are left out',()=>{
  const html=render(full());
  const heads=[...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map(m=>m[1]);
  assert.deepEqual(heads.slice(0,3),['Who or what this is','News','Related data']);
  assert.ok(heads.includes('Records'));
  assert.ok(heads.indexOf('Records')>heads.indexOf('Related data'));
  const sparse=render({...empty(),news:[news('news:a:0','Only story',null)]});
  assert.match(sparse,/<h3>News<\/h3>/);
  assert.doesNotMatch(sparse,/Who or what this is|Related data|<h3>Records/);
});

test('the identity card shows the best match and lists others',()=>{
  const html=render(full());
  assert.match(html,/Owner Example<\/a>|Owner Example</);
  assert.match(html,/Example person/);
  assert.match(html,/<h4>Other people or things with this name<\/h4>/);
  assert.match(html,/Owner Example Jr/);
  assert.match(html,/instanceOf/);
});

test('news shows date, source and a linked title, sorted as asked',()=>{
  const r=full();
  const newest=render(r,{sort:'newest'});
  assert.match(newest,/<select id="newsSort" aria-label="Sort news">/);
  assert.match(newest,/<option value="newest" selected>Newest first<\/option>/);
  assert.match(newest,/<option value="relevant">Most relevant<\/option>/);
  assert.match(newest,/<time datetime="2026-06-01T00:00:00.000Z">/);
  assert.match(newest,/news\.example/);
  assert.match(newest,/<a href="https:\/\/news\.example\/news:a:1" target="_blank" rel="noopener noreferrer">New story<\/a>/);
  assert.ok(newest.indexOf('New story')<newest.indexOf('Old story'));
  const relevant=render(r,{sort:'relevant'});
  assert.match(relevant,/<option value="relevant" selected>Most relevant<\/option>/);
  assert.ok(relevant.indexOf('Old story')<relevant.indexOf('New story'));
});

test('every result has its own named Save to case button, and saved ones are marked',()=>{
  const r=full();
  const html=render(r,{savedKeys:new Set(['news:a:0'])});
  const keys=['identity:get_wikidata:0','identity:get_wikidata:1','news:a:0','news:a:1','news:a:2','data:get_x:0','data:get_x:1','records:get_sec:0','records:get_sec:1'];
  for(const key of keys)assert.match(html,new RegExp(`data-save-result="${key}"`),key);
  assert.doesNotMatch(html,/data-save-result="group:/);
  assert.match(html,/<button class="save-result" data-save-result="news:a:1" aria-label="Save to case: New story">Save to case<\/button>/);
  assert.match(html,/<button class="save-result" data-save-result="news:a:0" aria-label="Save to case: Old story" disabled>Saved<\/button>/);
  assert.match(html,/<details class="more-results"><summary>Show 1 more that don't mention your search<\/summary>/);
  assert.equal((html.match(/more-results/g)||[]).length,3);
  assert.match(html,/<details class="search-details">/);
  assert.match(html,/Offshore Leaks[^<]*timed out|timed out/);
  assert.match(html,/Court records/);
});

test('hostile titles are escaped and unsafe links are not links',()=>{
  const r=empty();
  r.news=[news('news:a:0','<img src=x onerror=alert(1)>','2026-01-01T00:00:00.000Z',4,{link:'javascript:alert(1)',source:'<b>s</b>'})];
  r.records=[{key:'records:t:0',title:'"><script>x</script>',detail:'<i>d</i>',link:'data:text/html,hi',tier:3,tool:'t',item:{}}];
  const html=render(r);
  assert.doesNotMatch(html,/<img|<script|<b>|<i>|javascript:|data:text/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html,/<a [^>]*>&lt;img/);
  assert.match(html,/aria-label="Save to case: &lt;img/);
});

test('headings stay in order: h3 inside the dialog',()=>{
  const html=render(full());
  assert.doesNotMatch(html,/<h1|<h2/);
  const levels=[...html.matchAll(/<h([1-6])/g)].map(m=>+m[1]);
  assert.ok(levels.length>0);
  let last=2;
  for(const l of levels){assert.ok(l<=last+1,`jump to h${l} after h${last}`);last=l;}
  assert.ok(levels.every(l=>l>=3));
});

test('the hand-off names the kind and offers Deep Search',()=>{
  const html=renderPassiveHandOff({label:'domain',value:'example.com'},helpers);
  assert.match(html,/domain/);
  assert.match(html,/<button class="primary" data-open-deep-search="example\.com">Open in Deep Search<\/button>/);
  assert.match(renderPassiveHandOff({label:'x',value:'"><b>'}),/data-open-deep-search="&quot;&gt;&lt;b&gt;"/);
});
