import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupStaleUploads, trackUpload } from '../server.mjs';

const oldName = '11111111-1111-4111-8111-111111111111-old.txt';
const freshName = '22222222-2222-4222-8222-222222222222-fresh.txt';

test('startup cleanup removes stale uploads but keeps fresh files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd-uploads-'));
  try {
    const stale = join(root, oldName); const fresh = join(root, freshName);
    await writeFile(stale, 'old'); await writeFile(fresh, 'fresh');
    await utimes(stale, new Date(0), new Date(0));
    assert.equal(await cleanupStaleUploads(root, { now: Date.now(), maxAge: 60_000 }), 1);
    await assert.rejects(()=>readFile(stale),{code:'ENOENT'});
    assert.equal(await readFile(fresh,'utf8'),'fresh');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('cleanup ignores unrelated files, directories, and symlinks', async () => {
  const base = await mkdtemp(join(tmpdir(), 'pd-uploads-')); const root=join(base,'uploads');
  try {
    await (await import('node:fs/promises')).mkdir(root);
    const outside=join(base,'outside.txt');await writeFile(outside,'keep');
    await writeFile(join(root,'not-an-upload.txt'),'keep');
    await symlink(outside,join(root,oldName));
    assert.equal(await cleanupStaleUploads(root,{now:Date.now(),maxAge:0}),0);
    assert.equal(await readFile(outside,'utf8'),'keep');
  } finally { await rm(base,{recursive:true,force:true}); }
});

test('tracked uploads expire without a browser delete request', async () => {
  const root=await mkdtemp(join(tmpdir(),'pd-upload-lease-'));const path=join(root,freshName);const map=new Map();
  try {
    await writeFile(path,'temporary');
    trackUpload('test-id',path,map,20);
    await new Promise(resolve=>setTimeout(resolve,60));
    assert.equal(map.has('test-id'),false);
    await assert.rejects(()=>readFile(path),{code:'ENOENT'});
  } finally { await rm(root,{recursive:true,force:true}); }
});
