import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TIERS,toolRisk,runRequirements,groupToolsByTier,toolUsage} from '../public/tool-tiers.js';
import {isPassiveSearchTool} from '../public/search-planner.js';

// Every connected tool gets one reviewed risk tier: 0 Passive, 1 Light touch, 2 Active, 3 Intrusive. A tool nobody has
// reviewed is treated as Intrusive, so a new scanner can never be mistaken for a safe one.
const tools=JSON.parse(fs.readFileSync(new URL('./fixtures/mcp-tools.json',import.meta.url),'utf8'));
const byName=name=>{const found=tools.find(tool=>tool.name===name);assert.ok(found,`fixture is missing ${name}`);return found;};

test('defines four tiers from passive to intrusive',()=>{
  assert.deepEqual(TIERS.map(tier=>[tier.level,tier.key]),[[0,'passive'],[1,'light'],[2,'active'],[3,'intrusive']]);
  for(const tier of TIERS)assert.ok(tier.label&&tier.targetSees,tier.key);
});

// The fixture holds the 240 tools of the three local servers; Consensus's 5 research-paper tools come from its online
// server, so together the app shows 245.
test('every connected tool has a reviewed tier',()=>{
  assert.equal(tools.length,240);
  const unreviewed=tools.filter(tool=>!toolRisk(tool).reviewed).map(tool=>tool.name);
  assert.deepEqual(unreviewed,[]);
  assert.equal(toolRisk({name:'search',serverName:'Consensus'}).level,0,'Consensus searches published papers');
});

test('a tool nobody has reviewed is treated as intrusive',()=>{
  const risk=toolRisk({name:'omega_brand_new_scanner',serverName:'Omega MCP'});
  assert.equal(risk.level,3);
  assert.equal(risk.reviewed,false);
  assert.equal(toolRisk({name:'mystery',serverName:'Some Custom Server'}).level,3);
});

// The safety invariant: the main search may only ever auto-run passive tools.
test('every tool the main search is allowed to run automatically is passive',()=>{
  const offenders=tools.filter(tool=>isPassiveSearchTool(tool)&&toolRisk(tool).level!==0).map(tool=>`${tool.name} (tier ${toolRisk(tool).level})`);
  assert.deepEqual(offenders,[]);
});

test('places the known scanners and attack tools in the right tiers',()=>{
  const level=name=>toolRisk(byName(name)).level;
  for(const name of ['get_whois','whois_lookup','crtsh_certificate_search','sherlock_username_search','omega_whois','omega_breach'])assert.equal(level(name),0,name);
  for(const name of ['omega_headers','omega_ssl','omega_tech','omega_screenshot'])assert.equal(level(name),1,name);
  for(const name of ['omega_ports','omega_crawl','omega_dnsbrute','omega_buckets','dnsrecon_domain_scan','spiderfoot_scan'])assert.equal(level(name),2,name);
  for(const name of ['omega_vuln','omega_fuzzer','omega_redteam','omega_autopilot','omega_pivot','omega_plugin'])assert.equal(level(name),3,name);
});

test('flags tools that spend AI credits or have side effects',()=>{
  for(const name of ['omega_ai_analyst','omega_aiassist','omega_aisummary','omega_agent_run','omega_autopilot'])assert.ok(toolRisk(byName(name)).flags.includes('credits'),name);
  for(const name of ['omega_notifier','omega_monitor','omega_pdfreport','omega_plugin'])assert.ok(toolRisk(byName(name)).flags.includes('side-effects'),name);
  assert.deepEqual(toolRisk(byName('get_whois')).flags,[]);
});

test('Tier 2 and up need authorization before running; Tier 3 also needs the tool name typed; credits need consent',()=>{
  assert.deepEqual(runRequirements(toolRisk(byName('get_whois'))),{authorization:false,typeName:false,credits:false});
  assert.deepEqual(runRequirements(toolRisk(byName('omega_ports'))),{authorization:true,typeName:false,credits:false});
  assert.deepEqual(runRequirements(toolRisk(byName('omega_vuln'))),{authorization:true,typeName:true,credits:false});
  assert.deepEqual(runRequirements(toolRisk(byName('omega_aisummary'))),{authorization:false,typeName:false,credits:true});
  assert.deepEqual(runRequirements(toolRisk({name:'unknown_tool',serverName:'X'})),{authorization:true,typeName:true,credits:false});
});

test('groups tools by tier, safest first, keeping empty tiers out',()=>{
  const groups=groupToolsByTier([byName('omega_vuln'),byName('get_whois'),byName('omega_ports'),byName('whois_lookup')]);
  assert.deepEqual(groups.map(group=>[group.tier.key,group.tools.map(tool=>tool.name)]),[['passive',['get_whois','whois_lookup']],['active',['omega_ports']],['intrusive',['omega_vuln']]]);
});

test('says where each tool is used',()=>{
  assert.equal(toolUsage(byName('get_whois')),'Main search can use it');
  assert.equal(toolUsage(byName('subfinder_subdomain_search')),'Tool Library only');
  assert.equal(toolUsage(byName('omega_ports')),'Tool Library only');
});
