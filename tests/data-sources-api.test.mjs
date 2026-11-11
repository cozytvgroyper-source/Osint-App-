import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dataSourcesAction} from '../server.mjs';

// The Data sources panel calls these actions through POST /api/data-sources[/connect|/disconnect|/remove].
// Responses report which fields are saved and the status, never key values.
async function setup(initial){
  const dir=await mkdtemp(join(tmpdir(),'pd-sources-'));
  const file=join(dir,'work','api-keys.env');const template=join(dir,'template.env');
  await writeFile(template,'# Template\nOTX_API_KEY=\nACLED_ACCESS_TOKEN=\nACLED_EMAIL=\n');
  if(initial!==undefined){const {mkdir}=await import('node:fs/promises');await mkdir(join(dir,'work'),{recursive:true});await writeFile(file,initial,{mode:0o644});}
  const act=(action,payload)=>dataSourcesAction(action,payload,{file,template});
  return {dir,file,act,done:()=>rm(dir,{recursive:true,force:true})};
}
const statusOf=(result,id)=>result.body.sources.find(s=>s.id===id).status;

test('lists every source as not configured when no key file exists yet',async()=>{
  const {act,done}=await setup();
  const result=await act('list');
  assert.equal(result.status,200);
  assert.ok(result.body.sources.length>=14);
  assert.ok(result.body.sources.every(s=>s.status==='not_configured'));
  await done();
});

test('connect saves the key privately, starting from the template, and never echoes it',async()=>{
  const {file,act,done}=await setup();
  const result=await act('connect',{id:'otx',values:{OTX_API_KEY:'  otx-secret-1  '}});
  assert.equal(result.status,200);
  assert.equal(result.body.source.status,'connected');
  assert.doesNotMatch(JSON.stringify(result.body),/otx-secret-1/);
  const text=await readFile(file,'utf8');
  assert.match(text,/^# Template\nOTX_API_KEY=otx-secret-1\n/);
  assert.equal((await stat(file)).mode&0o777,0o600);
  await done();
});

test('disconnect keeps the key; connect without a value turns it back on',async()=>{
  const {file,act,done}=await setup('OTX_API_KEY=otx-secret-1\n');
  assert.equal((await act('disconnect',{id:'otx'})).body.source.status,'disconnected');
  assert.match(await readFile(file,'utf8'),/OTX_API_KEY=otx-secret-1/);
  assert.equal(statusOf(await act('list'),'otx'),'disconnected');
  assert.equal((await act('connect',{id:'otx'})).body.source.status,'connected');
  assert.equal((await stat(file)).mode&0o777,0o600,'a loose existing file is tightened on write');
  await done();
});

test('remove deletes the key and forgets that it was disconnected',async()=>{
  const {file,act,done}=await setup('OTX_API_KEY=otx-secret-1\nPUBLIC_DESK_DISABLED=otx\n');
  assert.equal((await act('remove',{id:'otx'})).body.source.status,'not_configured');
  const text=await readFile(file,'utf8');
  assert.doesNotMatch(text,/otx-secret-1/);
  assert.doesNotMatch(text,/PUBLIC_DESK_DISABLED=otx/);
  await done();
});

test('refuses unknown sources, missing fields and unsafe values without touching the file',async()=>{
  const {file,act,done}=await setup('OTX_API_KEY=otx-secret-1\n');
  assert.equal((await act('connect',{id:'groq',values:{GROQ_API_KEY:'x'}})).status,400);
  assert.equal((await act('connect',{id:'intelx'})).status,400,'no saved key and none given');
  assert.equal((await act('connect',{id:'acled',values:{ACLED_ACCESS_TOKEN:'tok'}})).status,400,'ACLED also needs the email');
  const bad=await act('connect',{id:'otx',values:{OTX_API_KEY:'two words'}});
  assert.equal(bad.status,400);
  assert.match(bad.body.error,/spaces/);
  assert.equal(await readFile(file,'utf8'),'OTX_API_KEY=otx-secret-1\n');
  await done();
});

test('ignores values for fields the source does not have',async()=>{
  const {file,act,done}=await setup();
  await act('connect',{id:'otx',values:{OTX_API_KEY:'otx-1',GROQ_API_KEY:'groq-1',INTELX_API_ORIGIN:'https://evil.example'}});
  const text=await readFile(file,'utf8');
  assert.doesNotMatch(text,/groq-1|evil\.example/);
  await done();
});

test('concurrent actions do not lose each other\'s changes',async()=>{
  const {file,act,done}=await setup('');
  await Promise.all([
    act('connect',{id:'otx',values:{OTX_API_KEY:'otx-1'}}),
    act('connect',{id:'intelx',values:{INTELX_API_KEY:'intelx-1'}}),
    act('connect',{id:'greynoise',values:{GREYNOISE_API_KEY:'gn-1'}})
  ]);
  const text=await readFile(file,'utf8');
  for(const value of ['otx-1','intelx-1','gn-1'])assert.match(text,new RegExp(value));
  await done();
});
