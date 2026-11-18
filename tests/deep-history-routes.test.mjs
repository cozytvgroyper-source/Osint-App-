import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DeepRunStore} from '../scripts/deep-search-runs.mjs';
import {handleDeepHistoryRequest,pruneUnlistedDeepRuns} from '../scripts/deep-history-routes.mjs';
import {appendDeepSearchAudit} from '../scripts/deep-search-audit.mjs';

const lineFor=fields=>JSON.stringify({time:'2026-11-13T10:00:00.000Z',target:'owner@example.com',level:0,tools:['holehe_email_search'],toolCount:1,outcome:'completed',...fields});
const run=id=>({id,target:{type:'email',value:'owner@example.com'},level:0,outcome:'completed',findings:[]});

async function setup(lines=[]){
  const root=await mkdtemp(join(tmpdir(),'pd-deep-history-'));
  const runs=new DeepRunStore(join(root,'runs'));
  const auditFile=join(root,'audit.jsonl');
  await writeFile(auditFile,lines.map(line=>`${line}\n`).join(''),{mode:0o600});
  return {root,runs,auditFile};
}
const call=(ctx,method,pathname,body={})=>handleDeepHistoryRequest(ctx,method,pathname,async()=>body);

test('deletes one run\'s results then its history lines',async()=>{
  const other=lineFor({runId:'run-bbbbbbbb'});
  const ctx=await setup([lineFor({runId:'run-aaaaaaaa',outcome:'started'}),other,lineFor({runId:'run-aaaaaaaa'})]);
  await ctx.runs.save(run('run-aaaaaaaa'));await ctx.runs.save(run('run-bbbbbbbb'));
  assert.deepEqual(await call(ctx,'POST','/api/deep-search/runs/run-aaaaaaaa/delete'),{status:200,body:{deleted:2,results:true}});
  await assert.rejects(()=>ctx.runs.read('run-aaaaaaaa'),error=>error.code==='DEEP_RUN_NOT_FOUND');
  assert.deepEqual(await ctx.runs.read('run-bbbbbbbb'),run('run-bbbbbbbb'));
  assert.equal(await readFile(ctx.auditFile,'utf8'),`${other}\n`);
});

test('results are removed before history lines',async()=>{
  const lines=[lineFor({runId:'run-aaaaaaaa',outcome:'started'}),lineFor({runId:'run-aaaaaaaa'})];
  const ctx=await setup(lines);
  const failing={remove:async()=>{throw Object.assign(new Error('disk busy'),{code:'EBUSY'});}};
  await assert.rejects(()=>call({...ctx,runs:failing},'POST','/api/deep-search/runs/run-aaaaaaaa/delete'),/disk busy/);
  assert.equal(await readFile(ctx.auditFile,'utf8'),lines.map(line=>`${line}\n`).join(''));
});

test('deleting something already gone succeeds with zero',async()=>{
  const ctx=await setup([]);
  assert.deepEqual(await call(ctx,'POST','/api/deep-search/runs/run-aaaaaaaa/delete'),{status:200,body:{deleted:0,results:false}});
});

test('refuses a bad run id',async()=>{
  const lines=[lineFor({runId:'run-aaaaaaaa'})];
  const ctx=await setup(lines);
  await assert.rejects(()=>call(ctx,'POST','/api/deep-search/runs/BAD_ID/delete'),error=>error.code==='DEEP_RUN_INPUT');
  assert.equal(await readFile(ctx.auditFile,'utf8'),`${lines[0]}\n`);
});

test('deletes a legacy row by time and target',async()=>{
  const legacy=lineFor({}),withId=lineFor({runId:'run-aaaaaaaa'});
  const ctx=await setup([legacy,withId]);
  assert.deepEqual(await call(ctx,'POST','/api/deep-search/history/delete',{time:'2026-11-13T10:00:00.000Z',target:'owner@example.com'}),{status:200,body:{deleted:1,results:false}});
  assert.equal(await readFile(ctx.auditFile,'utf8'),`${withId}\n`);
  await assert.rejects(()=>call(ctx,'POST','/api/deep-search/history/delete',{time:'2026-11-13T10:00:00.000Z',target:''}),error=>error.code==='AUDIT_INPUT');
});

test('delete-all clears every result file and the whole log',async()=>{
  const ctx=await setup([lineFor({runId:'run-aaaaaaaa'}),lineFor({runId:'run-bbbbbbbb'}),lineFor({})]);
  await ctx.runs.save(run('run-aaaaaaaa'));await ctx.runs.save(run('run-bbbbbbbb'));
  assert.deepEqual(await call(ctx,'POST','/api/deep-search/history/delete-all'),{status:200,body:{deleted:3,results:2}});
  assert.deepEqual(await readdir(ctx.runs.dir),[]);
  assert.equal(await readFile(ctx.auditFile,'utf8'),'');
});

test('ignores paths and methods it does not own',async()=>{
  const ctx=await setup([]);
  assert.equal(await call(ctx,'GET','/api/deep-search/runs/run-aaaaaaaa/delete'),null);
  assert.equal(await call(ctx,'POST','/api/deep-search/runs/run-aaaaaaaa'),null);
  assert.equal(await call(ctx,'POST','/api/deep-search/history'),null);
});

test('server wires the history routes behind the guard',()=>{
  const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
  assert.match(server,/import \{handleDeepHistoryRequest(?:,[A-Za-z]+)*\} from '\.\/scripts\/deep-history-routes\.mjs';/);
  const guard=server.indexOf('requestGuard({ method: req.method');
  const wired=server.indexOf('handleDeepHistoryRequest({runs:deepRuns,auditFile:DEEP_SEARCH_AUDIT_FILE}');
  assert.ok(guard>0&&wired>guard,'history routes are handled after the request guard');
});

// Results whose history lines are gone (the log keeps its newest 1 MB) had no row to delete them from, so they stayed
// on disk, and in every backup, until Delete all. Results that no history line mentions are now removed; anything the
// history still mentions stays, damaged lines included.
test('prunes results that no history line mentions, keeping every listed run',async()=>{
  const ctx=await setup([lineFor({runId:'run-listed01',outcome:'started'}),lineFor({runId:'run-listed02'}),'{"runId":"run-damaged1","outco']);
  for(const id of ['run-listed01','run-listed02','run-damaged1','run-orphan01','run-orphan02'])await ctx.runs.save(run(id));
  await writeFile(join(ctx.runs.dir,'.run-orphan03.abcdef.tmp'),'{}');
  await writeFile(join(ctx.runs.dir,'notes.txt'),'not a result');
  assert.equal(await pruneUnlistedDeepRuns(ctx),3);
  assert.deepEqual((await readdir(ctx.runs.dir)).sort(),['notes.txt','run-damaged1.json','run-listed01.json','run-listed02.json']);
});

test('never prunes when the history log is missing or unreadable',async()=>{
  const ctx=await setup();
  await ctx.runs.save(run('run-kept0001'));
  fs.rmSync(ctx.auditFile);
  assert.equal(await pruneUnlistedDeepRuns(ctx),0);
  fs.mkdirSync(ctx.auditFile);
  await assert.rejects(pruneUnlistedDeepRuns(ctx));
  assert.deepEqual(await readdir(ctx.runs.dir),['run-kept0001.json']);
});

test('results drop out when the history log rotates their lines away',async()=>{
  const ctx=await setup();
  const entry=runId=>({target:'owner@example.com',level:0,tools:['holehe_email_search'],outcome:'completed',runId});
  await appendDeepSearchAudit(ctx.auditFile,entry('run-oldest01'));await ctx.runs.save(run('run-oldest01'));
  for(let index=0;index<12;index++)await appendDeepSearchAudit(ctx.auditFile,entry(`run-newer${String(index).padStart(3,'0')}`),{maxBytes:1_000});
  await ctx.runs.save(run('run-newer011'));
  assert.equal(await pruneUnlistedDeepRuns(ctx),1);
  assert.deepEqual(await readdir(ctx.runs.dir),['run-newer011.json']);
});

test('server prunes at startup and after each history line it writes',()=>{
  const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
  assert.match(server,/pruneDeepRuns\(\)/);
  const append=server.indexOf("url.pathname === '/api/deep-search/audit'",server.indexOf("req.method === 'POST' && url.pathname === '/api/deep-search/audit'"));
  assert.ok(server.indexOf('pruneDeepRuns',append)>append,'pruned after a history line is written');
  assert.ok(server.lastIndexOf('pruneDeepRuns')>server.indexOf('server.listen(PORT'),'pruned at startup');
});
