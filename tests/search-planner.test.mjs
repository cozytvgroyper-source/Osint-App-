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

test('rejects tools whose required target type does not match the query',()=>{
  const domainTool={...tool('dnstwist_lookalike_domains','Find phishing lookalike domains','OSINT Toolbox'),inputSchema:{required:['domain'],properties:{domain:{type:'string'}}}};
  const newsTool=tool('get_cyber_news','Cybersecurity threat news');
  const plan=planSearchTools({query:'latest healthcare cyber threats',intentId:'cyber',preferredNames:['get_cyber_news'],tools:[domainTool,newsTool]});
  assert.deepEqual(plan.map(item=>item.tool.name),['get_cyber_news']);
});
