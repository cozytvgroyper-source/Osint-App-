import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {passiveQuery,passiveSources,addCompanySources} from '../public/passive-search.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/mcp-tools.json',import.meta.url),'utf8'));
const byName=new Map(fixture.map(tool=>[tool.name,tool]));
const toolsNamed=names=>names.map(name=>({...byName.get(name),serverId:'osint-local',serverName:byName.get(name).serverName||'Open OSINT'}));
const ALL=['get_wikidata','get_news_rss','get_gdelt','get_opensanctions','get_offshore_leaks','get_opencorporates','get_sec_filings','get_sanctions','get_hn_search','get_earthquakes','get_natural_events','get_disaster_alerts','get_news_velocity'];
const summary=sources=>sources.map(({tool,group})=>`${group}:${tool.name}`);

test('targets are handed to Deep Search with their kind',()=>{
  const cases=[['owner-site.example','website'],['8.8.8.8','IP address'],['@ownername','username'],['owner@example.com','email address'],['+15555550100','phone number'],['CVE-2024-3094','vulnerability ID'],['d41d8cd98f00b204e9800998ecf8427e','file hash']];
  for(const [query,label] of cases){
    const info=passiveQuery(query);
    assert.equal(info.kind,'target',query);
    assert.equal(info.label,label,query);
    assert.ok(info.target.type&&info.target.value);
  }
});

test('a name runs identity, news and records, and never Hacker News',()=>{
  const info=passiveQuery('Owner Example');
  assert.equal(info.kind,'search');
  assert.equal(info.subject,'Owner Example');
  assert.equal(info.event,false);
  assert.equal(info.company,false);
  const sources=passiveSources(info,toolsNamed(ALL));
  assert.deepEqual(summary(sources),['identity:get_wikidata','news:get_news_rss','news:get_gdelt','records:get_opensanctions','records:get_offshore_leaks']);
  assert.equal(sources.find(s=>s.tool.name==='get_news_rss').args && Object.keys(sources.find(s=>s.tool.name==='get_news_rss').args).length,0);
  assert.equal(sources.find(s=>s.tool.name==='get_wikidata').args.query,'Owner Example');
});

test('a company adds company registers and filings',()=>{
  for(const query of ['Example Corp','Example company']){
    const info=passiveQuery(query);
    assert.equal(info.company,true,query);
    const names=passiveSources(info,toolsNamed(ALL)).map(s=>s.tool.name);
    assert.ok(names.includes('get_opencorporates')&&names.includes('get_sec_filings'),query);
  }
  assert.equal(passiveQuery('Example Inc.').company,true);
  assert.equal(passiveQuery('Example GmbH').company,true);
});

test('a topic word keeps the subject lookup and adds its own sources',()=>{
  const sanctions=passiveQuery('Owner Example sanctions');
  assert.equal(sanctions.subject,'Owner Example');
  const records=passiveSources(sanctions,toolsNamed(ALL)).filter(s=>s.group==='records').map(s=>s.tool.name);
  assert.ok(records.includes('get_sanctions'));
  assert.equal(new Set(records).size,records.length);
  const quake=passiveQuery('earthquakes in Example City');
  assert.equal(quake.event,true);
  const sources=passiveSources(quake,toolsNamed(ALL));
  assert.ok(sources.some(s=>s.group==='data'&&s.tool.name==='get_earthquakes'));
  assert.equal(passiveQuery('Owner Example sanctions').event,false);
});

test('a topic-only query runs no identity lookup',()=>{
  const info=passiveQuery('latest news');
  assert.equal(info.event,true);
  const sources=passiveSources(info,toolsNamed(ALL));
  assert.ok(sources.length>0);
  assert.ok(!sources.some(s=>s.group==='identity'||s.group==='records'));
});

test('only passive, connected tools run',()=>{
  const info=passiveQuery('Owner Example');
  const withoutGdelt=toolsNamed(ALL.filter(name=>name!=='get_gdelt'));
  assert.ok(!passiveSources(info,withoutGdelt).some(s=>s.tool.name==='get_gdelt'));
  const active=toolsNamed(ALL).map(tool=>tool.name==='get_gdelt'?{...tool,annotations:{readOnlyHint:false}}:tool);
  assert.ok(!passiveSources(info,active).some(s=>s.tool.name==='get_gdelt'));
});

test('a Wikidata organisation adds the company sources once',()=>{
  const info=passiveQuery('Owner Example');
  const tools=toolsNamed(ALL);
  const org={facts:{instanceOf:['wd:Q4830453']}};
  const extra=addCompanySources(info,tools,org);
  assert.deepEqual(extra.map(s=>s.tool.name).sort(),['get_opencorporates','get_sec_filings']);
  assert.ok(extra.every(s=>s.group==='records'&&s.args.query==='Owner Example'));
  assert.deepEqual(addCompanySources(info,tools,{facts:{instanceOf:['wd:Q5']}}),[]);
  assert.deepEqual(addCompanySources(passiveQuery('Example Corp'),tools,org),[]);
  for(const id of ['wd:Q43229','wd:Q783794','wd:Q6881511'])assert.equal(addCompanySources(info,tools,{facts:{instanceOf:[id]}}).length,2);
});
