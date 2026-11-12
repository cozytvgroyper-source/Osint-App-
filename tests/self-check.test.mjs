import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SELF_CHECK_TARGETS,selfCheckPlan,summarizeSelfCheck} from '../public/self-check.js';
import {toolRisk} from '../public/tool-tiers.js';
import {isPassiveSearchTool} from '../public/search-planner.js';

const tools=JSON.parse(fs.readFileSync(new URL('./fixtures/mcp-tools.json',import.meta.url),'utf8')).map(t=>({...t,serverId:t.serverId||t.serverName}));

test('uses only reserved or public test targets, one per target type',()=>{
  assert.deepEqual(SELF_CHECK_TARGETS.map(t=>t.query),['example.com','8.8.8.8','user@example.com','@octocat','CVE-2021-44228','44d88612fea8a8f36de82e1278abb02f']);
});

test('checks the tools the automatic search uses, each once, and only passive, unflagged, read-only ones',()=>{
  const plan=selfCheckPlan(tools);
  assert.ok(plan.length>=15,`a useful number of tools (${plan.length})`);
  assert.equal(new Set(plan.map(item=>`${item.tool.serverName}/${item.tool.name}`)).size,plan.length,'no tool twice');
  for(const item of plan){
    assert.equal(toolRisk(item.tool).level,0,item.tool.name);
    assert.deepEqual(toolRisk(item.tool).flags,[],item.tool.name);
    assert.ok(isPassiveSearchTool(item.tool),item.tool.name);
    assert.notEqual(item.tool.annotations?.readOnlyHint,false,item.tool.name);
    assert.ok(SELF_CHECK_TARGETS.some(t=>t.query===item.target),item.target);
  }
  const names=plan.map(item=>item.tool.name);
  for(const expected of ['whois_lookup','get_bgp','omega_ipdossier','holehe_email_search','get_nvd_cves','get_malwarebazaar'])assert.ok(names.includes(expected),expected);
});

test('summarizes outcomes for the panel',()=>{
  const summary=summarizeSelfCheck([{outcome:'working'},{outcome:'working'},{outcome:'empty'},{outcome:'failing'}]);
  assert.deepEqual(summary,{total:4,working:2,empty:1,failing:1,label:'4 tools checked · 2 working · 1 returned nothing · 1 failing'});
});
