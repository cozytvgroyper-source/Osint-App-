import test from 'node:test';
import assert from 'node:assert/strict';
import { validatedEndpoint, parseMcpResponse, readLimitedResponse } from '../server.mjs';

test('accepts only explicitly bundled HTTP MCP endpoints',async()=>{
  assert.equal((await validatedEndpoint('http://127.0.0.1:8892/mcp')).pathname,'/mcp');
  await assert.rejects(()=>validatedEndpoint('http://127.0.0.1:9999/mcp'),/HTTPS/);
});
test('blocks embedded credentials and metadata endpoints',async()=>{
  await assert.rejects(()=>validatedEndpoint('https://user:pass@example.com/mcp'));
  await assert.rejects(()=>validatedEndpoint('https://169.254.169.254/latest'));
  await assert.rejects(()=>validatedEndpoint('https://metadata.google.internal./latest'));
});
test('parses JSON and SSE MCP responses',()=>{
  assert.deepEqual(parseMcpResponse('{"result":{"tools":[]}}','application/json'),{result:{tools:[]}});
  assert.deepEqual(parseMcpResponse('event: message\ndata: {"result":{"ok":true}}\n','text/event-stream'),{result:{ok:true}});
});

test('reads a normal MCP response below the byte limit',async()=>{
  const response=new Response('{"result":{"ok":true}}',{headers:{'content-type':'application/json'}});
  assert.equal(await readLimitedResponse(response,100),'{"result":{"ok":true}}');
});

test('rejects an oversized declared MCP response before reading it',async()=>{
  const response=new Response('small',{headers:{'content-length':'101'}});
  await assert.rejects(()=>readLimitedResponse(response,100),/exceeded/);
});

test('rejects a streamed MCP response that grows beyond the limit',async()=>{
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(80));controller.enqueue(new Uint8Array(30));controller.close();}});
  await assert.rejects(()=>readLimitedResponse(new Response(stream),100),/exceeded/);
});

test('bounds SSE event count and individual event size',()=>{
  assert.throws(()=>parseMcpResponse('data: {}\ndata: {}\n','text/event-stream',{maxSseEvents:1,maxSseEventBytes:100}),/too many events/);
  assert.throws(()=>parseMcpResponse(`data: {"value":"${'x'.repeat(40)}"}\n`,'text/event-stream',{maxSseEvents:10,maxSseEventBytes:20}),/oversized event/);
});

test('saves the Consensus sign-in privately and loads it back',async()=>{
  const {mkdtemp,stat,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {loadConsensusAuth,saveConsensusAuth,clearConsensusAuth}=await import('../server.mjs');
  const dir=await mkdtemp(join(tmpdir(),'pd-auth-'));const file=join(dir,'nested','consensus-auth.json');
  const auth={redirectUri:'http://127.0.0.1:4173/api/oauth/consensus/callback',client:{client_id:'abc'},refreshToken:'r1'};
  assert.equal(await loadConsensusAuth(file,auth.redirectUri),null);
  await saveConsensusAuth(file,auth);
  assert.equal((await stat(file)).mode&0o777,0o600);
  assert.equal((await stat(join(dir,'nested'))).mode&0o777,0o700);
  assert.deepEqual(await loadConsensusAuth(file,auth.redirectUri),auth);
  assert.equal(await loadConsensusAuth(file,'http://127.0.0.1:9999/api/oauth/consensus/callback'),null,'ignores a sign-in registered for another address');
  await clearConsensusAuth(file);
  assert.equal(await loadConsensusAuth(file,auth.redirectUri),null);
  await rm(dir,{recursive:true,force:true});
});

test('ignores a damaged or incomplete saved sign-in',async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {loadConsensusAuth}=await import('../server.mjs');
  const dir=await mkdtemp(join(tmpdir(),'pd-auth-'));const file=join(dir,'consensus-auth.json');const redirect='http://127.0.0.1:4173/api/oauth/consensus/callback';
  await writeFile(file,'{not json');
  assert.equal(await loadConsensusAuth(file,redirect),null);
  await writeFile(file,JSON.stringify({redirectUri:redirect,client:{},refreshToken:'r1'}));
  assert.equal(await loadConsensusAuth(file,redirect),null,'needs a client_id');
  await rm(dir,{recursive:true,force:true});
});

test('maps errors to HTTP statuses: refused address 400, missing file 404, anything else 502', async () => {
  const { errorStatus } = await import('../server.mjs');
  assert.equal(errorStatus(Object.assign(new Error('Custom MCP endpoints must use HTTPS'), { code: 'ENDPOINT_POLICY' })), 400);
  assert.equal(errorStatus(Object.assign(new Error('missing'), { code: 'ENOENT' })), 404);
  assert.equal(errorStatus(Object.assign(new Error('run grant required'), { code: 'RUN_GRANT', status: 403 })), 403);
  assert.equal(errorStatus(Object.assign(new Error('bad audit'), { code: 'AUDIT_INPUT' })), 400);
  assert.equal(errorStatus(Object.assign(new Error('bad name'), { code: 'CASE_INPUT' })), 400);
  assert.equal(errorStatus(Object.assign(new Error('gone'), { code: 'CASE_NOT_FOUND' })), 404);
  assert.equal(errorStatus(Object.assign(new Error('too big'), { code: 'CASE_TOO_LARGE' })), 413);
  assert.equal(errorStatus(Object.assign(new Error('damaged'), { code: 'CASE_DAMAGED' })), 422);
  assert.equal(errorStatus(new Error('MCP server returned 500')), 502);
});
