import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import {fileURLToPath} from 'node:url';

// Uploads are the file's own bytes, streamed to disk; the name travels percent-encoded in a header.
const rawUpload=(token,name,type='text/plain')=>({'content-type':'application/octet-stream','x-public-desk-token':token,'x-upload-name':encodeURIComponent(name),'x-upload-type':type});
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
      const upload=await fetch(`${base}/api/upload`,{method:'POST',headers:rawUpload(token,`smoke-${index}.txt`),body:'a'});
      assert.equal(upload.status,200);
      uploadIds.push((await upload.json()).id);
    }
    assert.equal(fs.readdirSync(path.join(work,'uploads')).length,8,'uploads land in the test folder, not the real work/');
    const overflow=await fetch(`${base}/api/upload`,{method:'POST',headers:rawUpload(token,'overflow.txt'),body:'a'});
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

// A request whose body isn't the expected JSON object is the caller's mistake: 400 with a plain message, never a 502
// that echoes an internal error.
test('malformed request bodies get a clear 400',async()=>{
  const port=await availablePort();
  const token='integration-access-token-that-is-at-least-thirty-two-bytes';
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-smoke-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),PUBLIC_DESK_TOKEN:token,PUBLIC_DESK_WORK_DIR:work},stdio:['ignore','pipe','pipe']});
  try{
    const base=`http://127.0.0.1:${port}`;
    await waitFor(`${base}/`);
    const headers={'content-type':'application/json','x-public-desk-token':token};
    const cases=[['/api/mcp','null'],['/api/mcp','"x"'],['/api/mcp','[1]'],['/api/mcp','{"endpoint":"http://127.0.0.1:8894/mcp","method":5}'],
      ['/api/run-grants','null'],['/api/run-grants','{"tools":[null]}'],['/api/upload/delete','null'],['/api/data-sources/connect','null']];
    for(const [route,body] of cases){
      const response=await fetch(`${base}${route}`,{method:'POST',headers,body});
      const text=await response.text();
      assert.equal(response.status,400,`${route} ${body}: ${text}`);
      assert.doesNotMatch(text,/Cannot read properties|is not a function|Cannot use 'in'/,`${route} ${body}`);
    }
  }finally{
    if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
    fs.rmSync(work,{recursive:true,force:true});
  }
});

// /api/health was not used by the page, and sent a custom server's token to /health on that host (another service on
// a shared host). It is gone; the bundled services' health is checked by the launcher.
test('there is no /api/health route', async () => {
  const { readFile } = await import('node:fs/promises');
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /\/api\/health/);
});

// Uploads used to arrive as base64 inside JSON, so one 50 MB file was held several times over in memory (the request,
// its text, the parsed object, the decoded bytes). They are now the file's own bytes, streamed straight to disk.
test('uploads stream the file to disk and enforce their limits from the declared size',async()=>{
  const port=await availablePort();
  const token='integration-access-token-that-is-at-least-thirty-two-bytes';
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-upload-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),PUBLIC_DESK_TOKEN:token,PUBLIC_DESK_WORK_DIR:work},stdio:['ignore','pipe','pipe']});
  const base=`http://127.0.0.1:${port}`;
  const post=(headers,body)=>fetch(`${base}/api/upload`,{method:'POST',headers,body});
  try{
    await waitFor(`${base}/`);
    const bytes=Buffer.from([0,1,2,255,254,0x89,0x50,0x4e,0x47]);
    const saved=await post(rawUpload(token,'photo é 1.png','image/png'),bytes);
    assert.equal(saved.status,200);
    const upload=await saved.json();
    assert.equal(upload.name,'photo _ 1.png');assert.equal(upload.size,bytes.length);assert.equal(upload.type,'image/png');
    assert.deepEqual(fs.readFileSync(upload.path),bytes,'the file on disk is exactly what was sent');
    assert.equal(fs.statSync(upload.path).mode&0o777,0o600);

    assert.equal((await post(rawUpload(token,'notes.exe'),'a')).status,400,'unsupported file type');
    assert.equal((await post(rawUpload(token,''),'a')).status,400,'a file needs a name');
    assert.equal((await post({...rawUpload(token,'empty.txt')},'')).status,400,'an empty file is refused');
    const tooBig=await new Promise(resolve=>{
      const request=http.request(`${base}/api/upload`,{method:'POST',headers:{...rawUpload(token,'big.txt'),'content-length':String(50_000_001)}},resolve);
      request.on('error',()=>resolve({statusCode:'reset'}));request.end();
    });
    assert.equal(tooBig.statusCode,413,'refused from the declared size, before any of it is read');
    const json=await fetch(`${base}/api/upload`,{method:'POST',headers:{'content-type':'application/json','x-public-desk-token':token},body:JSON.stringify({name:'old.txt',data:'YQ=='})});
    assert.equal(json.status,415,'the old base64-in-JSON form is no longer accepted');
    assert.deepEqual(fs.readdirSync(path.join(work,'uploads')),[path.basename(upload.path)],'refused uploads leave nothing behind');
  }finally{
    if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
    fs.rmSync(work,{recursive:true,force:true});
  }
});
