import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {argsForSearch,extractTarget,searchIntent,searchSubjectFor} from '../public/search-query.js';
import {isPassiveSearchTool,planSearchTools} from '../public/search-planner.js';

// Real tool definitions captured from the bundled Open OSINT, OSINT Toolbox and Omega servers.
const tools=JSON.parse(fs.readFileSync(new URL('./fixtures/mcp-tools.json',import.meta.url),'utf8'));
const byName=name=>{const found=tools.find(tool=>tool.name===name);assert.ok(found,`fixture is missing ${name}`);return found;};
const plan=query=>{const found=searchIntent(query);return planSearchTools({query,intentId:found.id,preferredNames:found.tools,tools,maxTools:6});};

test('extracts the target from surrounding words',()=>{
  assert.deepEqual(extractTarget('example.com whois'),{type:'domain',value:'example.com'});
  assert.deepEqual(extractTarget('https://www.example.com/login?next=1'),{type:'domain',value:'www.example.com'});
  assert.deepEqual(extractTarget('8.8.8.8 abuse reports'),{type:'ip',value:'8.8.8.8'});
  assert.deepEqual(extractTarget('jane.doe@example.com breach'),{type:'email',value:'jane.doe@example.com'});
  assert.deepEqual(extractTarget('@jack username'),{type:'username',value:'jack'});
  assert.deepEqual(extractTarget('username: jack_smith'),{type:'username',value:'jack_smith'});
  assert.deepEqual(extractTarget('cve-2021-44228 exploitation'),{type:'cve',value:'CVE-2021-44228'});
  assert.equal(extractTarget('999.1.1.1')?.type,undefined);
  assert.equal(extractTarget('latest healthcare cyber threats'),null);
});

test('chooses the intent from the target even with extra words',()=>{
  assert.equal(searchIntent('8.8.8.8 abuse reports').id,'network');
  assert.equal(searchIntent('jane.doe@example.com breach').id,'email');
  assert.equal(searchIntent('@jack username').id,'username');
  assert.equal(searchIntent('example.com whois').id,'domain');
});

test('recognises plural topic words',()=>{
  assert.equal(searchIntent('sanctions Rosneft').id,'sanctions');
  assert.equal(searchIntent('recent earthquakes in Chile').id,'hazard');
  assert.equal(searchIntent('vessels near Hormuz').id,'maritime');
});

test('sends only the target to tools, not the surrounding words',()=>{
  assert.deepEqual(argsForSearch(byName('get_whois'),'example.com whois').query,'example.com');
  assert.deepEqual(argsForSearch(byName('dnstwist_lookalike_domains'),'https://example.com/login').domain,'example.com');
  assert.deepEqual(argsForSearch(byName('sherlock_username_search'),'@jack username').username,'jack');
  assert.deepEqual(argsForSearch(byName('holehe_email_search'),'jane.doe@example.com breach').email,'jane.doe@example.com');
});

// Open OSINT's `search` keeps only items containing the whole value, so a phrase like
// "earthquakes in Chile" matches nothing; send the subject the topic words are about.
test('sends a targetless search without its topic words',()=>{
  const sent=(name,query)=>{const args=argsForSearch(byName(name),query);return args.query??args.search;};
  assert.equal(sent('get_opensanctions','sanctions Rosneft'),'Rosneft');
  assert.equal(sent('get_sanctions','Rosneft sanctions'),'Rosneft');
  assert.equal(sent('get_opensanctions','OFAC sanctions on Rosneft'),'Rosneft');
  assert.equal(sent('get_earthquakes','recent earthquakes in Chile'),'Chile');
  assert.equal(sent('get_maritime_news','vessels near Hormuz'),'Hormuz');
  assert.equal(sent('get_cyber_news','latest healthcare cyber threats'),'healthcare');
  assert.equal(sent('get_ransomware','ransomware LockBit'),'LockBit');
  assert.equal(sent('get_arxiv','research papers on transformers'),'transformers');
  assert.equal(sent('get_crypto','bitcoin price'),'bitcoin');
  assert.equal(sent('get_wikidata','Gazprom company'),'Gazprom');
  assert.equal(sent('get_election_monitor','election Moldova'),'Moldova');
});

test('keeps names whole and never sends an empty subject',()=>{
  const sent=(name,query)=>{const args=argsForSearch(byName(name),query);return args.query??args.search;};
  assert.equal(sent('get_opensanctions','Bank of America sanctions'),'Bank of America');
  assert.equal(sent('get_opensanctions','sanctions'),'sanctions');
  assert.equal(sent('get_news_rss','Rosneft'),'Rosneft');
  assert.equal(argsForSearch(byName('get_country_facts'),'Lyon, France').query,'France');
});

test('domain and email fragments no longer pull in unrelated tools',()=>{
  const unrelated=['get_energy_commodities_news','get_trade_comtrade'];
  for(const query of ['example.com whois','example.com','jane.doe@example.com']){
    const names=plan(query).map(item=>item.tool.name);
    for(const name of unrelated)assert.ok(!names.includes(name),`${query} selected ${name}: ${names.join(', ')}`);
  }
});

test('file hashes select hash lookup sources, not hashrate or generic malware-reference tools',()=>{
  const names=plan('44d88612fea8a8f36de82e1278abb02f').map(item=>item.tool.name);
  for(const expected of ['get_malwarebazaar','omega_malware'])assert.ok(names.includes(expected),`${expected}: ${names.join(', ')}`);
  for(const unrelated of ['get_bitcoin_hashrate','get_mitre_attack','get_sslbl'])assert.ok(!names.includes(unrelated),`${unrelated}: ${names.join(', ')}`);
  assert.ok(plan('cf4b79e0bc79d2e14cdd7f49b475e62213c36c88').some(item=>item.tool.name==='get_sslbl'),'SSLBL remains available for SHA-1 certificate fingerprints');
});

test('real searches still reach the right sources',()=>{
  const names=query=>plan(query).map(item=>item.tool.name);
  assert.ok(names('example.com whois').includes('get_whois'));
  assert.ok(names('jane.doe@example.com breach').includes('holehe_email_search'));
  assert.ok(names('8.8.8.8 abuse reports').includes('get_bgp'));
  assert.ok(names('sanctions Rosneft').includes('get_opensanctions'));
  assert.deepEqual(new Set(names('latest healthcare cyber threats')),new Set(['get_cyber_news','get_threatfox','get_ransomware','get_cyber_threats']));
});

test('reviewed Omega identity sources join email and username searches',()=>{
  assert.ok(searchIntent('user@example.com').tools.includes('omega_email'));
  assert.ok(searchIntent('@octocat').tools.includes('omega_gitrecon'));
  assert.ok(searchIntent('8.8.8.8').tools.includes('omega_ipdossier'));
  assert.ok(searchIntent('example.com').tools.includes('omega_intel'));
  assert.ok(searchIntent('8.8.8.8').tools.includes('omega_intel'));
  assert.ok(searchIntent('CVE-2021-44228').tools.includes('omega_cvssrank'));
  assert.ok(!searchIntent('dns records').tools.includes('omega_intel'),'keyword searches have no indicator to look up');
});

test('never auto-selects tools that probe the target, such as DNS zone transfers',()=>{
  for(const query of ['example.com whois','example.com','https://example.com/login']){
    assert.ok(!plan(query).some(item=>item.tool.name==='dnsrecon_domain_scan'),query);
  }
});

test('request words like "reports" do not pull in unrelated tools',()=>{
  assert.ok(!plan('8.8.8.8 abuse reports').some(item=>item.tool.name==='get_food_security'));
});

// Timed on 2026-11-11: subfinder took 31-58 s whatever its per-request timeout (the wrapper has no total
// limit), so it stays in Tool Library. theHarvester took 223 s with every source, 11-20 s with the sources below.
test('skips subfinder, which no argument keeps under the 45 s request limit',()=>{
  assert.equal(isPassiveSearchTool(byName('subfinder_subdomain_search')),false);
  assert.ok(!plan('example.com whois').some(item=>item.tool.name==='subfinder_subdomain_search'));
});

test('skips Maigret, which exceeds the automatic search request limit',()=>{
  assert.equal(isPassiveSearchTool(byName('maigret_username_search')),false);
  assert.ok(!plan('@octocat').some(item=>item.tool.name==='maigret_username_search'));
});

test('uses an output format the selected tool actually supports',()=>{
  assert.equal(argsForSearch(byName('sherlock_username_search'),'@octocat').output_format,'txt');
});

test('lets theHarvester run automatically, limited to fast keyless sources',()=>{
  assert.equal(isPassiveSearchTool(byName('theharvester_domain_search')),true);
  assert.deepEqual(argsForSearch(byName('theharvester_domain_search'),'example.com emails'),
    {domain:'example.com',limit:10,sources:'crtsh,hackertarget,rapiddns,otx'});
});

// get_ais_vessels, get_aircraft and get_satellite_search require bbox as four numbers, each in the order its
// description gives (aircraft: south,west,north,east). Words such as "near" or "over" are not a map area.
test('map-area tools run only when the search gives coordinates',()=>{
  const names=query=>plan(query).map(item=>item.tool.name);
  assert.ok(!names('vessels near Hormuz').includes('get_ais_vessels'));
  assert.ok(!names('flights over Ukraine').includes('get_aircraft'));
  assert.ok(names('vessels 24,54,26,56').includes('get_ais_vessels'));
  assert.ok(names('flights over 44.0, 22.1, 52.4, 40.2').includes('get_aircraft'));
});

test('sends the coordinates, not the search words, as the map area',()=>{
  assert.equal(argsForSearch(byName('get_ais_vessels'),'vessels 24,54,26,56').bbox,'24,54,26,56');
  assert.equal(argsForSearch(byName('get_aircraft'),'flights over 44.0, 22.1, 52.4, 40.2 region').bbox,'44.0,22.1,52.4,40.2');
  // Its `search` would keep only items containing the words, which would hide every position.
  assert.equal(argsForSearch(byName('get_ais_vessels'),'vessels 24,54,26,56').search,undefined);
});

test('other tools in the same search do not filter on the coordinates',()=>{
  assert.equal(argsForSearch(byName('get_chokepoints'),'vessels 24,54,26,56').search,'vessels');
  assert.equal(argsForSearch(byName('get_maritime_news'),'Hormuz vessels 24,54,26,56').search,'Hormuz');
});

test('the ranking subject is the target, or the phrase without its topic and framing words',()=>{
  assert.equal(searchSubjectFor('OFAC sanctions on Rosneft'),'Rosneft');
  assert.equal(searchSubjectFor('recent earthquakes in Chile'),'Chile');
  assert.equal(searchSubjectFor('example.com whois'),'example.com');
  assert.equal(searchSubjectFor('8.8.8.8 abuse reports'),'8.8.8.8');
  assert.equal(searchSubjectFor('sanctions'),'sanctions');
});

test('website names with accented letters are read whole, in the form browsers send',()=>{
  assert.deepEqual(extractTarget('münchen.de whois'),{type:'domain',value:'xn--mnchen-3ya.de'});
  assert.deepEqual(extractTarget('bücher.de'),{type:'domain',value:'xn--bcher-kva.de'});
  assert.deepEqual(extractTarget('https://bücher.de/katalog'),{type:'domain',value:'xn--bcher-kva.de'});
  assert.deepEqual(extractTarget('café.example.com'),{type:'domain',value:'xn--caf-dma.example.com'});
  assert.deepEqual(extractTarget('owner@bücher.de breach'),{type:'email',value:'owner@xn--bcher-kva.de'});
  assert.deepEqual(argsForSearch(byName('whois_lookup'),'münchen.de whois'),{query:'xn--mnchen-3ya.de'});
  for(const query of ['münchen.de','bücher.de','Ñandú.com'])
    assert.ok(!/^(?:nchen|cher|and)/.test(extractTarget(query)?.value||''),query);
});

// ---- Minor review fixes: input recognition ----

test('IPv6 addresses are IP targets, alone, with words, or inside a web address',()=>{
  assert.deepEqual(extractTarget('2001:4860:4860::8888'),{type:'ip',value:'2001:4860:4860::8888'});
  assert.deepEqual(extractTarget('2001:DB8::1 whois'),{type:'ip',value:'2001:db8::1'});
  assert.deepEqual(extractTarget('https://[2001:db8::1]:8443/x'),{type:'ip',value:'2001:db8::1'});
  assert.deepEqual(extractTarget('::ffff:192.0.2.10'),{type:'ip',value:'::ffff:c000:20a'});
  assert.equal(searchIntent('2001:4860:4860::8888').id,searchIntent('8.8.8.8').id);
  for(const notIp of ['12:30','a:b:c','::','1:2:3:4:5:6:7:8:9'])assert.notEqual(extractTarget(notIp)?.type,'ip',notIp);
});

test('dates, version numbers and invalid IPs are not phone numbers',()=>{
  for(const query of ['2024-01-15','10.0.0.256','1.2.3.4.5','2024.01.15'])assert.notEqual(extractTarget(query)?.type,'phone',query);
  assert.notEqual(searchIntent('2024-01-15').id,'phone');
  assert.deepEqual(extractTarget('+44 20 7946 0958'),{type:'phone',value:'+44 20 7946 0958'});
});

test('an email right after a colon or equals sign is still found',()=>{
  assert.deepEqual(extractTarget('email:owner@example.com'),{type:'email',value:'owner@example.com'});
  assert.deepEqual(extractTarget('mailto:owner@example.com'),{type:'email',value:'owner@example.com'});
  assert.deepEqual(extractTarget('user=owner@example.com'),{type:'email',value:'owner@example.com'});
});
