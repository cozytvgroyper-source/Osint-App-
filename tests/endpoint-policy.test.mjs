import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchValidated, isPrivateAddress, validatedEndpoint } from '../scripts/endpoint-policy.mjs';

const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];

test('allows remote HTTPS endpoints only when every resolved address is public', async () => {
  assert.equal((await validatedEndpoint('https://example.com/mcp', { resolver: publicResolver })).hostname, 'example.com');
  await assert.rejects(()=>validatedEndpoint('https://example.com/mcp',{resolver:async()=>[{address:'10.0.0.4',family:4}]}),/blocked/);
  await assert.rejects(()=>validatedEndpoint('https://example.com/mcp',{resolver:async()=>[{address:'93.184.216.34',family:4},{address:'::1',family:6}]}),/blocked/);
});

test('classifies private, link-local, multicast, and mapped addresses', () => {
  for (const address of ['127.0.0.1','10.2.3.4','169.254.1.1','172.16.0.1','192.168.1.1','224.0.0.1','::1','fc00::1','fe80::1','ff02::1','::ffff:127.0.0.1']) assert.equal(isPrivateAddress(address),true,address);
  for (const address of ['93.184.216.34','8.8.8.8','2606:4700:4700::1111']) assert.equal(isPrivateAddress(address),false,address);
});

test('validates every redirect target before following it', async () => {
  let calls=0;
  const fetchImpl=async()=>{calls+=1;return new Response('',{status:307,headers:{location:'https://127.0.0.1/private'}});};
  await assert.rejects(()=>fetchValidated('https://example.com/mcp',{}, {resolver:publicResolver,fetchImpl}),/blocked/);
  assert.equal(calls,1);
});

test('follows a limited 307 redirect chain to another validated HTTPS endpoint', async () => {
  const seen=[];
  const fetchImpl=async url=>{seen.push(String(url));return seen.length===1?new Response('',{status:307,headers:{location:'https://example.net/mcp'}}):new Response('{}',{status:200});};
  const response=await fetchValidated('https://example.com/mcp',{}, {resolver:publicResolver,fetchImpl});
  assert.equal(response.status,200);
  assert.deepEqual(seen,['https://example.com/mcp','https://example.net/mcp']);
});

test('rejects redirects that would change POST semantics', async () => {
  const fetchImpl=async()=>new Response('',{status:302,headers:{location:'https://example.net/mcp'}});
  await assert.rejects(()=>fetchValidated('https://example.com/mcp',{}, {resolver:publicResolver,fetchImpl}),/unsupported redirect/);
});
