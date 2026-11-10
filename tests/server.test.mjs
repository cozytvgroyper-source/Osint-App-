import test from 'node:test';
import assert from 'node:assert/strict';
import { validatedEndpoint, parseMcpResponse } from '../server.mjs';

test('accepts HTTP MCP endpoints',()=>assert.equal(validatedEndpoint('http://127.0.0.1:8892/mcp').pathname,'/mcp'));
test('blocks embedded credentials and metadata endpoints',()=>{
  assert.throws(()=>validatedEndpoint('http://user:pass@example.com/mcp'));
  assert.throws(()=>validatedEndpoint('http://169.254.169.254/latest'));
});
test('parses JSON and SSE MCP responses',()=>{
  assert.deepEqual(parseMcpResponse('{"result":{"tools":[]}}','application/json'),{result:{tools:[]}});
  assert.deepEqual(parseMcpResponse('event: message\ndata: {"result":{"ok":true}}\n','text/event-stream'),{result:{ok:true}});
});
