import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSearchReport} from '../public/search-report.js';

const tool=(name,serverName='Open OSINT')=>({name,serverName,serverId:serverName.toLowerCase().replace(/\s+/g,'-'),description:`${name} description`});
const plan=['get_whois','get_bgp','get_greynoise'].map(name=>({tool:tool(name),score:10,reason:'Matches'}));
const base={query:'8.8.8.8',intent:{id:'network',label:'IP and network intelligence'},plan,links:[],
  categoryForTool:item=>`Category ${item.name}`,sourceLabel:name=>name.replace(/^get_/,'')};
const done=(index,kind,extra={})=>({status:'fulfilled',value:{tool:plan[index].tool,outcome:{kind,...extra}}});
const parse=built=>JSON.parse(built.result.content[0].text);

test('before any source answers, shows the plan and every source as still running',()=>{
  const built=buildSearchReport({...base,outcomes:[]});
  const payload=parse(built);
  assert.deepEqual(Object.keys(payload.data.report),['Search Plan','Still Running']);
  assert.deepEqual(payload.data.report['Still Running'].data.sources.map(item=>item.name),['whois','bgp','greynoise']);
  assert.match(payload.description,/0 of 3 sources answered/);
  assert.equal(built.finished,false);
});

test('adds each answer as it arrives and keeps waiting for the rest',()=>{
  const built=buildSearchReport({...base,outcomes:[undefined,done(1,'data',{data:{asn:15169}})]});
  const report=parse(built).data.report;
  assert.deepEqual(report['Category get_bgp'].data,{asn:15169});
  assert.deepEqual(report['Still Running'].data.sources.map(item=>item.name),['whois','greynoise']);
  assert.match(parse(built).description,/1 of 3 sources answered/);
});

test('reports errors and empty answers under Unavailable Sources, not as findings',()=>{
  const built=buildSearchReport({...base,outcomes:[done(0,'error',{error:'RDAP IP HTTP 403'}),done(1,'empty'),{status:'rejected',reason:new Error('timeout')}]});
  const payload=parse(built);
  assert.deepEqual(payload.data.errors.map(item=>item.error),['RDAP IP HTTP 403','No matching records returned for this subject.','timeout']);
  assert.equal(payload.data.modulesWithResults,0);
});

test('when every source has answered, drops the running list and shows the final summary',()=>{
  const built=buildSearchReport({...base,outcomes:[done(0,'data',{data:{a:1}}),done(1,'data',{data:{b:2}}),done(2,'empty')],elapsedMs:4200});
  const payload=parse(built);
  assert.equal(built.finished,true);
  assert.ok(!('Still Running' in payload.data.report));
  assert.equal(payload.description,'IP and network intelligence for “8.8.8.8”');
  assert.equal(payload.data.modulesQueried,3);
  assert.equal(payload.data.modulesWithResults,2);
  assert.equal(payload.data.durationMs,4200);
  assert.deepEqual([...built.servers],['Open OSINT']);
});

test('gives two sources in the same category separate sections',()=>{
  const built=buildSearchReport({...base,categoryForTool:()=>'Network',outcomes:[done(0,'data',{data:{a:1}}),done(1,'data',{data:{b:2}}),done(2,'data',{data:{c:3}})]});
  assert.deepEqual(Object.keys(parse(built).data.report).filter(key=>key.startsWith('Network')),['Network','Network — bgp','Network — greynoise']);
});

test('keeps diagnostics and related links, which are not counted as findings',()=>{
  const built=buildSearchReport({...base,diagnostics:{target:'ip'},links:[{title:'x',url:'https://example.com'}],outcomes:[done(0,'data',{data:{a:1}}),done(1,'empty'),done(2,'empty')]});
  const payload=parse(built);
  assert.ok('Planner Diagnostics' in payload.data.report);
  assert.ok('Related Links' in payload.data.report);
  assert.equal(payload.data.modulesWithResults,1);
});

test('explains when no connected server can answer',()=>{
  const payload=parse(buildSearchReport({...base,plan:[],outcomes:[]}));
  assert.match(payload.data.errors[0].error,/No connected server/);
  assert.ok(!('Still Running' in payload.data.report));
});
