import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('pins the OSINT Toolbox executable dependency', async () => {
  const config = JSON.parse(await readFile(new URL('../config/osint-toolbox-mcp.json', import.meta.url), 'utf8'));
  const server = config.mcpServers?.['osint-toolbox'];

  assert.equal(server?.command, 'uvx');
  assert.deepEqual(server?.args, ['osint-toolbox-mcp==1.1.0']);
});

test('pins the managed Open OSINT checkout and protects every local service with one launch token',async()=>{
  const launcher=await readFile(new URL('../scripts/public-desk-control.zsh',import.meta.url),'utf8');
  const dependency=await readFile(new URL('../config/open-osint.env',import.meta.url),'utf8');
  assert.match(dependency,/OPEN_OSINT_REVISION=[0-9a-f]{40}/);
  assert.match(launcher,/public-desk-token/);
  assert.match(launcher,/Authorization: Bearer \$PUBLIC_DESK_TOKEN/);
  assert.match(launcher,/OSINT_MCP_API_KEY="\$PUBLIC_DESK_TOKEN"/);
  assert.match(launcher,/any_owned_service_running/);
  assert.match(launcher,/process_belongs_to_service/);
  assert.match(launcher,/require-loopback-token\.mjs/);
  assert.match(launcher,/run-osint-mcp-guarded\.py/);
  assert.match(launcher,/run-fastmcp-bridge-authenticated\.py/);
  // Browser links carry a short-lived open code, never the token itself (links land in the browser's history).
  assert.match(launcher,/#open=\$code/);
  assert.doesNotMatch(launcher,/#access=/);
  assert.match(launcher,/PUBLIC_DESK_OPEN_CODE_FILE="\$OPEN_CODE_FILE"/);
});

// The Start script finds uv wherever it was installed: its own installer (~/.local/bin, preferred) or Homebrew/PATH.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const findUvBlock = async () => {
  const launcher = await readFile(new URL('../scripts/public-desk-control.zsh', import.meta.url), 'utf8');
  const match = launcher.match(/# --- find uv ---\n([\s\S]*?)# --- end find uv ---/);
  assert.ok(match, 'the Start script has a find-uv block');
  return match[1];
};
const fakeTools = dir => { mkdirSync(dir, { recursive: true }); for (const name of ['uv', 'uvx']) { writeFileSync(join(dir, name), '#!/bin/sh\n'); chmodSync(join(dir, name), 0o755); } };
const runBlock = (block, home, extraPath) => execFileSync('/bin/zsh', ['-c', `${block}\nprint -r -- "$UV_BIN|$UVX_BIN"`], {
  env: { HOME: home, PATH: `${extraPath}:/usr/bin:/bin` }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

test('Start finds uv installed by Homebrew or anywhere on PATH', { skip: process.platform === 'win32' || !existsSync('/bin/zsh') }, async () => {
  const block = await findUvBlock();
  const root = mkdtempSync(join(tmpdir(), 'public-desk-uv-'));
  try {
    const home = join(root, 'home'); mkdirSync(home);
    const brew = join(root, 'brew-bin'); fakeTools(brew);
    assert.equal(runBlock(block, home, brew), `${brew}/uv|${brew}/uvx`);
    fakeTools(join(home, '.local', 'bin'));
    assert.equal(runBlock(block, home, brew), `${home}/.local/bin/uv|${home}/.local/bin/uvx`, '~/.local/bin is preferred');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Start stops with a clear message when uv is not installed', {
  skip: !existsSync('/bin/zsh') || ['/opt/homebrew/bin/uv', '/usr/local/bin/uv'].some(existsSync)
}, async () => {
  const block = await findUvBlock();
  const root = mkdtempSync(join(tmpdir(), 'public-desk-uv-'));
  try {
    assert.throws(() => runBlock(block, root, join(root, 'nothing')), error => error.status === 1 && /uv is not installed/.test(String(error.stderr)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Start never hard-codes one uv location', async () => {
  const launcher = await readFile(new URL('../scripts/public-desk-control.zsh', import.meta.url), 'utf8');
  assert.doesNotMatch(launcher, /"\$HOME\/\.local\/bin\/uvx?"/);
});

test('the shared controller never falls back to an unmanaged Open OSINT folder', async () => {
  const script = await readFile(new URL('../scripts/public-desk-control.zsh', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /LEGACY_OSINT_ROOT|omprehensive-osint/);
  assert.match(script, /OSINT_ROOT="\$\{PUBLIC_DESK_OSINT_ROOT:-\$MANAGED_OSINT_ROOT\}"/);
});

// The launch token must never be on curl's command line, where any program listing processes could read it.
test('Start health checks send the token without putting it on the command line', { skip: !existsSync('/bin/zsh') || !existsSync('/usr/bin/curl') }, async () => {
  const launcher = await readFile(new URL('../scripts/public-desk-control.zsh', import.meta.url), 'utf8');
  const functions = ['service_ready', 'mcp_ready'].map(name => launcher.match(new RegExp(`${name}\\(\\) \\{[\\s\\S]*?\\n\\}`))[0]).join('\n');
  // The only place the token may appear is the shell's own print (a builtin, so never a separate process) piped to curl.
  const piped = /print -r -- "Authorization: Bearer \$PUBLIC_DESK_TOKEN" \| \/usr\/bin\/curl /g;
  assert.equal((functions.match(piped) || []).length, 2);
  assert.doesNotMatch(launcher.replace(piped, '').split('\n').filter(line => /curl|-H /.test(line)).join('\n'), /PUBLIC_DESK_TOKEN/);
  const http = await import('node:http');
  const seen = [];
  const server = http.createServer((req, res) => { seen.push(req.headers.authorization); req.resume(); res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/check`;
    const run = name => new Promise(resolve => {
      import('node:child_process').then(({ execFile }) => execFile('/bin/zsh', ['-c', `${functions}\n${name} ${url}`], { env: { PATH: '/usr/bin:/bin', PUBLIC_DESK_TOKEN: 'launch-token-for-test' } }, error => resolve(error ? error.code : 0)));
    });
    assert.equal(await run('service_ready'), 0);
    assert.equal(await run('mcp_ready'), 0);
    assert.deepEqual(seen, ['Bearer launch-token-for-test', 'Bearer launch-token-for-test']);
  } finally { server.close(); }
});

test('one Finder launcher starts or opens Public Desk through the shared controller', async () => {
  const main = await readFile(new URL('../Public Desk.command', import.meta.url), 'utf8');
  const start = await readFile(new URL('../Start Public Desk.command', import.meta.url), 'utf8');
  const stop = await readFile(new URL('../Stop Public Desk.command', import.meta.url), 'utf8');
  assert.match(main, /public-desk-control\.zsh" start --open/);
  assert.match(start, /public-desk-control\.zsh" start --open/);
  assert.match(stop, /public-desk-control\.zsh" stop/);
  assert.doesNotMatch(main + start, /while .*is_ready|Keep this window open/);
});

test('the controller verifies all five services and exposes lifecycle actions', async () => {
  const controller = await readFile(new URL('../scripts/public-desk-control.zsh', import.meta.url), 'utf8');
  assert.match(controller, /SERVICES=\(headless mcp osint-toolbox omega signaldesk\)/);
  assert.match(controller, /all_services_ready/);
  assert.match(controller, /start\) start_all/);
  assert.match(controller, /restart\)[\s\S]*stop_all[\s\S]*release_lock[\s\S]*start_all/);
  assert.match(controller, /status\) show_status/);
  assert.match(controller, /diagnostics\) show_diagnostics/);
  assert.match(controller, /kill -KILL[\s\S]*process_belongs_to_service|process_belongs_to_service[\s\S]*kill -KILL/);
  assert.equal((controller.match(/\/usr\/bin\/nohup/g) || []).length, 4, 'all launch paths detach; one bridge path serves two services');
});
