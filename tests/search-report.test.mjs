import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSearchReport} from '../public/search-report.js';

const tool=(name,serverName='Open OSINT')=>({name,serverName,serverId:serverName.toLowerCase().replace(/\s+/g,'-'),description:`${name} description`});
const plan=['get_whois','get_bgp','get_greynoise'].map((name,index)=>({tool:tool(name),score:10,reason:`Matches ${name}`,args:{query:`value-${index}`},startedAt:`2026-11-11T12:00:0${index}.000Z`}));
const base={query:'8.8.8.8',intent:{id:'network',label:'IP and network intelligence'},plan,links:[],
  categoryForTool:item=>`Category ${item.name}`,sourceLabel:name=>name.replace(/^get_/,'')};
const done=(index,kind,extra={})=>({status:'fulfilled',value:{tool:plan[index].tool,outcome:{kind,...extra}},finishedAt:`2026-11-11T12:00:1${index}.000Z`});
const parse=built=>JSON.parse(built.result.content[0].text);

test('before any source answers, shows the source log and every source still running',()=>{
  const built=buildSearchReport({...base,outcomes:[]});
  const payload=parse(built);
  assert.deepEqual(Object.keys(payload.data.report),['Sources','Still Running']);
  assert.deepEqual(payload.data.report.Sources.data.sources.map(item=>item.outcome.kind),['running','running','running']);
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
  const built=buildSearchReport({...base,outcomes:[done(0,'error',{error:'RDAP IP HTTP 403'}),done(1,'empty'),{status:'rejected',reason:new Error('timeout'),finishedAt:'2026-11-11T12:00:12.000Z'}]});
  const payload=parse(built);
  assert.deepEqual(payload.data.errors.map(item=>item.error),['RDAP IP HTTP 403','No matching records returned for this subject.','timeout']);
  assert.deepEqual(payload.data.report.Sources.data.sources.map(item=>item.outcome.kind),['error','empty','error']);
  assert.equal(payload.data.report.Sources.data.sources[2].outcome.error,'timeout');
  assert.equal(payload.data.modulesWithResults,0);
});

test('when every source has answered, keeps findings followed by their source log',()=>{
  const built=buildSearchReport({...base,outcomes:[done(0,'data',{data:{a:1}}),done(1,'data',{data:{b:2}}),done(2,'empty')],elapsedMs:4200});
  const payload=parse(built);
  assert.equal(built.finished,true);
  assert.ok(!('Still Running' in payload.data.report));
  assert.deepEqual(Object.keys(payload.data.report),['Category get_whois','Category get_bgp','Sources']);
  assert.equal(payload.description,'IP and network intelligence for “8.8.8.8”');
  assert.equal(payload.data.modulesQueried,3);
  assert.equal(payload.data.modulesWithResults,2);
  assert.equal(payload.data.durationMs,4200);
  assert.deepEqual([...built.servers],['Open OSINT']);
});

test('records exact arguments, planner reason, tier, timing and outcome for every source',()=>{
  const built=buildSearchReport({...base,outcomes:[done(0,'data',{data:{a:1}}),done(1,'empty'),done(2,'error',{error:'unavailable'})]});
  const sources=parse(built).data.report.Sources.data.sources;
  assert.deepEqual(sources[0].arguments,{query:'value-0'});
  assert.equal(sources[0].reason,'Matches get_whois');
  assert.deepEqual(sources[0].tier,{level:0,key:'passive',label:'Passive',targetSees:'Nothing: it asks public databases and third parties.'});
  assert.equal(sources[0].startedAt,'2026-11-11T12:00:00.000Z');
  assert.equal(sources[0].finishedAt,'2026-11-11T12:00:10.000Z');
  assert.deepEqual(sources.map(item=>item.outcome.kind),['data','empty','error']);
  assert.deepEqual(built.sourceLog,sources);
});

test('gives two sources in the same category separate sections',()=>{
  const built=buildSearchReport({...base,categoryForTool:()=>'Network',outcomes:[done(0,'data',{data:{a:1}}),done(1,'data',{data:{b:2}}),done(2,'data',{data:{c:3}})]});
  assert.deepEqual(Object.keys(parse(built).data.report).filter(key=>key.startsWith('Network')),['Network','Network — bgp','Network — greynoise']);
});

test('merges duplicate indicator lists once and names every contributing source',()=>{
  const built=buildSearchReport({...base,outcomes:[
    done(0,'data',{data:{hostnames:['api.example.com','www.example.com'],total:2}}),
    done(1,'data',{data:{hosts:['API.EXAMPLE.COM:1.2.3.4'],emails:['user@example.com']}}),
    done(2,'data',{data:{subdomains:['api.example.com'],records:[{domain:'api.example.com',detail:'kept'}]}})
  ]});
  const report=parse(built).data.report;
  assert.equal(Object.keys(report)[0],'Consolidated Findings');
  assert.deepEqual(report['Consolidated Findings'].data.domains.find(item=>item.title.toLowerCase()==='api.example.com'),{
    title:'api.example.com',foundBy:'Open OSINT · whois; Open OSINT · bgp; Open OSINT · greynoise',sourceCount:3
  });
  assert.ok(!('hostnames' in report['Category get_whois'].data));
  assert.equal(report['Category get_whois'].data.total,2);
  assert.deepEqual(report['Category get_greynoise'].data.records,[{domain:'api.example.com',detail:'kept'}]);
  assert.equal(parse(built).data.modulesWithResults,3);
});

test('keeps related links and leaves diagnostics out of ordinary search results',()=>{
  const built=buildSearchReport({...base,links:[{title:'x',url:'https://example.com'}],outcomes:[done(0,'data',{data:{a:1}}),done(1,'empty'),done(2,'empty')]});
  const payload=parse(built);
  assert.ok(!('Planner Diagnostics' in payload.data.report));
  assert.ok('Related Links' in payload.data.report);
  assert.equal(payload.data.modulesWithResults,1);
});

test('adds planner diagnostics only when development mode supplies them',()=>{
  const built=buildSearchReport({...base,diagnostics:{target:'ip'},outcomes:[done(0,'data',{data:{a:1}}),done(1,'empty'),done(2,'empty')]});
  const payload=parse(built);
  assert.deepEqual(payload.data.report['Planner Diagnostics'].data,{target:'ip'});
  assert.equal(payload.data.modulesWithResults,1);
});

test('explains when no connected server can answer',()=>{
  const payload=parse(buildSearchReport({...base,plan:[],outcomes:[]}));
  assert.match(payload.data.errors[0].error,/No connected server/);
  assert.ok(!('Still Running' in payload.data.report));
});

// The result view shows source errors only when a search found nothing; provenance, diagnostics and links are not findings.
test('sources, diagnostics, related links and the still-running list do not count as findings', async () => {
  const { reportHasFindings } = await import('../public/search-report.js');
  assert.equal(reportHasFindings({ Sources: {}, 'Planner Diagnostics': {}, 'Related Links': {} }), false);
  assert.equal(reportHasFindings({ 'Still Running': {} }), false);
  assert.equal(reportHasFindings({ 'Registration Data': {}, 'Related Links': {} }), true);
});

test('adds a ranking and leaves every existing field as it was',()=>{
  const outcomes=[done(0,'data',{data:{records:[{name:'other'}]}}),done(1,'data',{data:{records:[{name:'8.8.8.8 route'}]}}),done(2,'empty')];
  const before=parse(buildSearchReport({...base,outcomes}));
  const after=parse(buildSearchReport({...base,outcomes,subject:'8.8.8.8',preferredNames:['get_bgp']}));
  const {ranking,...rest}=after.data;
  assert.deepEqual(rest,(({ranking,...r})=>r)(before.data));
  assert.deepEqual(ranking.sections.map(s=>s.toolName),['get_bgp','get_whois']);
  assert.equal(ranking.topResults[0].server,'Open OSINT');
});
test('sections reorder as later answers arrive',()=>{
  const first=parse(buildSearchReport({...base,subject:'8.8.8.8',outcomes:[done(0,'data',{data:{records:[{name:'8.8 x'}]}})]}));
  assert.deepEqual(first.data.ranking.sections.map(s=>s.toolName),['get_whois']);
  const later=parse(buildSearchReport({...base,subject:'8.8.8.8',outcomes:[done(0,'data',{data:{records:[{name:'8.8 x'}]}}),done(1,'data',{data:{records:[{name:'8.8.8.8'}]}})]}));
  assert.deepEqual(later.data.ranking.sections.map(s=>s.toolName),['get_bgp','get_whois']);
});
test('passes target to the ranking',()=>{
  const outcomes=[done(0,'data',{data:{records:[{name:'unrelated'}]}}),done(1,'data',{data:{peers:[{name:'8.8.4.4 resolver'}]}}),done(2,'empty')];
  const ranked=target=>parse(buildSearchReport({...base,outcomes,subject:'8.8.8.8',preferredNames:['get_whois'],target})).data.ranking;
  const on=ranked(true);
  assert.deepEqual(on.sections.find(s=>s.toolName==='get_whois').matching,[{name:'unrelated'}]);
  assert.deepEqual(on.sections.find(s=>s.toolName==='get_bgp').matching,[]);
  assert.deepEqual(ranked(undefined).sections.find(s=>s.toolName==='get_bgp').matching,[{name:'8.8.4.4 resolver'}]);
});
