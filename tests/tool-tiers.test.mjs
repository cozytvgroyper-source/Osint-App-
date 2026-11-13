import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TIERS,toolRisk,runRequirements,groupToolsByTier} from '../public/tool-tiers.js';
import {isPassiveSearchTool,toolUsage} from '../public/search-planner.js';

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
  assert.equal(tools.length,245,'107 Open OSINT, 17 OSINT Toolbox, 116 Omega and 5 Consensus tools');
  const unreviewed=tools.filter(tool=>!toolRisk(tool).reviewed).map(tool=>tool.name);
  assert.deepEqual(unreviewed,[]);
  assert.equal(toolRisk({name:'search',serverName:'Consensus'}).level,0,'Consensus searches published papers');
});

// The owner confirmed the 14 best-guess Omega tiers on 2026-11-11 (docs/search-overhaul.md, decision D).
test('no tier is still waiting for the owner to confirm it',()=>{
  assert.deepEqual(tools.filter(tool=>toolRisk(tool).needsReview).map(tool=>tool.name),[]);
  assert.equal(toolRisk(byName('omega_exfil')).level,3,'confirmed tiers keep their level');
  assert.equal(toolRisk(byName('omega_certhunt')).level,1);
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

test('controlled runs require the matching acknowledgement, authorization, typed name and flag consent',()=>{
  assert.deepEqual(runRequirements(toolRisk(byName('get_whois'))),{acknowledgement:false,authorization:false,typeName:false,credits:false,sideEffects:false});
  assert.deepEqual(runRequirements(toolRisk(byName('omega_ports'))),{acknowledgement:true,authorization:true,typeName:false,credits:false,sideEffects:false});
  assert.deepEqual(runRequirements(toolRisk(byName('omega_vuln'))),{acknowledgement:true,authorization:true,typeName:true,credits:false,sideEffects:false});
  assert.deepEqual(runRequirements(toolRisk(byName('omega_aisummary'))),{acknowledgement:true,authorization:false,typeName:false,credits:true,sideEffects:false});
  assert.deepEqual(runRequirements(toolRisk(byName('omega_notifier'))),{acknowledgement:true,authorization:false,typeName:false,credits:false,sideEffects:true});
  assert.deepEqual(runRequirements(toolRisk({name:'unknown_tool',serverName:'X'})),{acknowledgement:true,authorization:true,typeName:true,credits:false,sideEffects:false});
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

test('re-tiers Omega tools whose captured output showed target contact or outside writes',()=>{
  // omega_recon's output on 2026-11-11 included a port scan, subdomain brute force and HTTP/SSL probes.
  assert.equal(toolRisk(byName('omega_recon')).level,2);
  // omega_archive submitted the target to the Wayback Machine's Save Page Now.
  assert.equal(toolRisk(byName('omega_archive')).level,0);
  assert.deepEqual(toolRisk(byName('omega_archive')).flags,['side-effects']);
});

test('re-tiers domain tools whose source contacts the target',()=>{
  // Source review, 2026-11-11: harvester fetches the target's own pages and cvemap runs techfp against the target.
  assert.equal(toolRisk(byName('omega_harvester')).level,1);
  assert.equal(toolRisk(byName('omega_cvemap')).level,1);
  // c2 runs a JARM TLS fingerprint and banner grabs; apiosint requests a list of API paths on the target.
  assert.equal(toolRisk(byName('omega_c2')).level,2);
  assert.equal(toolRisk(byName('omega_apiosint')).level,2);
});

test('full Omega source review: re-tiers tools whose code contacts targets or spends credits',()=>{
  const risk=name=>toolRisk(byName(name));
  // dashboard and livedash run port scans and subdomain brute forcing; dossier scans ports and brute-forces subdomains.
  assert.deepEqual([risk('omega_dashboard').level,risk('omega_dashboard').flags],[2,['side-effects']]);
  assert.deepEqual([risk('omega_livedash').level,risk('omega_livedash').flags],[2,['side-effects']]);
  assert.equal(risk('omega_dossier').level,2);
  // deepweb and torcheck fetch .onion targets through tor2web; typosquat sends HTTP requests to every look-alike domain.
  assert.equal(risk('omega_deepweb').level,1);
  assert.equal(risk('omega_torcheck').level,1);
  assert.equal(risk('omega_typosquat').level,1);
  // executive calls OpenAI when a key is set.
  assert.deepEqual(risk('omega_executive').flags,['credits']);
});

test('flags the Consensus tools that create research threads and run its AI agent',()=>{
  const risk=name=>toolRisk(tools.find(tool=>tool.serverName==='Consensus'&&tool.name===name));
  for(const name of ['create_thread','add_to_thread'])assert.deepEqual([risk(name).level,risk(name).flags],[0,['side-effects','credits']],name);
  for(const name of ['search','get_thread','find_threads'])assert.deepEqual([risk(name).level,risk(name).flags],[0,[]],name);
  assert.deepEqual(toolRisk({name:'create_thread',serverName:'Some Other Server'}).level,3,'the Consensus entries apply only to Consensus');
});

test('every tool the main search may run is read-only and carries no flags',()=>{
  const offenders=tools.filter(tool=>isPassiveSearchTool(tool)&&(toolRisk(tool).flags.length||tool.annotations?.readOnlyHint===false||tool.annotations?.destructiveHint===true)).map(tool=>`${tool.serverName}/${tool.name}`);
  assert.deepEqual(offenders,[]);
});

// Tiers belong to a server's tools, not to tool names: a custom server that names a tool like a reviewed one is not
// reviewed, so it can never pass as passive.
test('a reviewed tool name on another server is still unreviewed',()=>{
  for(const name of ['whois_lookup','sherlock_username_search','omega_whois'])assert.equal(toolRisk({name,serverName:'My Custom MCP'}).level,3,name);
  assert.equal(toolRisk({name:'whois_lookup',serverName:'OSINT Toolbox'}).level,0);
  assert.equal(toolRisk({name:'omega_whois',serverName:'Omega MCP'}).level,0);
});
