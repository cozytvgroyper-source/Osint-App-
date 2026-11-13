import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeMcpToolCall, createRunGrant, releaseRunGrants, RunGrantError, serverNameForEndpoint, stableArguments} from '../scripts/run-grants.mjs';

const omega = 'http://127.0.0.1:8894/mcp';
const toolbox = 'http://127.0.0.1:8893/mcp';
const call = (name, args, extra = {}) => ({endpoint: omega, method:'tools/call', params:{name,arguments:args}, ...extra});
const activeDeep={purpose:'deep-search',target:'blog.example',level:2,runId:'live',tools:[{endpoint:omega,name:'omega_ports',arguments:{target:'blog.example'}}],confirmation:{acknowledged:true,authorization:true}};
const toolLibraryGrant={purpose:'tool-library',target:'blog.example',level:1,tools:[{endpoint:omega,name:'omega_headers',arguments:{target:'blog.example'}}],confirmation:{acknowledged:true}};

test('passive calls do not need grants while Light touch and higher calls fail closed', () => {
  assert.equal(authorizeMcpToolCall({endpoint:toolbox,method:'tools/call',params:{name:'whois_lookup',arguments:{query:'example.com'}}},new Map()).required,false);
  assert.throws(()=>authorizeMcpToolCall(call('omega_headers',{target:'example.com'}),new Map()),error=>error instanceof RunGrantError&&error.status===403);
});

test('a Tool Library grant is one-use and bound to target, tool, endpoint and exact arguments', () => {
  const grants=new Map();
  const issued=createRunGrant({purpose:'tool-library',target:'example.com',level:1,tools:[{endpoint:omega,name:'omega_headers',arguments:{target:'example.com',follow:false}}],confirmation:{acknowledged:true}},grants,{now:100,token:'grant'});
  assert.equal(issued.token,'grant');
  assert.throws(()=>authorizeMcpToolCall(call('omega_headers',{target:'other.example',follow:false},{runGrant:'grant',runTarget:'other.example'}),grants,{now:101}),/target/);
  assert.throws(()=>authorizeMcpToolCall(call('omega_headers',{target:'example.com',follow:true},{runGrant:'grant',runTarget:'example.com'}),grants,{now:101}),/arguments/);
  assert.equal(authorizeMcpToolCall(call('omega_headers',{follow:false,target:'example.com'},{runGrant:'grant',runTarget:'example.com'}),grants,{now:101}).required,true);
  assert.equal(grants.size,0);
  assert.throws(()=>authorizeMcpToolCall(call('omega_headers',{target:'example.com',follow:false},{runGrant:'grant',runTarget:'example.com'}),grants,{now:102}),/current confirmed run grant/);
});

test('expired grants fail and are removed', () => {
  const grants=new Map();
  createRunGrant({target:'example.com',level:1,tools:[{endpoint:omega,name:'omega_headers',arguments:{target:'example.com'}}],confirmation:{acknowledged:true}},grants,{now:100,ttl:10,token:'expired'});
  assert.throws(()=>authorizeMcpToolCall(call('omega_headers',{target:'example.com'},{runGrant:'expired',runTarget:'example.com'}),grants,{now:111}),/current confirmed run grant/);
  assert.equal(grants.size,0);
});

test('Active, Intrusive, credit-spending and side-effect grants require their matching confirmations', () => {
  const grants=new Map();
  assert.throws(()=>createRunGrant({target:'example.com',level:2,tools:[{endpoint:omega,name:'omega_ports',arguments:{target:'example.com'}}],confirmation:{acknowledged:true}},grants),/written permission/);
  assert.throws(()=>createRunGrant({target:'example.com',level:3,tools:[{endpoint:omega,name:'omega_vuln',arguments:{target:'example.com'}}],confirmation:{acknowledged:true,authorization:true}},grants),/omega_vuln/);
  assert.throws(()=>createRunGrant({target:'topic',level:0,tools:[{endpoint:omega,name:'omega_ai_analyst',arguments:{query:'topic'}}],confirmation:{acknowledged:true}},grants),/paid AI credits/);
  assert.throws(()=>createRunGrant({target:'topic',level:0,tools:[{endpoint:omega,name:'omega_notifier',arguments:{query:'topic'}}],confirmation:{acknowledged:true}},grants),/send, store, schedule/);
});

test('Deep Search grants require authorization and the intrusive target typed exactly', () => {
  const grants=new Map();
  const request={purpose:'deep-search',target:'example.com',level:3,tools:[{endpoint:omega,name:'omega_vuln',arguments:{target:'example.com'}}],confirmation:{acknowledged:true,authorization:true,typedTarget:'wrong'}};
  assert.throws(()=>createRunGrant(request,grants),/example.com/);
  assert.equal(createRunGrant({...request,confirmation:{...request.confirmation,typedTarget:'example.com'}},grants,{token:'deep'}).token,'deep');
});

test('Deep Search can bind passive calls and consumes their grant',()=>{
  const grants=new Map();
  const request={purpose:'deep-search',target:'example.com',level:0,tools:[{endpoint:toolbox,name:'whois_lookup',arguments:{query:'example.com'}}],confirmation:{acknowledged:true,authorization:true}};
  createRunGrant(request,grants,{token:'passive-deep'});
  const result=authorizeMcpToolCall({endpoint:toolbox,method:'tools/call',params:{name:'whois_lookup',arguments:{query:'example.com'}},runGrant:'passive-deep',runTarget:'example.com'},grants);
  assert.equal(result.grant.purpose,'deep-search');assert.equal(grants.size,0);
});

test('Deep Search grants at Light touch or below need only the acknowledgement',()=>{
  const grants=new Map();
  const request={purpose:'deep-search',target:'blog.example',level:1,runId:'r1',tools:[{endpoint:omega,name:'omega_headers',arguments:{target:'blog.example'}}],confirmation:{acknowledged:true}};
  assert.ok(createRunGrant(request,grants,{token:'lt'}).token);
  assert.throws(()=>createRunGrant({...request,level:2,tools:[{endpoint:omega,name:'omega_ports',arguments:{target:'blog.example'}}]},grants),/own this target/);
  assert.throws(()=>createRunGrant({...request,confirmation:{}},grants),/notice/);
});

test('an Active call is refused under an acknowledgement-only grant',()=>{
  const grants=new Map();
  createRunGrant({purpose:'deep-search',target:'blog.example',level:1,runId:'r1',tools:[{endpoint:omega,name:'omega_headers',arguments:{target:'blog.example'}}],confirmation:{acknowledged:true}},grants,{token:'lt'});
  assert.throws(()=>authorizeMcpToolCall({endpoint:omega,method:'tools/call',params:{name:'omega_ports',arguments:{target:'blog.example'}},runGrant:'lt',runTarget:'blog.example'},grants),/tier|match/);
});

test('Deep Search grant lifetime is capped at 30 minutes',()=>{
  const grants=new Map();
  const issued=createRunGrant({...activeDeep,ttlMs:99*60_000},grants,{now:0,token:'t'});
  assert.equal(issued.expiresAt,30*60_000);
});

test('eviction keeps grants of a run in progress',()=>{
  const grants=new Map();
  createRunGrant(activeDeep,grants,{token:'keep',now:0});
  for(let i=0;i<120;i++)createRunGrant(toolLibraryGrant,grants,{token:`x${i}`,now:0});
  assert.ok(grants.has('keep'));
  assert.ok(grants.size<=100);
});

test('releasing a run removes its grants only',()=>{
  const grants=new Map();
  createRunGrant({...activeDeep,runId:'a'},grants,{token:'a1'});
  createRunGrant({...activeDeep,runId:'b'},grants,{token:'b1'});
  assert.equal(releaseRunGrants(grants,'a'),1);
  assert.ok(grants.has('b1'));
  assert.ok(!grants.has('a1'));
});

test('custom endpoints cannot claim a trusted passive server identity', () => {
  assert.equal(serverNameForEndpoint('https://tools.example/mcp'),'Custom MCP');
  assert.equal(stableArguments({b:2,a:{d:4,c:3}}),'{"a":{"c":3,"d":4},"b":2}');
  assert.throws(()=>authorizeMcpToolCall({endpoint:'https://tools.example/mcp',method:'tools/call',params:{name:'brand_new_tool',arguments:{}}},new Map()),/confirmed run grant/);
});

// A grant names the server it was given for; the same tool and arguments on any other server are refused.
test('a grant is refused on any other server, even for the same tool and arguments', () => {
  for (const endpoint of [toolbox, 'https://mcp.example/mcp', 'http://127.0.0.1:8892/mcp']) {
    const grants=new Map();
    createRunGrant(toolLibraryGrant,grants,{token:'bound'});
    assert.throws(()=>authorizeMcpToolCall({endpoint,method:'tools/call',params:{name:'omega_headers',arguments:{target:'blog.example'}},runGrant:'bound',runTarget:'blog.example'},grants),error=>error instanceof RunGrantError&&error.status===403,endpoint);
  }
  const grants=new Map();
  createRunGrant(toolLibraryGrant,grants,{token:'bound'});
  assert.equal(authorizeMcpToolCall(call('omega_headers',{target:'blog.example'},{runGrant:'bound',runTarget:'blog.example'}),grants).required,true);
});
