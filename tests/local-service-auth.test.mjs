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
