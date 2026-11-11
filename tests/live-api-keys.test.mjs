import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// The data service loads scripts/live-api-keys.mjs, which keeps its environment in step with work/api-keys.env, so
// Connect and Disconnect in the Data sources panel apply without a restart. Open OSINT reads keys on every call.
const preload=new URL('../scripts/live-api-keys.mjs',import.meta.url).href;
const probe=`const names=['OTX_API_KEY','ABUSEIPDB_API_KEY','GROQ_API_KEY'];
const show=()=>process.stdout.write(JSON.stringify(Object.fromEntries(names.filter(n=>n in process.env).map(n=>[n,process.env[n]])))+'\\n');
show();process.stdin.on('data',()=>show());`;

test('loads connected keys at start and follows later changes to the file',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-live-'));
  const file=path.join(dir,'api-keys.env');
  fs.writeFileSync(file,'OTX_API_KEY=otx-test\nABUSEIPDB_API_KEY=abuse-test\nGROQ_API_KEY=groq-test\nPUBLIC_DESK_DISABLED=abuseipdb\n',{mode:0o600});
  const child=spawn(process.execPath,['--import',preload,'--input-type=module','-e',probe],{env:{PATH:process.env.PATH,PUBLIC_DESK_API_KEYS_FILE:file,GROQ_API_KEY:'from-launcher'}});
  const lines=[];let buffer='';
  child.stdout.on('data',d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){lines.push(JSON.parse(buffer.slice(0,i)));buffer=buffer.slice(i+1);}});
  const next=async count=>{for(let t=0;t<100&&lines.length<count;t++)await new Promise(r=>setTimeout(r,50));return lines.at(-1);};
  try{
    assert.deepEqual(await next(1),{OTX_API_KEY:'otx-test',GROQ_API_KEY:'from-launcher'},'disconnected AbuseIPDB is not loaded; unmanaged names are untouched');
    fs.writeFileSync(file,'OTX_API_KEY=otx-test\nABUSEIPDB_API_KEY=abuse-test\nPUBLIC_DESK_DISABLED=otx\n');
    await new Promise(r=>setTimeout(r,2500));
    child.stdin.write('\n');
    assert.deepEqual(await next(2),{ABUSEIPDB_API_KEY:'abuse-test',GROQ_API_KEY:'from-launcher'},'OTX disconnected, AbuseIPDB connected');
  }finally{child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a missing key file leaves the environment without managed keys',async()=>{
  const child=spawn(process.execPath,['--import',preload,'--input-type=module','-e',probe],{env:{PATH:process.env.PATH,PUBLIC_DESK_API_KEYS_FILE:'/nonexistent/api-keys.env',OTX_API_KEY:'stale'}});
  let out='';child.stdout.on('data',d=>out+=d);
  await new Promise(r=>setTimeout(r,800));child.kill();
  assert.deepEqual(JSON.parse(out.split('\n')[0]),{});
});
