import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRunGrantRequest,grantTarget} from '../public/run-grant-client.js';

test('chooses a useful target field before unrelated arguments',()=>{
  assert.equal(grantTarget({follow:true,domain:'example.com'}),'example.com');
  assert.equal(grantTarget({url:'https://example.com/path',query:'later'}),'https://example.com/path');
  assert.equal(grantTarget({},'omega_headers'),'omega_headers');
});

test('builds an exact Tool Library grant request',()=>{
  const request=buildRunGrantRequest({
    tool:{name:'omega_headers',risk:{level:1}},
    server:{endpoint:'http://127.0.0.1:8894/mcp'},
    args:{target:'example.com',follow:false},
    confirmation:{acknowledged:true}
  });
  assert.deepEqual(request,{purpose:'tool-library',target:'example.com',level:1,tools:[{endpoint:'http://127.0.0.1:8894/mcp',name:'omega_headers',arguments:{target:'example.com',follow:false}}],confirmation:{acknowledged:true}});
});
