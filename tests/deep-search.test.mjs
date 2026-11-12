import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DEEP_SEARCH_TOOLS,deepRunBlocked,deepSearchPlan} from '../public/deep-search.js';
import {toolRisk} from '../public/tool-tiers.js';

const tool=(name,serverName='Omega MCP')=>({name,serverName,inputSchema:{type:'object',properties:{target:{type:'string'}},required:['target']}});
test('plans only reviewed tools at or below the selected level in a useful order',()=>{
  const plan=deepSearchPlan([tool('omega_vuln'),tool('omega_headers'),tool('omega_intel'),tool('unknown')],'example.com',1);
  assert.deepEqual(plan.map(item=>item.tool.name),['omega_intel','omega_headers']);
  assert.deepEqual(plan[0].args,{target:'example.com'});
});
test('requires explicit scope authorization and exact target text for Intrusive runs',()=>{
  assert.match(deepRunBlocked({target:'',level:1,authorization:true,selectedCount:1}),/target/);
  assert.match(deepRunBlocked({target:'example.com',level:2,authorization:false,selectedCount:1}),/permission/);
  assert.match(deepRunBlocked({target:'example.com',level:3,authorization:true,typedTarget:'wrong',selectedCount:1}),/example.com/);
  assert.equal(deepRunBlocked({target:'example.com',level:3,authorization:true,typedTarget:'example.com',selectedCount:2}),'');
});

const realTools=JSON.parse(fs.readFileSync(new URL('./fixtures/mcp-tools.json',import.meta.url),'utf8'));
const planNames=(target,level)=>deepSearchPlan(realTools,target,level).map(item=>item.tool.name);

test('every Deep Search tool exists, is unflagged and read-only',()=>{
  const names=new Set(realTools.map(t=>t.name));
  for(const [type,list] of Object.entries(DEEP_SEARCH_TOOLS)){
    assert.equal(new Set(list).size,list.length,`${type} lists a tool twice`);
    for(const name of list){
      assert.ok(names.has(name),`${type}: ${name} is not a connected tool`);
      const found=realTools.find(t=>t.name===name);
      assert.deepEqual(toolRisk(found).flags,[],`${type}: ${name} is flagged`);
      assert.notEqual(found.annotations?.readOnlyHint,false,`${type}: ${name} writes`);
    }
  }
});

test('Deep Search leaves out tools the review found broken, unreliable or wrong for the target type',()=>{
  const all=Object.values(DEEP_SEARCH_TOOLS).flat();
  for(const name of ['omega_username','omega_phoneosint','omega_social'])assert.ok(!all.includes(name),name);
  assert.ok(!DEEP_SEARCH_TOOLS.cve.includes('omega_cvemap'),'cvemap fingerprints a website; a CVE id is not one');
  assert.ok(!DEEP_SEARCH_TOOLS.cve.includes('omega_vuln'),'vuln scans a host; a CVE id is not one');
  assert.ok(!DEEP_SEARCH_TOOLS.hash.includes('omega_ioc'),'ioc fetches a URL; a hash is not one');
});

test('Passive Deep Search plans use the reviewed sources without duplicate pairs',()=>{
  const domain=planNames('example.com',0);
  for(const name of ['whois_lookup','dns_lookup','crtsh_certificate_search','omega_intel','wayback_snapshots','dnstwist_lookalike_domains','theharvester_domain_search'])assert.ok(domain.includes(name),name);
  for(const duplicate of ['omega_whois','omega_dns','omega_crtsh'])assert.ok(!domain.includes(duplicate),duplicate);
  const ip=planNames('8.8.8.8',0);
  for(const name of ['get_bgp','omega_ipdossier','omega_intel'])assert.ok(ip.includes(name),name);
  assert.ok(planNames('@octocat',0).includes('omega_gitrecon'));
  assert.ok(planNames('CVE-2021-44228',0).includes('get_epss'));
});
