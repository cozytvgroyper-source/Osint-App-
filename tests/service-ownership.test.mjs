import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/service-ownership.zsh', import.meta.url));

function zsh(source, env = {}) {
  return spawnSync('/bin/zsh', ['-c', `source ${JSON.stringify(script)}; ${source}`], { encoding: 'utf8', env: { ...process.env, ...env } });
}

// Without lsof the launcher cannot tell who owns a port, so it must refuse rather than treat the port as free.
test('refuses to reuse or stop anything when lsof cannot be run', () => {
  const missing = { PUBLIC_DESK_LSOF: '/nonexistent/lsof' };
  const refused = zsh(`refuse_foreign_listener 'Test service' 4173 '/app' 'server.mjs'`, missing);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stdout, /cannot check who is using port 4173/);
  // The test shell itself matches its own folder and command, so only the missing lsof makes this fail.
  assert.equal(zsh(`process_belongs_to_service $$ "$PWD" 'zsh'`).status, 0);
  assert.notEqual(zsh(`process_belongs_to_service $$ "$PWD" 'zsh'`, missing).status, 0);
});

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

// Runs the real Stop script on a throwaway copy of the app folder: a process that belongs to that folder is stopped,
// while an unrelated process whose number sits in a pid file is left running.
test('stop launcher stops its own process and leaves an unrelated one running', { skip: !spawnSync('/bin/zsh', ['-c', 'command -v lsof']).stdout?.toString().trim() }, async () => {
  const fs = await import('node:fs/promises');
  const app = await realpath(await mkdtemp(join(tmpdir(), 'public-desk-stop-')));
  const elsewhere = await realpath(await mkdtemp(join(tmpdir(), 'public-desk-other-')));
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const idle = 'setInterval(()=>{},1000)';
  const owned = spawn(process.execPath, ['-e', idle, 'server.mjs'], { cwd: app, stdio: 'ignore' });
  const foreign = spawn(process.execPath, ['-e', idle, 'server.mjs'], { cwd: elsewhere, stdio: 'ignore' });
  try {
    await fs.mkdir(join(app, 'scripts'), { recursive: true });
    await fs.mkdir(join(app, 'work', 'runtime'), { recursive: true });
    await fs.copyFile(fileURLToPath(new URL('../Stop Public Desk.command', import.meta.url)), join(app, 'Stop Public Desk.command'));
    await fs.copyFile(script, join(app, 'scripts', 'service-ownership.zsh'));
    await writeFile(join(app, 'work', 'runtime', 'signaldesk.pid'), String(owned.pid));
    await writeFile(join(app, 'work', 'runtime', 'omega.pid'), String(foreign.pid));
    await new Promise(resolve => setTimeout(resolve, 300));
    const result = spawnSync('/bin/zsh', [join(app, 'Stop Public Desk.command')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Stopped signaldesk\./);
    assert.match(result.stdout, new RegExp(`Did not stop PID ${foreign.pid} for omega`));
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(alive(owned.pid), false, 'its own process was stopped');
    assert.equal(alive(foreign.pid), true, 'the unrelated process is still running');
  } finally {
    owned.kill(); foreign.kill();
    await rm(app, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});
