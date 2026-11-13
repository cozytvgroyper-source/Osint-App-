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
  const launcher=await readFile(new URL('../Start Public Desk.command',import.meta.url),'utf8');
  const dependency=await readFile(new URL('../config/open-osint.env',import.meta.url),'utf8');
  assert.match(dependency,/OPEN_OSINT_REVISION=[0-9a-f]{40}/);
  assert.match(launcher,/public-desk-token/);
  assert.match(launcher,/Authorization: Bearer \$PUBLIC_DESK_TOKEN/);
  assert.match(launcher,/OSINT_MCP_API_KEY="\$PUBLIC_DESK_TOKEN"/);
  assert.match(launcher,/cohort_is_running=false/);
  assert.match(launcher,/process_belongs_to_service/);
  assert.match(launcher,/require-loopback-token\.mjs/);
  assert.match(launcher,/run-osint-mcp-guarded\.py/);
  assert.match(launcher,/run-fastmcp-bridge-authenticated\.py/);
  assert.match(launcher,/#access=\$PUBLIC_DESK_TOKEN/);
});

// The Start script finds uv wherever it was installed: its own installer (~/.local/bin, preferred) or Homebrew/PATH.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const findUvBlock = async () => {
  const launcher = await readFile(new URL('../Start Public Desk.command', import.meta.url), 'utf8');
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
    assert.throws(() => runBlock(block, root, join(root, 'nothing')), error => error.status === 1 && /uv is not installed/.test(String(error.stdout)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Start never hard-codes one uv location', async () => {
  const launcher = await readFile(new URL('../Start Public Desk.command', import.meta.url), 'utf8');
  assert.doesNotMatch(launcher, /"\$HOME\/\.local\/bin\/uvx?"/);
});
