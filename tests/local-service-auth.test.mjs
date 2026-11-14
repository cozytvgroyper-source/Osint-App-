import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the Open OSINT data-service preload requires the exact launch bearer token',async()=>{
  const token='test-local-service-token-that-is-long-enough';
  process.env.PUBLIC_DESK_TOKEN=token;
  const {authorized}=await import('../scripts/require-loopback-token.mjs');
  assert.equal(authorized(`Bearer ${token}`),true);
  assert.equal(authorized(''),false);
  assert.equal(authorized(`Bearer ${token}x`),false);
});

test('the Open OSINT MCP wrapper protects custom HTTP routes as well as MCP',async()=>{
  const wrapper=await readFile(new URL('../scripts/run-osint-mcp-guarded.py',import.meta.url),'utf8');
  assert.match(wrapper,/class LocalBearerAuthMiddleware/);
  assert.match(wrapper,/hmac\.compare_digest/);
  assert.match(wrapper,/Middleware\(LocalBearerAuthMiddleware/);
});

const T='test-local-service-token-that-is-long-enough';
const authOf=(init)=>new Headers(init?.headers).get('authorization');

test('a call the data service makes to itself carries the launch token',async()=>{
  process.env.PUBLIC_DESK_TOKEN=T;
  const {addSelfToken}=await import('../scripts/require-loopback-token.mjs');
  const opts={port:8080,token:T};
  for(const url of ['http://127.0.0.1:8080/api/rss-proxy?url=x','http://localhost:8080/api/x',new URL('http://127.0.0.1:8080/a')]){
    const init={headers:{accept:'text/xml'}};
    const out=addSelfToken(url,init,opts);
    assert.equal(authOf(out),`Bearer ${T}`);
    assert.equal(new Headers(out.headers).get('accept'),'text/xml');
    assert.equal(init.headers.authorization,undefined,'caller init is not mutated');
  }
  assert.equal(authOf(addSelfToken('http://127.0.0.1:8080/',new Headers({accept:'a'}),opts)),`Bearer ${T}`);
  assert.equal(authOf(addSelfToken('http://127.0.0.1:8080/',[['accept','a']],opts)),`Bearer ${T}`);
  assert.equal(authOf(addSelfToken('http://127.0.0.1:8080/',undefined,opts)),`Bearer ${T}`);
});

test('calls anywhere else never get the token',async()=>{
  const {addSelfToken}=await import('../scripts/require-loopback-token.mjs');
  const opts={port:8080,token:T};
  for(const url of ['https://feeds.bbci.co.uk/x','http://127.0.0.1:8892/mcp','https://127.0.0.1:8080/','http://evil.localhost:8080/','not a url']){
    const init={headers:{accept:'a'}};
    assert.equal(addSelfToken(url,init,opts),init);
    assert.equal(authOf(addSelfToken(url,undefined,opts)),null);
  }
});

test('an existing authorization header is kept',async()=>{
  const {addSelfToken}=await import('../scripts/require-loopback-token.mjs');
  const init={headers:{Authorization:'Bearer other'}};
  const out=addSelfToken('http://127.0.0.1:8080/',init,{port:8080,token:T});
  assert.equal(out,init);
  assert.equal(authOf(out),'Bearer other');
});
