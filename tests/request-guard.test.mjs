import test from 'node:test';
import assert from 'node:assert/strict';
import {requestGuard} from '../server.mjs';

const ACCESS='test-access-token-that-is-at-least-thirty-two-bytes';
const guard=input=>requestGuard(input,ACCESS);
const guardError=input=>guard(input)?.error;

const request=({method='POST',path='/api/mcp',host='127.0.0.1:4173',headers={},authenticated=true}={})=>({
  method,url:new URL(`http://127.0.0.1:4173${path}`),
  headers:{host,...(method==='POST'?{'content-type':'application/json'}:{}),...(authenticated?{'x-public-desk-token':ACCESS}:{}),...headers}
});

test('allows the app\'s own requests',()=>{
  assert.equal(guard(request({headers:{origin:'http://127.0.0.1:4173','sec-fetch-site':'same-origin'}})),null);
  assert.equal(guard(request({host:'localhost:4173',headers:{origin:'http://localhost:4173'}})),null);
  assert.equal(guard(request({method:'GET',path:'/'})),null);
  assert.equal(guard(request()),null,'authenticated local tools without an Origin');
});

test('requires the private launch token on every API request',()=>{
  assert.match(guardError(request({authenticated:false})),/launcher/i);
  assert.match(guardError(request({authenticated:false,headers:{'x-public-desk-token':'wrong-token-that-is-at-least-thirty-two-bytes'}})),/launcher/i);
  assert.equal(guard(request({method:'GET',path:'/app.js',authenticated:false})),null,'static assets remain public');
  assert.equal(guard(request({method:'GET',path:'/api/oauth/consensus/callback?state=x&code=y',authenticated:false,headers:{'sec-fetch-site':'cross-site'}})),null,'the one-time OAuth callback remains state-protected');
});

test('rejects requests from other websites',()=>{
  assert.match(guardError(request({headers:{origin:'https://evil.example'}})),/origin/i);
  assert.match(guardError(request({headers:{origin:'null'}})),/origin/i);
  assert.match(guardError(request({headers:{'sec-fetch-site':'cross-site'}})),/site/i);
  assert.match(guardError(request({headers:{'sec-fetch-site':'same-site'}})),/site/i);
});

test('rejects API posts that are not JSON, which browsers can send cross-site without asking',()=>{
  assert.match(guardError(request({headers:{'content-type':'text/plain'}})),/json/i);
  assert.match(guardError({method:'POST',url:new URL('http://127.0.0.1:4173/api/upload'),headers:{host:'127.0.0.1:4173'}}),/json/i);
});

test('rejects a forged Host header (DNS rebinding) on every route',()=>{
  for(const [method,path] of [['GET','/'],['GET','/app.js'],['POST','/api/mcp'],['GET','/api/oauth/consensus/start']]){
    assert.match(guardError(request({method,path,host:'evil.example:4173'})),/host/i,`${method} ${path}`);
  }
  assert.match(guardError(request({host:'127.0.0.1:9999'})),/host/i);
});

test('only starts a Consensus sign-in from the app itself',()=>{
  const start=headers=>guardError(request({method:'POST',path:'/api/oauth/consensus/start',headers}));
  assert.equal(start({'sec-fetch-site':'same-origin'}),undefined);
  assert.equal(start({}),undefined,'older browsers without Sec-Fetch-Site');
  assert.match(start({'sec-fetch-site':'cross-site'}),/site/i);
});

test('lets Consensus redirect back to the sign-in callback',()=>{
  assert.equal(guard(request({method:'GET',path:'/api/oauth/consensus/callback?state=x&code=y',headers:{'sec-fetch-site':'cross-site'}})),null);
});

test('uses the right status codes',()=>{
  assert.equal(guard(request({headers:{origin:'https://evil.example'}})).status,403);
  assert.equal(guard(request({headers:{'content-type':'text/plain'}})).status,415);
});

test('lets the browser open Public Desk pages from anywhere, including after the Consensus sign-in',()=>{
  const navigate={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
  assert.equal(guard(request({method:'GET',path:'/?consensus=connected',headers:navigate})),null);
  assert.equal(guard(request({method:'GET',path:'/',headers:{...navigate,origin:'https://consensus.app'}})),null);
  assert.equal(guard(request({method:'GET',path:'/app.js',headers:{'sec-fetch-site':'cross-site'}})),null,'static files have no side effects; CORP stops other sites using them');
  assert.match(guardError(request({method:'GET',path:'/?x',host:'evil.example:4173'})),/host/i,'the Host check still applies');
});

test('still refuses cross-site GETs to the API',()=>{
  assert.match(guardError(request({method:'GET',path:'/api/oauth/consensus/start',headers:{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}})),/site/i);
});

test('makes room for a new sign-in instead of blocking when many are pending',async()=>{
  const {prunePendingSignIns}=await import('../server.mjs');
  const pending=new Map();const now=1_000_000;
  for(let i=0;i<25;i++){prunePendingSignIns(pending,now);pending.set(`s${i}`,{createdAt:now+i});}
  assert.ok(pending.size<=20);
  assert.ok(pending.has('s24'),'the newest sign-in is kept');
  pending.set('old',{createdAt:now-11*60_000});prunePendingSignIns(pending,now);
  assert.ok(!pending.has('old'),'expired sign-ins are removed');
});
