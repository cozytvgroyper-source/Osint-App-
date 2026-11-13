import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ADAPTERS,accountCategory,adaptToolResult,cleanUrl,profilePageUrl,trimRaw,unwrapText} from '../public/deep-adapters.js';

const fixtureDir=new URL('./fixtures/deep/',import.meta.url);
const fixtureFiles=fs.readdirSync(fixtureDir).filter(file=>file.endsWith('.json')&&file.includes('--')).sort();
const fixtures=fixtureFiles.map(file=>JSON.parse(fs.readFileSync(new URL(file,fixtureDir),'utf8')));
const fixture=tool=>fixtures.find(item=>item.tool===tool);
const VALID_KINDS=new Set(['account','breach','fact','host','problem','lead']);

test('every recorded answer is safe to adapt and every finding keeps its source and subject',()=>{
  assert.equal(fixtures.length,53);
  for(const item of fixtures){
    const findings=adaptToolResult({name:item.tool,serverName:item.serverName},item.result,item.identifier);
    assert.ok(Array.isArray(findings),item.tool);
    for(const finding of findings){
      assert.equal(finding.tool.name,item.tool);
      assert.equal(finding.tool.serverName,item.serverName);
      assert.deepEqual(finding.subject,item.identifier);
      assert.ok(VALID_KINDS.has(finding.kind),`${item.tool}: ${finding.kind}`);
      assert.notEqual(finding.fact?.value,item.identifier.value,`${item.tool} returned a bare query echo`);
    }
  }
});

test('Holehe registered sites are verified accounts for the searched email',()=>{
  const subject={type:'email',value:'owner@example.com'};
  const result={content:[{type:'text',text:'[+] Twitter\n[-] Other'}]};
  const findings=adaptToolResult({name:'holehe_email_search',serverName:'OSINT Toolbox'},result,subject);
  assert.equal(findings.length,1);
  assert.equal(findings[0].kind,'account');
  assert.equal(findings[0].account.verified,true);
  assert.deepEqual(findings[0].evidence.emails,[subject.value]);
});

test('Sherlock and Blackbird fixtures become unverified account candidates',()=>{
  for(const name of ['sherlock_username_search','blackbird_username_search']){
    const item=fixture(name);
    const findings=adaptToolResult({name,serverName:item.serverName},item.result,item.identifier);
    assert.ok(findings.some(finding=>finding.kind==='account'),name);
    assert.ok(findings.filter(finding=>finding.kind==='account').every(finding=>finding.account.verified===false),name);
  }
});

test('Maigret keeps extracted names as evidence and profile details as details',()=>{
  const item=fixture('maigret_username_search');
  const findings=adaptToolResult({name:item.tool,serverName:item.serverName},item.result,item.identifier);
  assert.ok(findings.length>20);
  assert.ok(findings.some(finding=>finding.kind==='account'&&finding.evidence.names.includes('Owner Example')));
  assert.ok(findings.some(finding=>finding.account?.details.names.includes('Owner Example')));
  assert.ok(findings.some(finding=>finding.account?.details.websites.includes('https://example.com/linked-profile')));
});

const adaptFixture=name=>{
  const item=fixtures.find(entry=>entry.tool===name&&entry.identifier.type==='username');
  return adaptToolResult({name:item.tool,serverName:item.serverName},item.result,item.identifier);
};
const accounts=findings=>findings.filter(finding=>finding.kind==='account');
const allDetails=finding=>Object.values(finding.account.details).flat();
const byUrl=(findings,url)=>findings.find(finding=>finding.account.url===url||finding.account.rawUrl===url);
const DETAIL_KEYS=['names','usernames','emails','phones','ips','websites','places'];

test('socmint table rows carry presence, clean links and no echo',()=>{
  const found=accounts(adaptFixture('omega_socmint'));
  assert.ok(found.length>=20);
  for(const finding of found){
    for(const value of [finding.account.url,finding.account.rawUrl||''])
      assert.ok(!value.includes('\\n')&&!value.includes('\\'),value);
    assert.ok(!finding.evidence.usernames.includes('ownername'));
    assert.ok(!finding.account.details.usernames.includes('ownername'));
    assert.deepEqual(Object.keys(finding.account.details).sort(),[...DETAIL_KEYS].sort());
  }
  const github=byUrl(found,'https://github.com/ownername');
  assert.equal(github.account.presence,'not-found');
  assert.equal(github.account.presenceNote,'404');
  const gitlab=byUrl(found,'https://gitlab.com/ownername');
  assert.equal(gitlab.account.presence,'unchecked');
  assert.equal(gitlab.account.presenceNote,'403');
  assert.equal(byUrl(found,'https://x.com/ownername').account.presence,'found');
  assert.ok(found.some(finding=>finding.account.url==='https://www.reddit.com/user/ownername'));
  assert.ok(found.some(finding=>finding.account.url==='https://news.ycombinator.com/user?id=ownername'));
});

test('identity list rows are found accounts without the echo',()=>{
  const found=accounts(adaptFixture('omega_identity'));
  assert.equal(found.length,5);
  for(const finding of found){
    assert.equal(finding.account.presence,'found');
    assert.ok(/^https:\/\/\S+[^\\]$/.test(finding.account.url),finding.account.url);
    assert.ok(!finding.account.url.includes('\\'));
    assert.ok(!allDetails(finding).includes('ownername'));
    assert.ok(!finding.evidence.usernames.includes('ownername'));
  }
});

test('Maigret profile details become details, never images or the searched username',()=>{
  const found=accounts(adaptFixture('maigret_username_search'));
  assert.ok(found.every(finding=>finding.account.presence==='found'));
  assert.ok(found.some(finding=>finding.account.details.names.includes('Owner Example')));
  assert.ok(found.some(finding=>finding.account.details.places.includes('Example City')));
  assert.ok(found.some(finding=>finding.account.details.websites.includes('https://example.com/linked-profile')));
  for(const finding of found){
    const values=allDetails(finding);
    assert.ok(!values.some(value=>/avatar\.jpg/.test(value)),finding.account.site);
    assert.ok(!values.includes('ownername'),finding.account.site);
    assert.ok(!values.includes(finding.account.url),finding.account.site);
  }
});

test('Sherlock and Blackbird hits are found accounts',()=>{
  for(const name of ['sherlock_username_search','blackbird_username_search']){
    const found=accounts(adaptFixture(name));
    assert.ok(found.length>0,name);
    for(const finding of found){
      assert.equal(finding.account.presence,'found',name);
      assert.deepEqual(finding.account.details,{names:[],usernames:[],emails:[],phones:[],ips:[],websites:[],places:[]},name);
    }
  }
});

test('profilePageUrl maps data addresses and leaves pages alone',()=>{
  const cases=[
    ['https://www.reddit.com/user/ownername/about.json','https://www.reddit.com/user/ownername'],
    ['https://hacker-news.firebaseio.com/v0/user/ownername.json','https://news.ycombinator.com/user?id=ownername'],
    ['https://hacker-news.firebaseio.com/v0/user/ownername.jso','https://news.ycombinator.com/user?id=ownername'],
    ['https://dev.to/api/users/by_username?url=ownername','https://dev.to/ownername'],
    ['https://en.gravatar.com/ownername.json','https://gravatar.com/ownername'],
    ['https://hub.docker.com/v2/users/ownername/','https://hub.docker.com/u/ownername'],
    ['https://api.twitch.tv/helix/users?login=ownername','https://www.twitch.tv/ownername']
  ];
  for(const [raw,page] of cases)assert.deepEqual(profilePageUrl(raw),{url:page,rawUrl:raw},raw);
  assert.deepEqual(profilePageUrl('https://github.com/x'),{url:'https://github.com/x',rawUrl:''});
  assert.deepEqual(profilePageUrl('https://api.example.net/u/x'),{url:'',rawUrl:'https://api.example.net/u/x'});
  assert.deepEqual(profilePageUrl('https://app.example.net/api/v4/user/x'),{url:'',rawUrl:'https://app.example.net/api/v4/user/x'});
  assert.deepEqual(profilePageUrl('https://x-default.firebaseio.com/u/x'),{url:'',rawUrl:'https://x-default.firebaseio.com/u/x'});
  assert.deepEqual(profilePageUrl('https://example.net/u/x.json'),{url:'',rawUrl:'https://example.net/u/x.json'});
});

test('cleanUrl strips escaped line breaks',()=>{
  assert.equal(cleanUrl('https://github.com/x\\n'),'https://github.com/x');
  assert.equal(cleanUrl('https://github.com/x\\r\\n'),'https://github.com/x');
  assert.equal(cleanUrl('https://github.com/x\\t'),'https://github.com/x');
  assert.equal(cleanUrl('https://github.com/x\\'),'https://github.com/x');
  assert.equal(cleanUrl('https://github.com/x).'),'https://github.com/x');
  assert.equal(cleanUrl('https://github.com/x],;'),'https://github.com/x');
});

test('unwrapText reads the inner result of an envelope',()=>{
  assert.equal(unwrapText({content:[{type:'text',text:JSON.stringify({status:'ok',result:'a\nb'})}]}),'a\nb');
  assert.equal(unwrapText({content:[{type:'text',text:JSON.stringify({output:'x'})}]}),'x');
  assert.equal(unwrapText({content:[{type:'text',text:'plain'}]}),'plain');
  assert.equal(unwrapText({content:[{type:'text',text:JSON.stringify({result:{a:1}})}]}),JSON.stringify({result:{a:1}}));
});

test('GHunt facts and account are verified when a structured answer is available',()=>{
  const subject={type:'email',value:'owner@example.com'};
  const result={content:[{type:'text',text:JSON.stringify({name:'Owner Example',profile_url:'https://profiles.google.com/example-id'})}]};
  const findings=adaptToolResult({name:'ghunt_google_search',serverName:'OSINT Toolbox'},result,subject);
  assert.ok(findings.some(finding=>finding.kind==='fact'&&finding.evidence.names.includes('Owner Example')));
  assert.ok(findings.some(finding=>finding.kind==='account'&&finding.account.verified));
});

test('breach lists become sourced breach findings',()=>{
  const subject={type:'email',value:'owner@example.com'};
  const result={content:[{type:'text',text:JSON.stringify({status:'ok',result:{target:subject.value,breaches:[{name:'Example Breach',date:'2024'}]}})}]};
  const findings=adaptToolResult({name:'omega_breach',serverName:'Omega MCP'},result,subject);
  assert.deepEqual(findings.map(finding=>finding.breach?.name),['Example Breach']);
});

test('port and mail findings use documented severities and always keep a source',()=>{
  const ports={content:[{type:'text',text:JSON.stringify({status:'ok',result:{ports:[{port:22,service:'ssh'},{port:5432,service:'postgres'}]}})}]};
  const findings=adaptToolResult({name:'omega_ports',serverName:'Omega MCP'},ports,{type:'ip',value:'192.0.2.10'});
  assert.ok(findings.some(finding=>finding.problem?.severity==='high'));
  assert.ok(findings.every(finding=>finding.tool?.name==='omega_ports'));
});

test('malformed answers never crash an adapter',()=>{
  for(const bad of [null,{content:[{type:'text',text:'{not json'}]},{isError:true,content:[{type:'text',text:'boom'}]},{content:[{type:'text',text:'x'.repeat(3_000_000)}]}])
    assert.doesNotThrow(()=>adaptToolResult({name:'omega_social',serverName:'Omega MCP'},bad,{type:'username',value:'u'}));
});

test('trimRaw keeps at most 1 MB and reports trimming',()=>{
  const result=trimRaw('é'.repeat(1_000_000));
  assert.ok(Buffer.byteLength(result.text)<=1_000_000);
  assert.equal(result.trimmed,true);
});

test('unknown tools fall back to indicators and plain facts',()=>{
  const out=adaptToolResult({name:'new_tool',serverName:'Open OSINT'},{content:[{type:'text',text:JSON.stringify({emails:['a@b.co'],country:'UK'})}]},{type:'domain',value:'b.co'});
  assert.ok(out.some(finding=>finding.kind==='lead'&&finding.lead.value==='a@b.co'));
  assert.ok(out.some(finding=>finding.kind==='fact'&&finding.fact.value==='UK'));
});

test('account categories are stable and unknown sites stay Other',()=>{
  assert.equal(accountCategory('github.com'),'developer');
  assert.equal(accountCategory('twitter.com'),'social');
  assert.equal(accountCategory('community.example'),'forums');
  assert.equal(accountCategory('shop.example'),'other');
  assert.ok(ADAPTERS.maigret_username_search);
});
