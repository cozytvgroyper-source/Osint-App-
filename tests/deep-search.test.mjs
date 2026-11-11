import test from 'node:test';
import assert from 'node:assert/strict';
import {deepRunBlocked,deepSearchPlan} from '../public/deep-search.js';

const tool=(name,serverName='Omega MCP')=>({name,serverName,inputSchema:{type:'object',properties:{target:{type:'string'}},required:['target']}});
test('plans only reviewed tools at or below the selected level in a useful order',()=>{
  const plan=deepSearchPlan([tool('omega_vuln'),tool('omega_headers'),tool('omega_whois'),tool('unknown')],'example.com',1);
  assert.deepEqual(plan.map(item=>item.tool.name),['omega_whois','omega_headers']);
  assert.deepEqual(plan[0].args,{target:'example.com'});
});
test('requires explicit scope authorization and exact target text for Intrusive runs',()=>{
  assert.match(deepRunBlocked({target:'',level:1,authorization:true,selectedCount:1}),/target/);
  assert.match(deepRunBlocked({target:'example.com',level:2,authorization:false,selectedCount:1}),/permission/);
  assert.match(deepRunBlocked({target:'example.com',level:3,authorization:true,typedTarget:'wrong',selectedCount:1}),/example.com/);
  assert.equal(deepRunBlocked({target:'example.com',level:3,authorization:true,typedTarget:'example.com',selectedCount:2}),'');
});
