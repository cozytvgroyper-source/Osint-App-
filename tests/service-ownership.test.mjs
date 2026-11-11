import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const script = new URL('../scripts/service-ownership.zsh', import.meta.url).pathname;

function zsh(source) {
  return spawnSync('/bin/zsh', ['-c', `source ${JSON.stringify(script)}; ${source}`], { encoding: 'utf8' });
}

test('service identity requires both the exact folder and command marker', () => {
  assert.equal(zsh(`identity_values_match '/app' 'node /app/server.mjs' '/app' 'server.mjs'`).status, 0);
  assert.notEqual(zsh(`identity_values_match '/other' 'node /app/server.mjs' '/app' 'server.mjs'`).status, 0);
  assert.notEqual(zsh(`identity_values_match '/app' 'node unrelated.mjs' '/app' 'server.mjs'`).status, 0);
});

test('recognizes a live process only when its folder and marker belong to the service', async () => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'pd-owner-')));
  const marker = 'public-desk-owner-marker.mjs';
  await writeFile(join(cwd, marker), 'setInterval(()=>{},1000);');
  const child = spawn(process.execPath, [marker], { cwd, stdio: 'ignore' });
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(zsh(`process_belongs_to_service ${child.pid} ${JSON.stringify(cwd)} ${JSON.stringify(marker)}`).status, 0);
    assert.notEqual(zsh(`process_belongs_to_service ${child.pid} ${JSON.stringify(cwd)} 'wrong-marker'`).status, 0);
    assert.notEqual(zsh(`process_belongs_to_service ${child.pid} '/wrong-folder' ${JSON.stringify(marker)}`).status, 0);
  } finally {
    child.kill();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('refuses to reuse a listening process with the wrong identity', async () => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'pd-listener-')));
  const marker = 'foreign-listener.mjs';
  await writeFile(join(cwd, marker), `import http from 'node:http';\nconst server=http.createServer((q,s)=>s.end('ok')).listen(0,'127.0.0.1',()=>console.log(server.address().port));`);
  const child = spawn(process.execPath, [marker], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const port = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdout.once('data', data => resolve(Number(String(data).trim())));
    });
    const foreign = zsh(`refuse_foreign_listener 'Test service' ${port} '/expected-folder' 'expected-marker'`);
    assert.notEqual(foreign.status, 0);
    assert.match(foreign.stdout, /belongs to another process/);
    assert.equal(zsh(`refuse_foreign_listener 'Test service' ${port} ${JSON.stringify(cwd)} ${JSON.stringify(marker)}`).status, 0);
  } finally {
    child.kill();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('stop launcher verifies ownership before every kill', async () => {
  const stop = await (await import('node:fs/promises')).readFile(new URL('../Stop Public Desk.command', import.meta.url), 'utf8');
  assert.match(stop, /process_belongs_to_service/);
  assert.match(stop, /does not belong to this Public Desk folder/);
});
