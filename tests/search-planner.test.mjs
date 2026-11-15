import test from 'node:test';
import assert from 'node:assert/strict';
import {explainSearchPlan,isPassiveSearchTool,planSearchTools} from '../public/search-planner.js';
import {searchIntent} from '../public/search-query.js';

const tool=(name,description,serverName='Open OSINT')=>({name,description,serverName,serverId:serverName,inputSchema:{properties:{query:{type:'string'}}}});

test('scores every connected tool and keeps relevant preferred sources first',()=>{
  const tools=[tool('get_news_rss','Aggregated current news feeds'),tool('get_gdelt','Search global events and news'),tool('get_earthquakes','Recent earthquake activity'),tool('omega_briefing','Generate a generic briefing','Omega MCP')];
  const plan=planSearchTools({query:'latest news about elections',intentId:'news',preferredNames:['get_gdelt','get_news_rss'],tools});
  assert.deepEqual(new Set(plan.slice(0,2).map(item=>item.tool.name)),new Set(['get_gdelt','get_news_rss']));
  assert.ok(plan.every(item=>item.reason));
});

test('discovers relevant tools even when they are not in the preferred list',()=>{
  const tools=[tool('get_news_rss','Current reporting'),tool('election_observer','Election polling ballot monitoring','Open OSINT')];
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
  assert.equal(isPassiveSearchTool(withHints({readOnlyHint:true})),false,'a read-only hint cannot lift a reviewed paid tool into the main search');
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

// The main search only auto-runs reviewed passive tools, whatever server they come from.
test('the main search never picks an unreviewed or non-passive tool',()=>{
  const custom={name:'lookup_company_records',description:'Look up company records and sanctions for an organization',serverName:'My Custom MCP',inputSchema:{properties:{query:{type:'string'}}}};
  const lookalike={...custom,name:'whois_lookup',description:'WHOIS lookup for a domain'};
  assert.equal(isPassiveSearchTool(custom),false);
  assert.equal(isPassiveSearchTool(lookalike),false);
  assert.deepEqual(planSearchTools({query:'Rosneft company sanctions',intentId:'sanctions',preferredNames:[],tools:[custom],maxTools:6}),[]);
});

// The NVD allows about 5 requests per 30 seconds without a key, and three tools ask it for the same CVE record. A CVE
// search used to run all three, so the later ones were refused (and omega_cve's refusal read as "nothing found").
const CVE_TOOLS=[
  tool('get_nvd_cves','CVE details from the NIST National Vulnerability Database (NVD)'),
  tool('get_cisa_kev','CISA Known Exploited Vulnerabilities catalog'),
  tool('get_epss','EPSS exploit prediction scores for a CVE'),
  tool('omega_cve','CVE lookup — search NVD for vulnerabilities by keyword or CVE ID.','Omega MCP'),
  tool('omega_cvssrank','CVSS ranking — scores and prioritizes vulnerabilities by severity.','Omega MCP')
];
const NVD_TOOLS=new Set(['get_nvd_cves','omega_cve','omega_cvssrank']);
const cvePlan=tools=>{
  const intent=searchIntent('CVE-2021-44228');
  return explainSearchPlan({query:'CVE-2021-44228',intentId:intent.id,preferredNames:intent.tools,tools});
};

test('a CVE search asks the NVD once, and still covers exploit likelihood and known exploitation',()=>{
  const plan=cvePlan(CVE_TOOLS);
  const selected=plan.selected.map(entry=>entry.tool.name);
  assert.deepEqual(selected.filter(name=>NVD_TOOLS.has(name)),['get_nvd_cves'],'one NVD lookup');
  for(const name of ['get_cisa_kev','get_epss'])assert.ok(selected.includes(name),name);
  for(const name of ['omega_cve','omega_cvssrank']){
    const entry=plan.entries.find(item=>item.tool.name===name);
    assert.equal(entry.status,'skipped',name);
    assert.equal(entry.reason,'Same source as get_nvd_cves: the NVD allows few requests',name);
  }
});

test('with Open OSINT offline, an Omega tool takes the NVD lookup instead of losing it',()=>{
  const plan=cvePlan(CVE_TOOLS.filter(item=>item.serverName==='Omega MCP'));
  const nvd=plan.selected.map(entry=>entry.tool.name).filter(name=>NVD_TOOLS.has(name));
  assert.equal(nvd.length,1,'still exactly one');
  assert.equal(nvd[0],'omega_cvssrank','the preferred fallback, which also brings EPSS and KEV');
});

test('tools on other sources are never limited by the NVD rule',()=>{
  const tools=[tool('get_whois','WHOIS registration for a domain'),tool('omega_whois','WHOIS lookup for a domain','Omega MCP')];
  const plan=explainSearchPlan({query:'example.com',intentId:'domain',preferredNames:['get_whois','omega_whois'],tools});
  assert.deepEqual(plan.selected.map(entry=>entry.tool.name).sort(),['get_whois','omega_whois']);
});
