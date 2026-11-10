import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyToolResult,hasUsefulData} from '../public/result-classifier.js';

const text=value=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]});

test('treats MCP isError responses as errors, not findings',()=>{
  const outcome=classifyToolResult({...text("Unknown tool: 'omega_dorks'"),isError:true});
  assert.equal(outcome.kind,'error');
  assert.match(outcome.error,/Unknown tool/);
});

test('treats error-shaped text as an error',()=>{
  for(const message of ["No module named 'omega_cli'",'Error: ThreatFox export failed','HTTP 503 Service Unavailable','Traceback (most recent call last):\n  File "x.py"','Failed to fetch feed']){
    assert.equal(classifyToolResult(text(message)).kind,'error',message);
  }
});

test('treats status envelopes reporting failure as errors',()=>{
  const outcome=classifyToolResult(text({status:'error',error:'connection refused'}));
  assert.deepEqual(outcome,{kind:'error',error:'connection refused'});
  assert.equal(classifyToolResult(text({success:false,message:'quota exceeded'})).kind,'error');
  assert.equal(classifyToolResult(text({data:{error:'rate limited'}})).kind,'error');
});

test('treats an ok envelope with an empty result as empty',()=>{
  for(const result of [[],{},'','completed',null]){
    assert.equal(classifyToolResult(text({status:'ok',result})).kind,'empty',JSON.stringify(result));
  }
});

test('treats metadata-only payloads as empty',()=>{
  assert.equal(classifyToolResult(text({query:'example.com',target:'example.com',count:0,timestamp:'2026-11-10T00:00:00Z',items:[]})).kind,'empty');
});

test('keeps real findings and unwraps ok envelopes',()=>{
  const omega=classifyToolResult(text({status:'ok',result:{registrar:'Example Registrar'}}));
  assert.deepEqual(omega,{kind:'data',data:{registrar:'Example Registrar'}});
  const feed=classifyToolResult(text({data:{query:'cyber',items:[{title:'Advisory'}]}}));
  assert.deepEqual(feed,{kind:'data',data:{query:'cyber',items:[{title:'Advisory'}]}});
  assert.equal(classifyToolResult(text('Plain-language summary of three advisories.')).kind,'data');
});

test('does not mistake findings that mention errors for errors',()=>{
  assert.equal(classifyToolResult(text({items:[{title:'Error-handling flaw in OpenSSL',id:'CVE-2026-1'}]})).kind,'data');
});

test('hasUsefulData ignores status and echo fields',()=>{
  assert.equal(hasUsefulData({status:'ok',target:'x',success:true}),false);
  assert.equal(hasUsefulData({status:'ok',registrar:'X'}),true);
});
