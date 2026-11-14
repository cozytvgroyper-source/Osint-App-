import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('with the preload loaded, the service can call itself and nothing else gets the token',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'preload-e2e-'));
  const script=join(dir,'service.mjs');
  // The other-port server is a raw net server: an http.Server would be locked by the preload before a handler could see headers.
  await writeFile(script,`
import http from 'node:http';
import net from 'node:net';
let otherAuth = null;
const other = net.createServer((socket) => {
  socket.on('data', (chunk) => {
    const m = /^authorization:\\s*(.*)$/im.exec(chunk.toString());
    otherAuth = m ? m[1].trim() : '';
    socket.end('HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\nok');
  });
});
const service = http.createServer(async (req, res) => {
  if (req.url === '/target') { res.end('ok'); return; }
  if (req.url === '/self') {
    const inner = await fetch('http://127.0.0.1:' + service.address().port + '/target');
    const o = await fetch('http://127.0.0.1:' + other.address().port + '/x');
    await o.text();
    res.end(JSON.stringify({ inner: inner.status, other: o.status, otherAuth }));
    return;
  }
  res.statusCode = 404; res.end();
});
// The service listens first: the preload records the first listening http.Server as the service's own port.
service.listen(0, '127.0.0.1', () => other.listen(0, '127.0.0.1', () => console.log('READY ' + service.address().port)));
`);
  const child=spawn(process.execPath,['--import',fileURLToPath(new URL('../scripts/require-loopback-token.mjs',import.meta.url)),script],{env:{...process.env,PUBLIC_DESK_TOKEN:T},stdio:['ignore','pipe','inherit']});
  try{
    const port=await new Promise((resolve,reject)=>{
      let out='';
      child.stdout.on('data',d=>{out+=d;const m=/READY (\d+)/.exec(out);if(m)resolve(Number(m[1]));});
      child.on('exit',c=>reject(new Error(`child exited early (${c})`)));
    });
    const base=`http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/target`)).status,401,'the lock still applies to outside callers');
    const res=await fetch(`${base}/self`,{headers:{authorization:`Bearer ${T}`}});
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.inner,200,'the service reached its own route with the token');
    assert.equal(body.other,200);
    assert.equal(body.otherAuth,'','the other-port server saw no Authorization header');
  }finally{
    child.kill();
    await rm(dir,{recursive:true,force:true});
  }
});
