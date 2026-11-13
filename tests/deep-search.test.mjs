import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEEP_TOOLS,
  deepArgs,
  deepRunBlocked,
  deepToolsFor,
  detectDeepTarget,
  isPersonType
} from '../public/deep-search.js';
import {toolRisk} from '../public/tool-tiers.js';

const FIXTURE_TOOLS=JSON.parse(fs.readFileSync(new URL('./fixtures/mcp-tools.json',import.meta.url),'utf8'));

test('detects and normalises messy input',()=>{
  assert.deepEqual(detectDeepTarget(' Jane.Smith+news@Mail.COM '),{type:'email',value:'jane.smith+news@mail.com'});
  assert.deepEqual(detectDeepTarget('@JSmith88'),{type:'username',value:'jsmith88'});
  assert.deepEqual(detectDeepTarget('jsmith88'),{type:'username',value:'jsmith88'});
  assert.deepEqual(detectDeepTarget('https://Example.com/about'),{type:'domain',value:'example.com'});
  assert.deepEqual(detectDeepTarget('8.8.8.8'),{type:'ip',value:'8.8.8.8'});
  assert.deepEqual(detectDeepTarget('+1 (415) 555-2671'),{type:'phone',value:'+14155552671'});
  assert.deepEqual(detectDeepTarget('cve-2024-3094'),{type:'cve',value:'CVE-2024-3094'});
  assert.deepEqual(detectDeepTarget('D41D8CD98F00B204E9800998ECF8427E'),{type:'hash',value:'d41d8cd98f00b204e9800998ecf8427e'});
  assert.equal(detectDeepTarget('jane smith'),null);
  assert.equal(detectDeepTarget('a'),null);
});

test('person searches use Passive tools only, at any level',()=>{
  for(const type of ['email','username','phone']){
    const picked=deepToolsFor(FIXTURE_TOOLS,{type,level:3});
    assert.ok(picked.length>0,type);
    assert.ok(picked.every(item=>item.risk.level===0),type);
    assert.equal(isPersonType(type),true);
  }
  assert.equal(isPersonType('domain'),false);
});

test('website tools grow with the level and are never capped',()=>{
  const counts=[0,1,2,3].map(level=>deepToolsFor(FIXTURE_TOOLS,{type:'domain',level}).length);
  assert.ok(counts[0]<counts[1]&&counts[1]<counts[2]&&counts[2]<counts[3],counts.join(','));
  const expected=DEEP_TOOLS.domain.filter(entry=>FIXTURE_TOOLS.some(tool=>tool.name===entry.name)).length;
  assert.equal(counts[3],expected);
  assert.ok(counts[3]>18,'the old 18-tool cap must be gone');
});

test('flagged, unreviewed, write-annotated and excluded tools never appear',()=>{
  const headers=FIXTURE_TOOLS.find(tool=>tool.name==='omega_headers');
  const tools=[...FIXTURE_TOOLS,
    {name:'omega_ports',serverName:'Custom',serverId:'x'},
    {...headers,serverId:'write-copy',annotations:{...headers.annotations,readOnlyHint:false}}
  ];
  const names=deepToolsFor(tools,{type:'domain',level:3,excluded:new Set(['omega_ssl'])})
    .map(item=>`${item.tool.serverName}:${item.tool.name}`);
  assert.ok(!names.includes('Custom:omega_ports'));
  assert.ok(!names.some(name=>name.endsWith(':omega_ssl')));
  assert.equal(names.filter(name=>name.endsWith(':omega_headers')).length,1);
  for(const name of ['omega_firmware','omega_mobile','omega_ioc','omega_wordlist','omega_auto','omega_chain'])
    assert.ok(!names.some(value=>value.endsWith(`:${name}`)),name);
});

test('order is Passive first, then each higher tier, then table order',()=>{
  const picked=deepToolsFor(FIXTURE_TOOLS,{type:'domain',level:3});
  const levels=picked.map(item=>item.risk.level);
  assert.deepEqual(levels,[...levels].sort((a,b)=>a-b));
  for(let level=0;level<=3;level++){
    const expected=DEEP_TOOLS.domain.filter(entry=>toolRisk(FIXTURE_TOOLS.find(tool=>tool.name===entry.name) || {}).level===level)
      .map(entry=>entry.name);
    const actual=picked.filter(item=>item.risk.level===level).map(item=>item.tool.name);
    assert.deepEqual(actual,expected.filter(name=>actual.includes(name)));
  }
});

test('deep arguments apply the overrides',()=>{
  const maigret=FIXTURE_TOOLS.find(tool=>tool.name==='maigret_username_search');
  const holehe=FIXTURE_TOOLS.find(tool=>tool.name==='holehe_email_search');
  const sherlock=FIXTURE_TOOLS.find(tool=>tool.name==='sherlock_username_search');
  assert.equal(deepArgs(maigret,{type:'username',value:'jsmith88'}).all_sites,true);
  assert.equal(deepArgs(holehe,{type:'email',value:'owner@example.com'}).only_used,true);
  assert.equal(deepArgs(sherlock,{type:'username',value:'jsmith88'}).output_format,'txt');
});

test('confirmations: none for people, ownership for sites, typed target at Intrusive',()=>{
  assert.equal(deepRunBlocked({target:'a@b.co',level:0,person:true}),'');
  assert.match(deepRunBlocked({target:'blog.example',level:1,authorization:false}),/own this target/);
  assert.match(deepRunBlocked({target:'example.com',level:3,authorization:true,typedTarget:'exampel.com'}),/example\.com/);
  assert.equal(deepRunBlocked({target:'example.com',level:3,authorization:true,typedTarget:'example.com'}),'');
});

test('every listed tool exists, is reviewed, unflagged and read-only',()=>{
  const names=new Set(FIXTURE_TOOLS.map(tool=>tool.name));
  for(const [type,entries] of Object.entries(DEEP_TOOLS)){
    assert.equal(new Set(entries.map(entry=>entry.name)).size,entries.length,`${type} lists a tool twice`);
    for(const entry of entries){
      assert.ok(names.has(entry.name),`${type}: ${entry.name} is not connected`);
      const found=FIXTURE_TOOLS.find(tool=>tool.name===entry.name);
      const risk=toolRisk(found);
      assert.equal(risk.reviewed,true,`${type}: ${entry.name} is unreviewed`);
      assert.deepEqual(risk.flags,[],`${type}: ${entry.name} is flagged`);
      assert.notEqual(found.annotations?.readOnlyHint,false,`${type}: ${entry.name} writes`);
      assert.notEqual(found.annotations?.destructiveHint,true,`${type}: ${entry.name} is destructive`);
    }
  }
});

test('omega_asn is no longer an IP tool and GreyNoise is public-only',async()=>{
  const {DEEP_SEARCH_TOOLS}=await import('../public/deep-search.js');
  assert.equal(DEEP_SEARCH_TOOLS.ip.includes('omega_asn'),false);
  assert.equal(DEEP_SEARCH_TOOLS.ip.includes('get_greynoise'),true);
  assert.equal(DEEP_TOOLS.ip.find(entry=>entry.name==='get_greynoise').publicIpOnly,true);
  const picked=deepToolsFor(FIXTURE_TOOLS.filter(tool=>['get_greynoise','get_bgp'].includes(tool.name)),{type:'ip'});
  assert.deepEqual(picked.map(item=>[item.tool.name,item.publicIpOnly]).sort(),[['get_bgp',false],['get_greynoise',true]]);
});

test('isReservedIp knows the private and reserved ranges exactly',async()=>{
  const {isReservedIp}=await import('../public/deep-search.js');
  for(const value of ['10.0.0.1','172.16.0.1','172.31.255.255','192.168.1.1','127.0.0.1','169.254.1.1','100.64.0.0','100.127.255.255','198.18.0.0','198.19.255.255','192.0.2.10','198.51.100.1','203.0.113.5','0.1.2.3','224.0.0.1','255.255.255.255','::1','::','fe80::1','fd00::1','2001:db8::1','ff02::1'])
    assert.equal(isReservedIp(value),true,value);
  for(const value of ['8.8.8.8','1.1.1.1','172.32.0.1','172.15.255.255','100.63.255.255','100.128.0.0','198.17.255.255','198.20.0.0','2606:4700::1111'])
    assert.equal(isReservedIp(value),false,value);
});

test('isReservedIp never throws on odd input',async()=>{
  const {isReservedIp}=await import('../public/deep-search.js');
  for(const value of ['','999.1.1.1','01.2.3.4','1.2.3','not an ip',undefined])assert.equal(isReservedIp(value),false,String(value));
});

test('website input with www or a path is a website, never a username',()=>{
  const site={type:'domain',value:'example.com'};
  for(const input of ['www.example.com','WWW.Example.com','example.com/path','www.example.com/a/b?x=1'])
    assert.deepEqual(detectDeepTarget(input),site,input);
  assert.deepEqual(detectDeepTarget('ownername'),{type:'username',value:'ownername'});
  assert.deepEqual(detectDeepTarget('owner.name'),{type:'domain',value:'owner.name'}); // current behaviour, unchanged
});

test('a website name with accented letters is the whole site, never part of it',()=>{
  assert.deepEqual(detectDeepTarget('bücher.de'),{type:'domain',value:'xn--bcher-kva.de'});
  assert.deepEqual(detectDeepTarget('münchen.de'),{type:'domain',value:'xn--mnchen-3ya.de'});
  assert.deepEqual(detectDeepTarget('https://bücher.de/'),{type:'domain',value:'xn--bcher-kva.de'});
  assert.deepEqual(detectDeepTarget('www.bücher.de/katalog'),{type:'domain',value:'xn--bcher-kva.de'});
  assert.deepEqual(detectDeepTarget('owner@bücher.de'),{type:'email',value:'owner@xn--bcher-kva.de'});
});
