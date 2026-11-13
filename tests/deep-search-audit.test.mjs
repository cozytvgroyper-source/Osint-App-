import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {appendDeepSearchAudit,auditEntry} from '../scripts/deep-search-audit.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('validates and appends private JSONL audit entries without credentials',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pd-audit-'));const file=join(dir,'audit.jsonl');
  const entry=await appendDeepSearchAudit(file,{target:'example.com',level:2,tools:['omega_ports'],outcome:'completed'},{now:new Date('2026-11-11T12:00:00Z')});
  assert.deepEqual(JSON.parse((await readFile(file,'utf8')).trim()),entry);
  assert.equal((await stat(file)).mode&0o077,0);
});
test('rejects malformed audit entries',()=>assert.throws(()=>auditEntry({target:'',level:9,tools:[],outcome:''}),/Invalid/));

test('keeps run id and total tool count while capping names at 25',()=>{
  const tools=Array.from({length:40},(_,index)=>`tool-${index}`);
  const entry=auditEntry({target:'example.com',level:1,tools,toolCount:40,runId:'run-12345678',outcome:'started'},new Date('2026-11-13T00:00:00Z'));
  assert.equal(entry.runId,'run-12345678');
  assert.equal(entry.toolCount,40);
  assert.equal(entry.tools.length,25);
  assert.equal(entry.outcome,'started');
});

test('reads the audit log newest first, skipping and counting damaged lines',async()=>{
  const {readDeepSearchAudit}=await import('../scripts/deep-search-audit.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-audit-read-'));
  const file=path.join(dir,'audit.jsonl');
  await appendDeepSearchAudit(file,{target:'example.com',level:0,tools:['whois_lookup'],outcome:'completed'},{now:new Date('2026-11-12T01:00:00Z')});
  fs.appendFileSync(file,'{not json\n');
  await appendDeepSearchAudit(file,{target:'8.8.8.8',level:1,tools:['get_bgp','omega_headers'],outcome:'cancelled'},{now:new Date('2026-11-12T02:00:00Z')});
  const read=await readDeepSearchAudit(file);
  assert.deepEqual(read.entries.map(e=>[e.target,e.outcome]),[['8.8.8.8','cancelled'],['example.com','completed']]);
  assert.equal(read.skipped,1);
  assert.equal(read.total,2);
  const limited=await readDeepSearchAudit(file,{limit:1});
  assert.deepEqual([limited.entries.length,limited.total],[1,2]);
});

test('a missing audit log reads as empty, not as an error',async()=>{
  const {readDeepSearchAudit}=await import('../scripts/deep-search-audit.mjs');
  assert.deepEqual(await readDeepSearchAudit(path.join(os.tmpdir(),'public-desk-no-such-audit.jsonl')),{entries:[],total:0,skipped:0});
});

test('rotates audit history to a bounded valid tail and keeps the newest entries',async()=>{
  const {readDeepSearchAudit}=await import('../scripts/deep-search-audit.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-audit-rotate-'));
  const file=path.join(dir,'audit.jsonl');
  for(let index=0;index<20;index++){
    await appendDeepSearchAudit(file,{target:`target-${index}.example`,level:0,tools:['whois_lookup'],outcome:'completed'},{now:new Date(1_700_000_000_000+index),maxBytes:500});
  }
  const raw=await readFile(file,'utf8');
  assert.ok(Buffer.byteLength(raw)<=500);
  assert.doesNotThrow(()=>raw.trim().split('\n').forEach(line=>JSON.parse(line)));
  const result=await readDeepSearchAudit(file,{maxBytes:500});
  assert.equal(result.entries[0].target,'target-19.example');
  assert.ok(result.total<20,'older retained entries were rotated away');
  assert.equal((await stat(file)).mode&0o077,0);
});

test('serializes concurrent appends so rotation never loses or corrupts accepted entries',async()=>{
  const {readDeepSearchAudit}=await import('../scripts/deep-search-audit.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-audit-concurrent-'));
  const file=path.join(dir,'audit.jsonl');
  await Promise.all(Array.from({length:12},(_,index)=>appendDeepSearchAudit(file,{target:`parallel-${index}.example`,level:1,tools:['get_bgp'],outcome:'completed'},{maxBytes:10_000})));
  const result=await readDeepSearchAudit(file,{maxBytes:10_000});
  assert.equal(result.total,12);
  assert.equal(new Set(result.entries.map(entry=>entry.target)).size,12);
  assert.equal(result.skipped,0);
});

const lineFor=(fields)=>JSON.stringify({time:'2026-11-13T10:00:00.000Z',target:'owner@example.com',level:0,tools:['holehe_email_search'],toolCount:1,outcome:'completed',...fields});
async function logWith(lines){
  const dir=await mkdtemp(join(tmpdir(),'pd-audit-del-'));const file=join(dir,'audit.jsonl');
  await fs.promises.writeFile(file,lines.map(line=>`${line}\n`).join(''),{mode:0o600});
  return file;
}

test('delete by run id removes both of that run\'s lines and keeps every other line byte-for-byte',async()=>{
  const {deleteDeepSearchAudit}=await import('../scripts/deep-search-audit.mjs');
  const a1=lineFor({runId:'run-aaaaaaaa',outcome:'started'}),b=lineFor({runId:'run-bbbbbbbb',target:'ownername'}),legacy=lineFor({target:'old.example'}),a2=lineFor({runId:'run-aaaaaaaa'});
  const file=await logWith([a1,b,'not json',legacy,a2]);
  assert.equal(await deleteDeepSearchAudit(file,{runId:'run-aaaaaaaa'}),2);
  assert.equal(await readFile(file,'utf8'),[b,'not json',legacy].map(line=>`${line}\n`).join(''));
  assert.equal((await stat(file)).mode&0o077,0);
});

test('delete by time and target removes only the legacy line without a run id',async()=>{
  const {deleteDeepSearchAudit}=await import('../scripts/deep-search-audit.mjs');
  const legacy=lineFor({}),withId=lineFor({runId:'run-aaaaaaaa'});
  const file=await logWith([legacy,withId]);
  assert.equal(await deleteDeepSearchAudit(file,{time:'2026-11-13T10:00:00.000Z',target:'owner@example.com'}),1);
  assert.equal(await readFile(file,'utf8'),`${withId}\n`);
});

test('rejects bad delete input',async()=>{
  const {deleteDeepSearchAudit}=await import('../scripts/deep-search-audit.mjs');
  const file=await logWith([lineFor({})]);
  for(const match of [{runId:'../x'},{time:'t',target:''},{}])
    await assert.rejects(()=>deleteDeepSearchAudit(file,match),error=>error.code==='AUDIT_INPUT');
  assert.equal(await readFile(file,'utf8'),`${lineFor({})}\n`);
});

test('clear empties the log and a missing log is fine',async()=>{
  const {deleteDeepSearchAudit,clearDeepSearchAudit}=await import('../scripts/deep-search-audit.mjs');
  const file=await logWith([lineFor({runId:'run-aaaaaaaa'}),'not json',lineFor({})]);
  assert.equal(await clearDeepSearchAudit(file),3);
  assert.equal(await readFile(file,'utf8'),'');
  assert.equal((await stat(file)).mode&0o077,0);
  const missing=join(await mkdtemp(join(tmpdir(),'pd-audit-missing-')),'audit.jsonl');
  assert.equal(await clearDeepSearchAudit(missing),0);
  assert.equal(await deleteDeepSearchAudit(missing,{runId:'run-aaaaaaaa'}),0);
  await assert.rejects(()=>fs.promises.access(missing),error=>error.code==='ENOENT');
});

test('an append queued during a delete is never lost',async()=>{
  const {deleteDeepSearchAudit,readDeepSearchAudit}=await import('../scripts/deep-search-audit.mjs');
  const file=await logWith([lineFor({runId:'run-aaaaaaaa',outcome:'started'}),lineFor({runId:'run-aaaaaaaa'})]);
  await Promise.all([
    deleteDeepSearchAudit(file,{runId:'run-aaaaaaaa'}),
    appendDeepSearchAudit(file,{target:'ownername',level:0,tools:['maigret_username_search'],outcome:'completed',runId:'run-cccccccc'})
  ]);
  const {entries}=await readDeepSearchAudit(file);
  assert.deepEqual(entries.map(entry=>entry.runId),['run-cccccccc']);
});

test('delete and clear remove leftover temporary copies of the log',async()=>{
  const {deleteDeepSearchAudit,clearDeepSearchAudit}=await import('../scripts/deep-search-audit.mjs');
  const keep=lineFor({runId:'run-bbbbbbbb'});
  for(const action of [file=>deleteDeepSearchAudit(file,{runId:'run-aaaaaaaa'}),file=>clearDeepSearchAudit(file)]){
    const file=await logWith([lineFor({runId:'run-aaaaaaaa'}),keep]);
    const dir=path.dirname(file);
    await fs.promises.writeFile(path.join(dir,'audit.jsonl.4242.ab12cd34.tmp'),'stale copy of the old log',{mode:0o600});
    await fs.promises.writeFile(path.join(dir,'unrelated.tmp'),'not ours');
    await action(file);
    assert.deepEqual((await fs.promises.readdir(dir)).sort(),['audit.jsonl','unrelated.tmp']);
  }
});
