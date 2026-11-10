import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {explainSearchPlan,planSearchTools,summarizePlanDiagnostics} from '../public/search-planner.js';
import {searchIntent} from '../public/search-query.js';

const tools=JSON.parse(fs.readFileSync(new URL('./fixtures/mcp-tools.json',import.meta.url),'utf8'));
const explain=query=>{const found=searchIntent(query);return explainSearchPlan({query,intentId:found.id,preferredNames:found.tools,tools,maxTools:6});};
const entry=(explained,name)=>explained.entries.find(item=>item.tool.name===name);

test('explains every connected tool and agrees with the real selection',()=>{
  const query='example.com whois';const found=searchIntent(query);
  const explained=explain(query);
  assert.equal(explained.entries.length,tools.length);
  const selected=explained.entries.filter(item=>item.status==='selected').map(item=>item.tool.name);
  assert.deepEqual(selected,planSearchTools({query,intentId:found.id,preferredNames:found.tools,tools,maxTools:6}).map(item=>item.tool.name));
  assert.ok(explained.entries.every(item=>item.reason),'every tool has a reason');
});

test('gives the specific reason a tool was skipped',()=>{
  const explained=explain('example.com whois');
  assert.equal(entry(explained,'dnsrecon_domain_scan').reason,'Active or side-effect tool (never auto-run)');
  assert.equal(entry(explained,'subfinder_subdomain_search').reason,'Too slow for automatic search (Tool Library only)');
  assert.equal(entry(explained,'omega_ports').reason,'Active or side-effect tool (never auto-run)');
  assert.equal(entry(explained,'omega_aisummary').reason,'Omega tool not reviewed for automatic search');
  assert.equal(entry(explained,'holehe_email_search').reason,'Needs an email address');
  assert.equal(entry(explained,'get_energy_commodities_news').reason,'No match with the search words');
});

test('reports tools that matched but lost on score',()=>{
  const explained=explain('example.com');
  assert.ok(explained.entries.some(item=>item.status==='skipped'&&/^Lower score than the 6 selected tools$|^Server already has 4 selected tools$/.test(item.reason)));
});

test('summarizes diagnostics for display without listing all 240 tools',()=>{
  const summary=summarizePlanDiagnostics(explain('example.com whois'),{nearMisses:5});
  assert.equal(summary.target,'domain: example.com');
  assert.match(summary.searchWords,/whois/);
  assert.doesNotMatch(summary.searchWords,/\bcom\b/);
  assert.equal(summary.selected.length,6);
  assert.ok(summary.selected.every(item=>item.name&&item.server&&typeof item.score==='number'&&item.reason));
  assert.ok(summary.nearMisses.length<=5);
  assert.equal(summary.skippedBecause.reduce((total,item)=>total+item.tools,0),tools.length-6);
  assert.deepEqual(summary.skippedBecause.map(item=>item.tools),[...summary.skippedBecause.map(item=>item.tools)].sort((a,b)=>b-a));
});
