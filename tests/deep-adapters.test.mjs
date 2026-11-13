import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ADAPTERS,accountCategory,adaptToolResult,trimRaw} from '../public/deep-adapters.js';

const fixtureDir=new URL('./fixtures/deep/',import.meta.url);
const fixtureFiles=fs.readdirSync(fixtureDir).filter(file=>file.endsWith('.json')).sort();
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

test('Maigret keeps extracted names, links and usernames as evidence',()=>{
  const item=fixture('maigret_username_search');
  const findings=adaptToolResult({name:item.tool,serverName:item.serverName},item.result,item.identifier);
  assert.ok(findings.length>20);
  assert.ok(findings.some(finding=>finding.kind==='account'&&finding.evidence.names.includes('Owner Example')));
  assert.ok(findings.some(finding=>finding.evidence.usernames.includes('ownername')));
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
