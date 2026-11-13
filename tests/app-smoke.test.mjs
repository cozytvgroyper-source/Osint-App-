import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fileURLToPath(new URL('..',import.meta.url));

async function availablePort(){
  const server=net.createServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}

async function waitFor(url){
  for(let attempt=0;attempt<50;attempt++){
    try{const response=await fetch(url);if(response.ok)return response;}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error(`Server did not start at ${url}`);
}

test('serves the UI while refusing unauthenticated API calls end to end',async()=>{
  const port=await availablePort();
  const token='integration-access-token-that-is-at-least-thirty-two-bytes';
  // A fresh working folder, so the test never reads or writes the owner's real work/ data.
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-smoke-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),PUBLIC_DESK_TOKEN:token,PUBLIC_DESK_WORK_DIR:work},stdio:['ignore','pipe','pipe']});
  const uploadIds=[];
  try{
    const base=`http://127.0.0.1:${port}`;
    const page=await waitFor(`${base}/`);
    assert.match(await page.text(),/Public Desk/);
    const unauthorized=await fetch(`${base}/api/cases`);
    assert.equal(unauthorized.status,401);
    const wrong=await fetch(`${base}/api/mcp/disconnect`,{method:'POST',headers:{'content-type':'application/json','x-public-desk-token':'wrong-token-that-is-at-least-thirty-two-bytes'},body:'{"sessionKey":"smoke"}'});
    assert.equal(wrong.status,401);
    const authorized=await fetch(`${base}/api/mcp/disconnect`,{method:'POST',headers:{'content-type':'application/json','x-public-desk-token':token},body:'{"sessionKey":"smoke"}'});
    assert.equal(authorized.status,200);
    assert.deepEqual(await authorized.json(),{disconnected:true});
    for(let index=0;index<8;index++){
      const upload=await fetch(`${base}/api/upload`,{method:'POST',headers:{'content-type':'application/json','x-public-desk-token':token},body:JSON.stringify({name:`smoke-${index}.txt`,type:'text/plain',data:'data:text/plain;base64,YQ=='})});
      assert.equal(upload.status,200);
      uploadIds.push((await upload.json()).id);
    }
    assert.equal(fs.readdirSync(path.join(work,'uploads')).length,8,'uploads land in the test folder, not the real work/');
    const overflow=await fetch(`${base}/api/upload`,{method:'POST',headers:{'content-type':'application/json','x-public-desk-token':token},body:JSON.stringify({name:'overflow.txt',type:'text/plain',data:'data:text/plain;base64,YQ=='})});
    assert.equal(overflow.status,429,'the ninth active upload is rejected before buffering another file');
  }finally{
    for(const id of uploadIds)await fetch(`http://127.0.0.1:${port}/api/upload/delete`,{method:'POST',headers:{'content-type':'application/json','x-public-desk-token':token},body:JSON.stringify({id})}).catch(()=>{});
    if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
    fs.rmSync(work,{recursive:true,force:true});
  }
});

// The page asks for a run grant before a Light touch or higher tool, but the server must refuse such a call on its
// own when no grant comes with it, whatever the page does.
test('the server refuses a target-contacting tool sent without a run grant',async()=>{
  const port=await availablePort();
  const token='integration-access-token-that-is-at-least-thirty-two-bytes';
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-smoke-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),PUBLIC_DESK_TOKEN:token,PUBLIC_DESK_WORK_DIR:work},stdio:['ignore','pipe','pipe']});
  try{
    const base=`http://127.0.0.1:${port}`;
    await waitFor(`${base}/`);
    const headers={'content-type':'application/json','x-public-desk-token':token};
    for(const [name,args] of [['omega_headers',{target:'example.com'}],['omega_ports',{target:'example.com'}],['omega_vuln',{target:'example.com'}]]){
      const response=await fetch(`${base}/api/mcp`,{method:'POST',headers,body:JSON.stringify({endpoint:'http://127.0.0.1:8894/mcp',method:'tools/call',params:{name,arguments:args}})});
      assert.equal(response.status,403,name);
      assert.match((await response.json()).error,/grant/i,name);
    }
    const forged=await fetch(`${base}/api/mcp`,{method:'POST',headers,body:JSON.stringify({endpoint:'http://127.0.0.1:8894/mcp',method:'tools/call',params:{name:'omega_ports',arguments:{target:'example.com'}},runGrant:'made-up-grant',runTarget:'example.com'})});
    assert.equal(forged.status,403);
  }finally{
    if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
    fs.rmSync(work,{recursive:true,force:true});
  }
});
