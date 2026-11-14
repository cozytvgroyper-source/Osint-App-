import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {passiveTier,buildPassiveResults,sortNews} from '../public/passive-results.js';

const load=name=>JSON.parse(readFileSync(new URL(`./fixtures/passive/${name}.json`,import.meta.url),'utf8'));
const tool=name=>({name,serverName:'Open OSINT',serverId:'osint-local'});
const src=(name,group)=>({tool:tool(name),group,args:{}});
const ok=(name,payload,envelope=true)=>({status:'fulfilled',value:{tool:tool(name),outcome:{kind:'data',data:envelope?{data:payload,durationMs:5,cached:false}:payload}}});
const empty=name=>({status:'fulfilled',value:{tool:tool(name),outcome:{kind:'empty'}}});
const rejected=reason=>({status:'rejected',reason:new Error(reason)});

const SOURCES=[src('get_wikidata','identity'),src('get_news_rss','news'),src('get_gdelt','news'),src('get_opensanctions','records'),src('get_offshore_leaks','records')];
const run=(outcomes,extra={})=>buildPassiveResults({query:'Owner Example',subject:'Owner Example',event:false,sources:SOURCES,outcomes,...extra});
const FULL=()=>[ok('get_wikidata',load('wikidata')),ok('get_news_rss',load('news-rss')),ok('get_gdelt',load('gdelt')),ok('get_opensanctions',load('opensanctions')),ok('get_offshore_leaks',load('offshore-leaks'),false)];

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
  const withRecords=run(FULL());
  assert.ok(withRecords.records.some(x=>x.tier===0)||withRecords.records.length>=1);
  assert.ok(withRecords.news.some(n=>n.tier===0&&n.title==='Weather roundup'));
});

test('a bare payload works as well as an envelope',()=>{
  const r=run([ok('get_wikidata',load('wikidata'),false),undefined,undefined,undefined,undefined]);
  assert.equal(r.identity.best.label,'Owner Example');
});
