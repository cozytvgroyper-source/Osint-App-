import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {passiveTier,buildPassiveResults,sortNews} from '../public/passive-results.js';

const load=name=>JSON.parse(readFileSync(new URL(`./fixtures/passive/${name}.json`,import.meta.url),'utf8'));
const tool=name=>({name,serverName:'Open OSINT',serverId:'osint-local'});
const src=(name,group)=>({tool:tool(name),group,args:{}});
const ok=(name,payload,envelope=false)=>({status:'fulfilled',value:{tool:tool(name),outcome:{kind:'data',data:envelope?{data:payload,durationMs:5,cached:false}:payload}}});
const empty=name=>({status:'fulfilled',value:{tool:tool(name),outcome:{kind:'empty'}}});
const rejected=reason=>({status:'rejected',reason:new Error(reason)});

const SOURCES=[src('get_wikidata','identity'),src('get_news_rss','news'),src('get_gdelt','news'),src('get_opensanctions','records'),src('get_offshore_leaks','records')];
const run=(outcomes,extra={})=>buildPassiveResults({query:'Owner Example',subject:'Owner Example',event:false,sources:SOURCES,outcomes,...extra});
const FULL=()=>[ok('get_wikidata',load('wikidata')),ok('get_news_rss',load('news-rss')),ok('get_gdelt',load('gdelt')),ok('get_opensanctions',load('opensanctions')),ok('get_offshore_leaks',load('offshore-leaks'))];

test('tiers run from exact name to nothing',()=>{
  assert.equal(passiveTier({label:'Owner Example'},'owner example'),5);
  assert.equal(passiveTier({title:'Owner Example opens office'},'Owner Example'),4);
  assert.equal(passiveTier({title:'Office',description:'run by Owner Example'},'Owner Example'),3);
  assert.equal(passiveTier({title:'Example news',text:'Owner spoke'},'Owner Example'),2);
  assert.equal(passiveTier({title:'Example news'},'Owner Example'),1);
  assert.equal(passiveTier({title:'Weather'},'Owner Example'),0);
  assert.equal(passiveTier({title:'Weather'},''),3);
});

test('the exact name wins over a description that mentions it',()=>{
  const r=run(FULL());
  assert.equal(r.identity.best.label,'Owner Example');
  assert.deepEqual(r.identity.others.map(e=>e.label),['Owner Example Jr.','Example Corp']);
});

test('aliases and initials match',()=>{
  assert.equal(passiveTier({label:'Owner Example',aliases:['O. E. Example']},'OE Example'),5);
  assert.equal(passiveTier({title:'oe unit'},'OE Example'),1);
});

test('every result appears once',()=>{
  const r=run(FULL());
  const links=r.news.map(n=>n.link);
  assert.equal(new Set(links).size,links.length);
  assert.equal(links.filter(l=>l==='https://news.example/a').length,1);
  // GDELT's re-worded copy of the same headline is dropped by title.
  assert.ok(!links.includes('https://dupe.example/c'));
  // The failed feed (error, empty title) is skipped.
  assert.ok(r.news.every(n=>n.title));
});

test('news items carry date, source and a stable key',()=>{
  const r=run(FULL());
  const gd=r.news.find(n=>n.link==='https://other.example/b');
  assert.equal(gd.date,'2026-11-14T09:00:00.000Z');
  assert.equal(gd.source,'other.example');
  assert.equal(gd.tool,'get_gdelt');
  assert.match(gd.key,/^news:get_gdelt:\d+$/);
  assert.equal(JSON.stringify(run(FULL()).news.map(n=>n.key)),JSON.stringify(r.news.map(n=>n.key)));
});

test('undated news sorts last under newest first',()=>{
  const r=run(FULL());
  const sorted=sortNews(r.news,'newest');
  const dates=sorted.map(n=>n.date);
  const firstUndated=dates.indexOf(null);
  assert.ok(firstUndated>0);
  assert.ok(dates.slice(firstUndated).every(d=>d===null));
  assert.ok(Date.parse(dates[0])>=Date.parse(dates[1]));
  assert.notEqual(sorted,r.news);
});

test('sortNews does not mutate its input',()=>{
  const r=run(FULL());
  const before=r.news.map(n=>n.key);
  sortNews(r.news,'newest');sortNews(r.news,'relevant');
  assert.deepEqual(r.news.map(n=>n.key),before);
});

test('relevant order puts the subject first',()=>{
  const r=run(FULL());
  const sorted=sortNews(r.news,'relevant');
  assert.ok(sorted[0].title.toLowerCase().includes('owner example'));
  const tiers=sorted.map(n=>n.tier);
  assert.deepEqual(tiers,[...tiers].sort((a,b)=>b-a));
});

test('a failed source leaves the other groups intact',()=>{
  const outcomes=FULL();
  outcomes[2]=rejected('gdelt down');
  outcomes[3]=empty('get_opensanctions');
  const r=run(outcomes);
  assert.equal(r.failed.length,2);
  assert.ok(r.failed.some(f=>f.label.includes('get_gdelt')&&/gdelt down/.test(f.error)));
  assert.ok(r.failed.some(f=>f.label.includes('get_opensanctions')));
  assert.ok(r.news.length>=2);
  assert.ok(r.identity.best);
});

test('sources still running are listed as pending',()=>{
  const r=run([ok('get_wikidata',load('wikidata')),undefined,undefined,undefined,undefined]);
  assert.equal(r.pending.length,4);
  assert.ok(r.identity.best);
});

test('sanctions records say where the name appears',()=>{
  const r=run(FULL());
  const rec=r.records.find(x=>x.title==='Owner Example');
  assert.equal(rec.detail,'Appears in example_list — check before relying on it');
  assert.equal(rec.tier,5);
  assert.equal(rec.tool,'get_opensanctions');
  assert.match(rec.key,/^records:get_opensanctions:0$/);
});

test('SEC filings and company records get their own title and detail',()=>{
  const sources=[src('get_sec_filings','records'),src('get_opencorporates','records')];
  const r=buildPassiveResults({query:'Example Corp',subject:'Example Corp',event:false,sources,outcomes:[ok('get_sec_filings',load('sec-filings')),ok('get_opencorporates',{results:{companies:[{name:'Example Corp',jurisdiction:'us',status:'Active',opencorporates_url:'https://oc.example/1'}]}})]});
  const sec=r.records.find(x=>x.tool==='get_sec_filings');
  assert.equal(sec.title,'Example Corp');
  assert.equal(sec.detail,'10-K · 2026-02-01');
  const oc=r.records.find(x=>x.tool==='get_opencorporates');
  assert.equal(oc.detail,'us · Active');
  assert.equal(oc.link,'https://oc.example/1');
});

test('items that don\'t mention the subject are hidden, not dropped',()=>{
  const sources=[src('get_earthquakes','data')];
  const r=buildPassiveResults({query:'Example City',subject:'Example City',event:true,sources,outcomes:[ok('get_earthquakes',load('earthquakes'))]});
  assert.equal(r.data.length,1);
  assert.equal(r.data[0].items.length,1);
  assert.equal(r.data[0].hidden.length,1);
  assert.equal(r.data[0].hiddenCount,1);
  assert.equal(r.data[0].tool,'get_earthquakes');
  const full=run(FULL());
  assert.deepEqual(full.hidden.news.map(n=>n.title),['Weather roundup']);
  assert.deepEqual(full.hidden.records.map(x=>x.title),['Unrelated Person']);
  assert.ok(full.news.every(n=>n.tier>=1));
  assert.ok(full.records.every(x=>x.tier>=1));
  assert.equal(full.records.length,1);
});

test('a bare payload works as well as an envelope',()=>{
  const r=run([ok('get_wikidata',load('wikidata'),true),undefined,undefined,undefined,undefined]);
  assert.equal(r.identity.best.label,'Owner Example');
});

test('a nested data key does not hide the payload\'s own list',()=>{
  const sources=[src('get_earthquakes','data')];
  const payload={earthquakes:load('earthquakes').earthquakes,data:{meta:'x'}};
  const r=buildPassiveResults({query:'Example City',subject:'Example City',event:true,sources,outcomes:[ok('get_earthquakes',payload)]});
  assert.equal(r.data[0].items.length+r.data[0].hidden.length,2);
});

test('data items each have a unique, stable key, hidden ones too',()=>{
  const sources=[src('get_earthquakes','data')];
  const r=buildPassiveResults({query:'Example City',subject:'Example City',event:true,sources,outcomes:[ok('get_earthquakes',load('earthquakes'))]});
  const [shown]=r.data[0].items,[hid]=r.data[0].hidden;
  assert.equal(shown.key,'data:get_earthquakes:0');
  assert.equal(hid.key,'data:get_earthquakes:1');
  assert.ok(shown.item.place&&shown.tier>0&&hid.tier===0);
});

test('a subject matches whole words, not parts of words',()=>{
  const ents=[{id:'1',label:'Fordham University',description:'university'},{id:'2',label:'Ford Motor Company',description:'carmaker'}];
  const r=buildPassiveResults({query:'Ford',subject:'Ford',event:false,sources:[src('get_wikidata','identity')],outcomes:[ok('get_wikidata',{entities:ents})]});
  assert.equal(r.identity.best.label,'Ford Motor Company');
  assert.ok(!r.identity.others.some(e=>e.label==='Fordham University'&&e.tier>=3));
  assert.equal(passiveTier({title:'He said so'},'AI'),0);
  assert.equal(passiveTier({title:'AI rules'},'AI'),4);
});

test('initials ignore dots and spacing in titles too',()=>{
  assert.equal(passiveTier({title:'JD Vance speaks'},'J. D. Vance'),4);
  assert.equal(passiveTier({title:'J. D. Vance speaks'},'JD Vance'),4);
  assert.equal(passiveTier({description:'says JD Vance'},'J. D. Vance'),3);
});

test('wrapped OpenCorporates results are read',()=>{
  const payload={results:{companies:[{company:{name:'Example Corp',jurisdiction_code:'us_xx',current_status:'Active',opencorporates_url:'https://oc.example/2'}}]}};
  const r=buildPassiveResults({query:'Example Corp',subject:'Example Corp',event:false,sources:[src('get_opencorporates','records')],outcomes:[ok('get_opencorporates',payload)]});
  assert.equal(r.records[0].title,'Example Corp');
  assert.equal(r.records[0].detail,'us_xx · Active');
  assert.equal(r.records[0].link,'https://oc.example/2');
  assert.equal(r.records[0].tier,5);
});

test('a dataset name does not make a record match',()=>{
  const payload={entities:[{id:'x',name:'Unrelated Name',dataset:'example_list'}]};
  const r=buildPassiveResults({query:'Example',subject:'Example',event:false,sources:[src('get_opensanctions','records')],outcomes:[ok('get_opensanctions',payload)]});
  assert.equal(passiveTier(payload.entities[0],'Example'),0);
  assert.equal(r.records.length,0);
  assert.equal(r.hidden.records.length,1);
  assert.equal(r.hidden.records[0].detail,'Appears in example_list — check before relying on it');
});

test('group keys and item keys never overlap',()=>{
  const sources=[src('get_earthquakes','data')];
  const r=buildPassiveResults({query:'Example City',subject:'Example City',event:true,sources,outcomes:[ok('get_earthquakes',load('earthquakes'))]});
  const g=r.data[0];
  const keys=[g.key,...g.items.map(i=>i.key),...g.hidden.map(i=>i.key)];
  assert.equal(new Set(keys).size,keys.length);
  assert.match(g.key,/^group:data:get_earthquakes:0$/);
});

test('a lone letter does not glue onto initials',()=>{
  assert.equal(passiveTier({title:'Meet a J. D. Vance supporter'},'JD Vance'),4);
  assert.equal(passiveTier({title:'x',description:'J. D. Vance'},'JD Vance'),3);
  assert.equal(passiveTier({title:'Meet a J. D. Vance supporter'},'Vance JD'),2);
});

test('a duplicate keeps the copy with the higher tier',()=>{
  const sources=[src('get_news_rss','news'),src('get_gdelt','news')];
  const rss={items:[{title:'Headline',link:'https://news.example/same',pubDate:'Thu, 13 Nov 2026 10:15:00 GMT'}]};
  const gd={articles:[{url:'https://news.example/same',title:'Owner Example headline',seendate:'20261113T101500Z'}]};
  const r=buildPassiveResults({query:'Owner Example',subject:'Owner Example',event:false,sources,outcomes:[ok('get_news_rss',rss),ok('get_gdelt',gd)]});
  assert.equal(r.news.length,1);
  assert.equal(r.news[0].tier,4);
  assert.equal(r.hidden.news.length,0);
});

const newsRun=(items,subject='Owner Example')=>buildPassiveResults({query:subject,subject,event:false,sources:[src('get_news_rss','news')],outcomes:[ok('get_news_rss',{items})]});

test('news without a link is shown, and linkless duplicates collapse',()=>{
  const one=newsRun([{title:'Owner Example speaks',link:'',pubDate:''}]);
  assert.equal(one.news.length,1);
  const two=newsRun([{title:'Owner Example speaks',link:''},{title:'owner  example SPEAKS',link:''}]);
  assert.equal(two.news.length,1);
});

test('a replacement copy registers its own link and title',()=>{
  const r=newsRun([
    {title:'Headline',link:'https://news.example/one'},
    {title:'Owner Example headline',link:'https://news.example/one'},
    {title:'Other words',link:'https://news.example/one'},
    {title:'Owner Example headline',link:'https://news.example/two'},
  ]);
  assert.equal(r.news.length,1);
  assert.equal(r.news[0].tier,4);
});

test('a later item sharing only the replacement link is caught',()=>{
  const r=newsRun([
    {title:'Headline Owner',link:'https://news.example/one'},
    {title:'Headline Owner',link:'https://news.example/two',description:'Owner Example'},
    {title:'Different title entirely',link:'https://news.example/two'},
  ]);
  assert.equal(r.news.length+r.hidden.news.length,1);
});
