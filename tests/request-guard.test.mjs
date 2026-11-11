import test from 'node:test';
import assert from 'node:assert/strict';
import {requestGuard} from '../server.mjs';

const guardError=input=>requestGuard(input)?.error;

const request=({method='POST',path='/api/mcp',host='127.0.0.1:4173',headers={}}={})=>({
  method,url:new URL(`http://127.0.0.1:4173${path}`),
  headers:{host,...(method==='POST'?{'content-type':'application/json'}:{}),...headers}
});

test('allows the app\'s own requests',()=>{
  assert.equal(requestGuard(request({headers:{origin:'http://127.0.0.1:4173','sec-fetch-site':'same-origin'}})),null);
  assert.equal(requestGuard(request({host:'localhost:4173',headers:{origin:'http://localhost:4173'}})),null);
  assert.equal(requestGuard(request({method:'GET',path:'/'})),null);
  assert.equal(requestGuard(request()),null,'local tools without an Origin, such as curl');
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
  const start=headers=>guardError(request({method:'GET',path:'/api/oauth/consensus/start',headers}));
  assert.equal(start({'sec-fetch-site':'same-origin'}),undefined);
  assert.equal(start({}),undefined,'older browsers without Sec-Fetch-Site');
  assert.match(start({'sec-fetch-site':'cross-site'}),/site/i);
});

test('lets Consensus redirect back to the sign-in callback',()=>{
  assert.equal(requestGuard(request({method:'GET',path:'/api/oauth/consensus/callback?state=x&code=y',headers:{'sec-fetch-site':'cross-site'}})),null);
});

test('uses the right status codes',()=>{
  assert.equal(requestGuard(request({headers:{origin:'https://evil.example'}})).status,403);
  assert.equal(requestGuard(request({headers:{'content-type':'text/plain'}})).status,415);
});
