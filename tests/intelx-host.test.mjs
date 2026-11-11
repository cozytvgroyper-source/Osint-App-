import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';

// Open OSINT's get_intelx always calls https://2.intelx.io, which answers 401 to free-tier keys; those only work on
// free.intelx.io. The preload sends 2.intelx.io requests to INTELX_API_ORIGIN (default https://free.intelx.io).
// These tests point INTELX_API_ORIGIN at a local server and report which path and key header arrived there.
const probe=`const [url,style]=process.argv.slice(1);
const init={method:'POST',headers:{'x-key':'test-key','Content-Type':'application/json'},body:'{"term":"example.com"}'};
if(style==='string')await fetch(url,init);
else if(style==='url')await fetch(new URL(url),init);
else if(style==='request')await fetch(new Request(url,init));`;

async function arrivedAt(fetchUrl,style,env){
  let seen=null;
  const server=http.createServer((req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{seen={path:req.url,key:req.headers['x-key'],method:req.method,body};res.end('{}');});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    const args=['--import',new URL('../scripts/intelx-host.mjs',import.meta.url).href,'--input-type=module','-e',probe,fetchUrl.replace('LOCAL',origin),style];
    const code=await new Promise(resolve=>{
      const child=spawn(process.execPath,args,{env:{...process.env,...env(origin)}});
      child.on('close',resolve);
    });
    return {seen,code};
  }finally{server.close();}
}

test('sends 2.intelx.io requests to the configured origin, keeping path, query, key and body',async()=>{
  for(const style of ['string','url','request']){
    const {seen}=await arrivedAt('https://2.intelx.io/intelligent/search/result?id=abc&limit=5',style,origin=>({INTELX_API_ORIGIN:origin}));
    assert.deepEqual(seen,{path:'/intelligent/search/result?id=abc&limit=5',key:'test-key',method:'POST',body:'{"term":"example.com"}'},style);
  }
});

test('leaves requests to other hosts alone',async()=>{
  const {seen}=await arrivedAt('LOCAL/other/path','string',()=>({INTELX_API_ORIGIN:'https://free.intelx.io'}));
  assert.equal(seen.path,'/other/path');
});

test('an origin that is not a plain https or http address is ignored',async()=>{
  const {seen}=await arrivedAt('LOCAL/kept','string',()=>({INTELX_API_ORIGIN:'javascript:alert(1)'}));
  assert.equal(seen.path,'/kept');
});
