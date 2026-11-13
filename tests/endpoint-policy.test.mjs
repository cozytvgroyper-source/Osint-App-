import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchValidated, isPrivateAddress, pinnedFetch, validatedEndpoint } from '../scripts/endpoint-policy.mjs';

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

test('follows a limited 307 redirect chain within the same site, keeping the request', async () => {
  const seen=[];
  const fetchImpl=async(url,options)=>{seen.push([String(url),options.headers?.authorization,options.body]);return seen.length===1?new Response('',{status:307,headers:{location:'/mcp/'}}):new Response('{}',{status:200});};
  const response=await fetchValidated('https://example.com/mcp',{method:'POST',headers:{authorization:'Bearer USER_SECRET'},body:'{"q":1}'}, {resolver:publicResolver,fetchImpl});
  assert.equal(response.status,200);
  assert.deepEqual(seen,[['https://example.com/mcp','Bearer USER_SECRET','{"q":1}'],['https://example.com/mcp/','Bearer USER_SECRET','{"q":1}']]);
});

// A redirect to another site would carry the user's token and the search itself there, so it is never followed.
test('refuses redirects to a different site without sending anything there', async () => {
  for (const location of ['https://collector.example.net/mcp','https://example.com:8443/mcp','http://example.com/mcp','http://127.0.0.1:8892/mcp']) {
    const seen=[];
    const fetchImpl=async url=>{seen.push(String(url));return new Response('',{status:307,headers:{location}});};
    await assert.rejects(
      ()=>fetchValidated('https://example.com/mcp',{method:'POST',headers:{authorization:'Bearer USER_SECRET'},body:'{"q":1}'},{resolver:publicResolver,fetchImpl}),
      error=>/different site/.test(error.message)&&error.message.includes(new URL(location).origin),
      location);
    assert.deepEqual(seen,['https://example.com/mcp'],location);
  }
});

test('rejects redirects that would change POST semantics', async () => {
  const fetchImpl=async()=>new Response('',{status:302,headers:{location:'https://example.net/mcp'}});
  await assert.rejects(()=>fetchValidated('https://example.com/mcp',{}, {resolver:publicResolver,fetchImpl}),/unsupported redirect/);
});

// Refused addresses are the caller's mistake, so the server answers 400, not 502 (an upstream failure).
test('marks refused addresses as endpoint-policy errors', async () => {
  for (const endpoint of ['http://example.com/mcp', 'ftp://example.com/mcp', 'https://user:pass@example.com/mcp']) {
    await assert.rejects(() => validatedEndpoint(endpoint, { resolver: publicResolver }), error => error.code === 'ENDPOINT_POLICY', endpoint);
  }
  await assert.rejects(() => validatedEndpoint('https://example.com/mcp', { resolver: async () => [{ address: '10.0.0.4', family: 4 }] }), error => error.code === 'ENDPOINT_POLICY');
});

// DNS can answer differently between the address check and the connection (DNS rebinding). The request must go to
// the address that passed the check, never to a second lookup.
test('connects to the address that passed the check',async()=>{
  let lookups=0;
  const rebinding=async()=>{lookups+=1;return lookups===1?[{address:'93.184.216.34',family:4}]:[{address:'127.0.0.1',family:4}];};
  const pins=[];
  const fetchImpl=async(url,options,pin)=>{pins.push(pin);return new Response('ok',{status:200});};
  const response=await fetchValidated('https://example.com/mcp',{},{resolver:rebinding,fetchImpl});
  assert.equal(await response.text(),'ok');
  assert.equal(lookups,1,'one lookup per hop');
  assert.deepEqual(pins,[{address:'93.184.216.34',family:4}]);
});

test('bundled local servers need no pinning',async()=>{
  const pins=[];
  await fetchValidated('http://127.0.0.1:8892/mcp',{},{resolver:async()=>{throw new Error('no lookup expected');},fetchImpl:async(url,options,pin)=>{pins.push(pin);return new Response('',{status:200});}});
  assert.deepEqual(pins,[null]);
});

test('a pinned request reaches the pinned address and keeps the URL host',async()=>{
  const http=await import('node:http');
  const server=http.createServer((req,res)=>{res.setHeader('x-seen-host',req.headers.host);res.end(JSON.stringify({ok:true}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const {port}=server.address();
    const response=await pinnedFetch(new URL(`http://rebind.example:${port}/mcp`),{method:'POST',headers:{'content-type':'application/json'},body:'{}'},{address:'127.0.0.1',family:4});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('x-seen-host'),`rebind.example:${port}`);
    assert.deepEqual(await response.json(),{ok:true});
  }finally{server.close();}
});
