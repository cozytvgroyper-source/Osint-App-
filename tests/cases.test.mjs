import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CaseStore,MAX_EVIDENCE_BYTES,handleCaseRequest} from '../scripts/cases.mjs';

const tempStore=()=>{const dir=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-cases-')),'cases');return {dir,store:new CaseStore(dir)};};
const mode=file=>fs.statSync(file).mode&0o777;

test('creates, lists and reads cases as owner-only files',async()=>{
  const {dir,store}=tempStore();
  const created=await store.create({name:'  Acme phishing  '});
  assert.match(created.id,/^[0-9a-f]{16}$/);
  assert.equal(created.name,'Acme phishing');
  assert.deepEqual(created.evidence,[]);
  assert.equal(mode(dir),0o700);
  assert.equal(mode(path.join(dir,`${created.id}.json`)),0o600);
  const listed=await store.list();
  assert.deepEqual(listed.map(c=>[c.id,c.name,c.evidenceCount,c.searchCount]),[[created.id,'Acme phishing',0,0]]);
  assert.equal((await store.get(created.id)).name,'Acme phishing');
});

test('rejects bad names and any id that is not 16 hex characters',async()=>{
  const {store}=tempStore();
  await assert.rejects(store.create({name:'   '}),{code:'CASE_INPUT'});
  await assert.rejects(store.create({name:'x'.repeat(121)}),{code:'CASE_INPUT'});
  for(const id of ['../../api-keys','0123456789abcdef.json','ZZZZZZZZZZZZZZZZ',''])await assert.rejects(store.get(id),{code:'CASE_INPUT'},id);
  await assert.rejects(store.get('0123456789abcdef'),{code:'CASE_NOT_FOUND'});
});

test('saved evidence gets an id, a save time and a SHA-256 fingerprint of its raw result',async()=>{
  const {store}=tempStore();
  const {id}=await store.create({name:'Case'});
  const result={content:[{type:'text',text:'{"ip":"8.8.8.8"}'}]};
  const item=await store.addEvidence(id,{title:'8.8.8.8',result,time:'2026-11-12T01:00:00.000Z',server:'Open OSINT'},{now:new Date('2026-11-12T02:00:00Z')});
  assert.match(item.id,/^[0-9a-f]{12}$/);
  assert.equal(item.savedAt,'2026-11-12T02:00:00.000Z');
  assert.equal(item.sha256,createHash('sha256').update(JSON.stringify(result)).digest('hex'));
  const saved=await store.get(id);
  assert.equal(saved.evidence.length,1);
  assert.deepEqual(saved.evidence[0].result,result);
  assert.equal((await store.list())[0].evidenceCount,1);
});

test('rejects evidence without a title or over the size limit, and caps a case at 50 MB',async()=>{
  const {store}=tempStore();
  const {id}=await store.create({name:'Case'});
  await assert.rejects(store.addEvidence(id,{title:'',result:{}}),{code:'CASE_INPUT'});
  await assert.rejects(store.addEvidence(id,{title:'big',result:'x'.repeat(MAX_EVIDENCE_BYTES)}),{code:'CASE_TOO_LARGE'});
  const small=new CaseStore(store.dir,{maxCaseBytes:3000});
  await small.addEvidence(id,{title:'one',result:'y'.repeat(1000)});
  await assert.rejects(small.addEvidence(id,{title:'two',result:'y'.repeat(2500)}),{code:'CASE_TOO_LARGE'});
});

test('removes evidence, renames and deletes cases',async()=>{
  const {dir,store}=tempStore();
  const {id}=await store.create({name:'Case'});
  const a=await store.addEvidence(id,{title:'a',result:1});
  await store.addEvidence(id,{title:'b',result:2});
  await store.removeEvidence(id,a.id);
  assert.deepEqual((await store.get(id)).evidence.map(e=>e.title),['b']);
  await assert.rejects(store.removeEvidence(id,'ffffffffffff'),{code:'CASE_NOT_FOUND'});
  assert.equal((await store.rename(id,{name:'Renamed'})).name,'Renamed');
  await store.remove(id);
  assert.equal(fs.existsSync(path.join(dir,`${id}.json`)),false);
  assert.deepEqual(await store.list(),[]);
});

test('records searches in the case, newest first, keeping the latest 200',async()=>{
  const {store}=tempStore();
  const {id}=await store.create({name:'Case'});
  for(let i=0;i<205;i++)await store.addSearch(id,{title:`q${i}`,time:'2026-11-12T00:00:00Z',server:'Open OSINT'});
  const searches=(await store.get(id)).searches;
  assert.equal(searches.length,200);
  assert.equal(searches[0].title,'q204');
});

test('concurrent saves to one case are all kept, and no temporary files are left behind',async()=>{
  const {dir,store}=tempStore();
  const {id}=await store.create({name:'Case'});
  await Promise.all(Array.from({length:20},(_,i)=>store.addEvidence(id,{title:`item ${i}`,result:i})));
  assert.equal((await store.get(id)).evidence.length,20);
  assert.deepEqual(fs.readdirSync(dir),[`${id}.json`]);
});

test('a damaged case file is reported, not silently replaced',async()=>{
  const {dir,store}=tempStore();
  const {id}=await store.create({name:'Case'});
  fs.writeFileSync(path.join(dir,`${id}.json`),'{not json');
  await assert.rejects(store.get(id),{code:'CASE_DAMAGED'});
  const listed=await store.list();
  assert.deepEqual(listed.map(c=>[c.id,c.damaged]),[[id,true]]);
});

test('routes the case API: list, create, read, rename, add and remove evidence, record searches, delete',async()=>{
  const {store}=tempStore();
  const call=(method,pathname,body={})=>handleCaseRequest(store,method,pathname,async()=>body);
  assert.deepEqual(await call('GET','/api/cases'),{status:200,body:{cases:[]}});
  const created=(await call('POST','/api/cases',{name:'Acme'})).body;
  assert.equal((await call('GET',`/api/cases/${created.id}`)).body.name,'Acme');
  assert.equal((await call('POST',`/api/cases/${created.id}/rename`,{name:'Acme Corp'})).body.name,'Acme Corp');
  const item=(await call('POST',`/api/cases/${created.id}/evidence`,{title:'example.com',result:{ok:true}})).body;
  assert.match(item.sha256,/^[0-9a-f]{64}$/);
  await call('POST',`/api/cases/${created.id}/searches`,{title:'example.com',server:'Open OSINT'});
  assert.equal((await call('GET','/api/cases')).body.cases[0].searchCount,1);
  assert.deepEqual(await call('POST',`/api/cases/${created.id}/evidence/${item.id}/delete`),{status:200,body:{removed:true}});
  assert.deepEqual(await call('POST',`/api/cases/${created.id}/delete`),{status:200,body:{deleted:true}});
  assert.equal(await call('GET','/api/cases/notacaseid'),null,'unknown paths are left to the server');
  assert.equal(await call('PUT','/api/cases'),null);
});


test('new findings start unverified, and a note and status can be updated',async()=>{
  const {store}=tempStore();
  const {id}=await store.create({name:'Case'});
  const item=await store.addEvidence(id,{title:'example.com',result:{}});
  assert.equal(item.status,'unverified');
  assert.equal(item.note,'');
  const updated=await store.updateEvidence(id,item.id,{status:'confirmed',note:'  Matches the registrar record.  '});
  assert.deepEqual([updated.status,updated.note],['confirmed','Matches the registrar record.']);
  assert.equal((await store.get(id)).evidence[0].status,'confirmed');
  const partial=await store.updateEvidence(id,item.id,{status:'ruled out'});
  assert.deepEqual([partial.status,partial.note],['ruled out','Matches the registrar record.'],'a status change keeps the note');
  await assert.rejects(store.updateEvidence(id,item.id,{status:'probably'}),{code:'CASE_INPUT'});
  await assert.rejects(store.updateEvidence(id,item.id,{note:'x'.repeat(4001)}),{code:'CASE_INPUT'});
  await assert.rejects(store.updateEvidence(id,'ffffffffffff',{status:'confirmed'}),{code:'CASE_NOT_FOUND'});
  const route=await handleCaseRequest(store,'POST',`/api/cases/${id}/evidence/${item.id}/update`,async()=>({note:'via route'}));
  assert.equal(route.body.note,'via route');
});
