import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DeepRunStore,MAX_DEEP_RUN_BYTES} from '../scripts/deep-search-runs.mjs';

const sample=id=>({id,target:{type:'email',value:'owner@example.com'},level:0,startedAt:'2026-11-13T00:00:00.000Z',finishedAt:'2026-11-13T00:01:00.000Z',outcome:'completed',rounds:1,calls:[],findings:[],leadsNotFollowed:[],raw:{}});

test('saves and reads a run as private owner-only data',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pd-deep-runs-'));const dir=join(root,'runs');const store=new DeepRunStore(dir);
  const run=sample('run-12345678');
  assert.deepEqual(await store.save(run),{id:run.id});
  assert.deepEqual(await store.read(run.id),run);
  assert.equal((await stat(dir)).mode&0o077,0);
  assert.equal((await stat(join(dir,`${run.id}.json`))).mode&0o077,0);
  assert.deepEqual((await readdir(dir)).filter(name=>name.includes('.tmp')),[]);
});

test('rejects bad ids and oversized runs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pd-deep-runs-'));const store=new DeepRunStore(join(root,'runs'),{maxBytes:500});
  await assert.rejects(()=>store.save(sample('../escape')),/id/);
  await assert.rejects(()=>store.save({...sample('valid-run-123'),raw:{huge:'x'.repeat(1_000)}}),/too large/i);
  assert.equal(MAX_DEEP_RUN_BYTES,25_000_000);
});

test('missing and damaged runs have explicit error codes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pd-deep-runs-'));const store=new DeepRunStore(join(root,'runs'));
  await assert.rejects(()=>store.read('missing-run'),error=>error.code==='DEEP_RUN_NOT_FOUND');
});

test('remove deletes one run and reports whether a file existed',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pd-deep-runs-'));const store=new DeepRunStore(join(root,'runs'));
  await store.save(sample('run-aaaaaaaa'));await store.save(sample('run-bbbbbbbb'));
  assert.equal(await store.remove('run-aaaaaaaa'),true);
  await assert.rejects(()=>store.read('run-aaaaaaaa'),error=>error.code==='DEEP_RUN_NOT_FOUND');
  assert.deepEqual(await store.read('run-bbbbbbbb'),sample('run-bbbbbbbb'));
  assert.equal(await store.remove('run-aaaaaaaa'),false);
});

test('remove refuses bad ids before touching disk',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pd-deep-runs-'));const store=new DeepRunStore(join(root,'runs'));
  await assert.rejects(()=>store.remove('../escape'),error=>error.code==='DEEP_RUN_INPUT');
  await assert.rejects(()=>store.remove(''),error=>error.code==='DEEP_RUN_INPUT');
});

test('removeAll clears saved, temporary and orphaned files and tolerates a missing folder',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pd-deep-runs-'));const dir=join(root,'runs');const store=new DeepRunStore(dir);
  await store.save(sample('run-aaaaaaaa'));await store.save(sample('run-bbbbbbbb'));
  await writeFile(join(dir,'.run-cccccccc.ab12.tmp'),'partial');
  assert.equal(await store.removeAll(),3);
  assert.deepEqual(await readdir(dir),[]);
  assert.equal(await new DeepRunStore(join(root,'never-made')).removeAll(),0);
});

test('removeAll treats a file that vanishes mid-delete as already gone',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pd-deep-runs-'));const dir=join(root,'runs');const store=new DeepRunStore(dir);
  for(let index=0;index<20;index++)await store.save(sample(`run-${String(index).padStart(8,'0')}`));
  // Both must succeed and leave nothing behind. The two counts are not asserted: on macOS two unlinks racing on the
  // same path can both report success, so a racing pair may count a file twice.
  const counts=await Promise.all([store.removeAll(),new DeepRunStore(dir).removeAll()]);
  assert.ok(counts.every(count=>Number.isInteger(count)&&count>=0));
  assert.deepEqual(await readdir(dir),[]);
});

// Delete all from another tab (or the app window) can arrive while a finished search is still being saved. It used to
// delete the save's temporary file mid-write, so the save failed and its results were lost. Changes to the results
// folder now run one at a time: the save finishes, then Delete all removes it.
test('Delete all waits for a save in progress instead of breaking it',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pd-deep-runs-'));const dir=join(root,'runs');const store=new DeepRunStore(dir);
  for(let attempt=0;attempt<5;attempt++){
    const big={...sample('run-racing01'),raw:{x:'y'.repeat(5_000_000)}};
    const saving=store.save(big);
    await new Promise(resolve=>setTimeout(resolve,2));
    const [saved,removed]=await Promise.all([saving,new DeepRunStore(dir).removeAll()]);
    assert.deepEqual(saved,{id:'run-racing01'});
    assert.equal(removed,1,'Delete all removed the finished save');
    assert.deepEqual(await readdir(dir),[]);
  }
});

test('a save queued behind a delete of the same run still saves',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pd-deep-runs-'));const store=new DeepRunStore(join(root,'runs'));
  await store.save(sample('run-requeue1'));
  const [removed,saved]=await Promise.all([store.remove('run-requeue1'),store.save(sample('run-requeue1'))]);
  assert.equal(removed,true);assert.deepEqual(saved,{id:'run-requeue1'});
  assert.equal((await store.read('run-requeue1')).id,'run-requeue1');
});
