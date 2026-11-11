import test from 'node:test';
import assert from 'node:assert/strict';
import {isPassiveSearchTool,planSearchTools} from '../public/search-planner.js';

const tool=(name,description,serverName='Open OSINT')=>({name,description,serverName,serverId:serverName,inputSchema:{properties:{query:{type:'string'}}}});

test('scores every connected tool and keeps relevant preferred sources first',()=>{
  const tools=[tool('get_news_rss','Aggregated current news feeds'),tool('get_gdelt','Search global events and news'),tool('get_earthquakes','Recent earthquake activity'),tool('omega_briefing','Generate a generic briefing','Omega MCP')];
  const plan=planSearchTools({query:'latest news about elections',intentId:'news',preferredNames:['get_gdelt','get_news_rss'],tools});
  assert.deepEqual(new Set(plan.slice(0,2).map(item=>item.tool.name)),new Set(['get_gdelt','get_news_rss']));
  assert.ok(plan.every(item=>item.reason));
});

test('discovers relevant tools even when they are not in the preferred list',()=>{
  const tools=[tool('get_news_rss','Current reporting'),tool('election_observer','Election polling ballot monitoring','Community MCP')];
  const plan=planSearchTools({query:'monitor election ballot activity',intentId:'election',preferredNames:['missing_tool'],tools});
  assert.equal(plan[0].tool.name,'election_observer');
});

test('does not automatically select active scanning capabilities',()=>{
  const active=tool('omega_ports','Port scanner that discovers services','Omega MCP');
  const passive=tool('get_cisa_kev','Known exploited vulnerability catalog');
  assert.equal(isPassiveSearchTool(active),false);
  const plan=planSearchTools({query:'vulnerability intelligence',intentId:'cve',preferredNames:['omega_ports','get_cisa_kev'],tools:[active,passive]});
  assert.deepEqual(plan.map(item=>item.tool.name),['get_cisa_kev']);
});

test('only automatically selects reviewed passive Omega tools',()=>{
  const reviewed=tool('omega_whois','WHOIS lookup for a domain or IP','Omega MCP');
  const unreviewed=[
    tool('omega_aisummary','AI-generated summary of all collected OSINT data','Omega MCP'),
    tool('omega_screenshot','Web page screenshot','Omega MCP'),
    tool('omega_notifier','Alert notifications','Omega MCP'),
    tool('omega_typosquat','Typosquatting detection','Omega MCP'),
    tool('omega_subdomains','Subdomain enumeration via multiple sources','Omega MCP')
  ];
  assert.equal(isPassiveSearchTool(reviewed),true);
  for(const candidate of unreviewed)assert.equal(isPassiveSearchTool(candidate),false,candidate.name);
  const plan=planSearchTools({query:'whois lookup',intentId:'domain',preferredNames:unreviewed.map(item=>item.name),tools:[reviewed,...unreviewed]});
  assert.deepEqual(plan.map(item=>item.tool.name),['omega_whois']);
});

test('allows the useful reviewed breach lookup but keeps placeholder-only Omega output manual',()=>{
  assert.equal(isPassiveSearchTool(tool('omega_breach','Breach leak database check','Omega MCP')),true);
  assert.equal(isPassiveSearchTool(tool('omega_archive','Web archive snapshot retrieval','Omega MCP')),false);
  assert.equal(isPassiveSearchTool(tool('omega_threatintel','Threat intelligence context','Omega MCP')),false);
});

test('allows reviewed structured Omega email and Git reconnaissance lookups',()=>{
  assert.equal(isPassiveSearchTool(tool('omega_email','Email validation and domain records','Omega MCP')),true);
  assert.equal(isPassiveSearchTool(tool('omega_gitrecon','Public Git repository reconnaissance','Omega MCP')),true);
  assert.equal(isPassiveSearchTool(tool('omega_username','Username search','Omega MCP')),false);
  assert.equal(isPassiveSearchTool(tool('omega_phoneosint','Phone lookup','Omega MCP')),false);
});

test('allows the reviewed IP dossier but keeps redundant, keyless or unreliable Omega text output manual',()=>{
  assert.equal(isPassiveSearchTool(tool('omega_ipdossier','IP dossier — detailed intelligence report for an IP address.','Omega MCP')),true);
  assert.equal(isPassiveSearchTool(tool('omega_geoint','Geolocation intelligence','Omega MCP')),false);
  assert.equal(isPassiveSearchTool(tool('omega_recon','Quick reconnaissance','Omega MCP')),false);
  assert.equal(isPassiveSearchTool(tool('omega_threatintel','Threat intelligence context','Omega MCP')),false);
  assert.equal(isPassiveSearchTool(tool('omega_phoneosint','Phone lookup','Omega MCP')),false);
});

test('allows the reviewed OTX intel lookup but keeps job-postings-only org output manual',()=>{
  assert.equal(isPassiveSearchTool(tool('omega_intel','Intelligence gathering — aggregated threat and context data.','Omega MCP')),true);
  assert.equal(isPassiveSearchTool(tool('omega_org','Organization intelligence','Omega MCP')),false);
});

test('allows the reviewed CVE ranking but keeps duplicate or misleading Omega tools manual',()=>{
  assert.equal(isPassiveSearchTool(tool('omega_cvssrank','CVSS ranking — scores and prioritizes vulnerabilities by severity.','Omega MCP')),true);
  for(const name of ['omega_leaked','omega_identity','omega_socmint','omega_codetrace','omega_persona'])
    assert.equal(isPassiveSearchTool(tool(name,'Reviewed and kept manual','Omega MCP')),false,name);
});

test('never auto-runs a tool its own server declares as writing',()=>{
  const withHints=annotations=>({...tool('create_thread','Create a new research thread and dispatch the research agent','Consensus'),annotations});
  assert.equal(isPassiveSearchTool(withHints({readOnlyHint:false})),false);
  assert.equal(isPassiveSearchTool(withHints({readOnlyHint:true,destructiveHint:true})),false);
  assert.equal(isPassiveSearchTool(withHints({readOnlyHint:true})),true);
  assert.equal(isPassiveSearchTool(tool('search','Search published research papers','Consensus')),true,'tools without hints keep their review');
});

test('treats omega-prefixed tools as Omega even under another server name',()=>{
  assert.equal(isPassiveSearchTool(tool('omega_plugin','Plugin manager','Renamed Server')),false);
});

test('rejects tools whose required target type does not match the query',()=>{
  const domainTool={...tool('dnstwist_lookalike_domains','Find phishing lookalike domains','OSINT Toolbox'),inputSchema:{required:['domain'],properties:{domain:{type:'string'}}}};
  const newsTool=tool('get_cyber_news','Cybersecurity threat news');
  const plan=planSearchTools({query:'latest healthcare cyber threats',intentId:'cyber',preferredNames:['get_cyber_news'],tools:[domainTool,newsTool]});
  assert.deepEqual(plan.map(item=>item.tool.name),['get_cyber_news']);
});
