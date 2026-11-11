import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';

// rdap.org answers HTTP 403 to Node's default User-Agent ("node"), which is why Open OSINT's get_whois failed.
// A child process fetches from a local server, with and without the preload, and the server records the
// User-Agent it received.
const probe=`const [url,style]=process.argv.slice(1);
if(style==='plain')await fetch(url);
else if(style==='own')await fetch(url,{headers:{'User-Agent':'ModuleOwn/2.0'}});
else if(style==='own-lowercase')await fetch(url,{headers:[['user-agent','ModuleOwn/2.0']]});
else if(style==='request')await fetch(new Request(url,{headers:{'User-Agent':'FromRequest/3.0'}}));
else if(style==='other-headers')await fetch(url,{headers:{Accept:'application/json'}});`;

async function userAgentSeen(style,preload){
  let seen; let accept;
  const server=http.createServer((req,res)=>{seen=req.headers['user-agent'];accept=req.headers.accept;res.end('ok');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url=`http://127.0.0.1:${server.address().port}/`;
    const args=[...(preload?['--import',new URL('../scripts/default-user-agent.mjs',import.meta.url).href]:[]),'--input-type=module','-e',probe,url,style];
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,args);let err='';
      child.stderr.on('data',d=>err+=d);
      child.on('close',code=>code===0?resolve():reject(new Error(err)));
    });
    return {userAgent:seen,accept};
  }finally{server.close();}
}

test('without the preload, fetch sends "node", which rdap.org refuses',async()=>{
  assert.equal((await userAgentSeen('plain',false)).userAgent,'node');
});

test('with the preload, a request that sets no User-Agent gets a descriptive one',async()=>{
  assert.match((await userAgentSeen('plain',true)).userAgent,/^PublicDesk\//);
});

test('a User-Agent the module chose on purpose is left alone',async()=>{
  assert.equal((await userAgentSeen('own',true)).userAgent,'ModuleOwn/2.0');
  assert.equal((await userAgentSeen('own-lowercase',true)).userAgent,'ModuleOwn/2.0');
  assert.equal((await userAgentSeen('request',true)).userAgent,'FromRequest/3.0');
});

test('the request keeps its other headers',async()=>{
  const seen=await userAgentSeen('other-headers',true);
  assert.equal(seen.accept,'application/json');
  assert.match(seen.userAgent,/^PublicDesk\//);
});
