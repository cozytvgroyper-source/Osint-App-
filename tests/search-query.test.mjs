import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {argsForSearch,extractTarget,searchIntent} from '../public/search-query.js';
import {planSearchTools} from '../public/search-planner.js';

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

test('real searches still reach the right sources',()=>{
  const names=query=>plan(query).map(item=>item.tool.name);
  assert.ok(names('example.com whois').includes('get_whois'));
  assert.ok(names('jane.doe@example.com breach').includes('holehe_email_search'));
  assert.ok(names('8.8.8.8 abuse reports').includes('get_bgp'));
  assert.ok(names('sanctions Rosneft').includes('get_opensanctions'));
  assert.deepEqual(new Set(names('latest healthcare cyber threats')),new Set(['get_cyber_news','get_threatfox','get_ransomware','get_cyber_threats']));
});

test('never auto-selects tools that probe the target, such as DNS zone transfers',()=>{
  for(const query of ['example.com whois','example.com','https://example.com/login']){
    assert.ok(!plan(query).some(item=>item.tool.name==='dnsrecon_domain_scan'),query);
  }
});

test('request words like "reports" do not pull in unrelated tools',()=>{
  assert.ok(!plan('8.8.8.8 abuse reports').some(item=>item.tool.name==='get_food_security'));
});

test('skips enumeration tools too slow for the automatic search',()=>{
  const names=plan('example.com whois').map(item=>item.tool.name);
  for(const name of ['subfinder_subdomain_search','theharvester_domain_search'])assert.ok(!names.includes(name),names.join(', '));
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
