import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The shared controller's single-instance rules, run against a copy of the scripts in a temporary folder so the
// real Public Desk services are never touched: a copy owns no running service, so it sees all five as stopped.
const root = fileURLToPath(new URL('..', import.meta.url));
const skip = !existsSync('/bin/zsh');

function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'pd-control-'));
  mkdirSync(join(dir, 'scripts'));
  for (const file of ['public-desk-control.zsh', 'service-ownership.zsh']) cpSync(join(root, 'scripts', file), join(dir, 'scripts', file));
  mkdirSync(join(dir, 'work', 'runtime'), { recursive: true });
  return { dir, script: join(dir, 'scripts', 'public-desk-control.zsh'), runtime: join(dir, 'work', 'runtime'), lock: join(dir, 'work', 'runtime', 'control.lock') };
}

const control = (app, args, env = {}) => spawnSync('/bin/zsh', [app.script, ...args], { encoding: 'utf8', env: { ...process.env, PUBLIC_DESK_STOP_TIMEOUT: '1', ...env }, timeout: 60_000 });
const status = app => JSON.parse(control(app, ['status', '--json']).stdout.trim().split('\n').at(-1));
const startedAt = pid => spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim().split(/\s+/).join(' ');

function writeLock(app, { pid, started, action = 'start' }) {
  mkdirSync(app.lock);
  if (pid !== undefined) writeFileSync(join(app.lock, 'pid'), `${pid}\n`);
  if (started !== undefined) writeFileSync(join(app.lock, 'started'), `${started}\n`);
  writeFileSync(join(app.lock, 'action'), `${action}\n`);
}

const holder = () => spawn('/bin/sleep', ['60'], { stdio: 'ignore' });

test('status --json reports every service and the overall state without taking the lock', { skip }, () => {
  const app = copy();
  try {
    const result = status(app);
    assert.equal(result.overall, 'stopped');
    assert.equal(result.ready, 0);
    assert.equal(result.action, '');
    assert.deepEqual(result.services.map(service => service.id), ['headless', 'mcp', 'osint-toolbox', 'omega', 'signaldesk']);
    assert.ok(result.services.every(service => service.state === 'stopped' && service.name));
    assert.equal(existsSync(app.lock), false, 'status never creates the control lock');
    assert.match(control(app, ['status']).stdout, /Overall: Stopped/);
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('status shows a start or stop that another launcher is running', { skip }, () => {
  const app = copy();
  const child = holder();
  try {
    writeLock(app, { pid: child.pid, started: startedAt(child.pid), action: 'stop' });
    assert.equal(status(app).action, 'stop');
    assert.match(control(app, ['status']).stdout, /In progress: stop/);
  } finally { child.kill('SIGKILL'); rmSync(app.dir, { recursive: true, force: true }); }
});

test('a lock left by a crashed start is recovered', { skip }, () => {
  const app = copy();
  try {
    const dead = spawnSync('/bin/sh', ['-c', 'echo $$']).stdout.toString().trim();
    writeLock(app, { pid: dead, started: 'Thu Jan 1 00:00:00 1970' });
    assert.equal(status(app).action, '', 'a dead owner is not shown as busy');
    const stop = control(app, ['stop']);
    assert.match(stop.stdout, /Cleared a lock left by an earlier start or stop/);
    assert.match(stop.stdout, /Public Desk services are stopped/);
    assert.equal(existsSync(app.lock), false, 'the lock is released afterwards');
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('a lock whose PID was reused by an unrelated process is recovered', { skip }, () => {
  const app = copy();
  const child = holder();
  try {
    writeLock(app, { pid: child.pid, started: 'Thu Jan 1 00:00:00 1970' });
    assert.equal(status(app).action, '');
    assert.match(control(app, ['stop']).stdout, /Cleared a lock/);
    assert.equal(child.exitCode, null, 'the unrelated process was not touched');
  } finally { child.kill('SIGKILL'); rmSync(app.dir, { recursive: true, force: true }); }
});

test('a lock still being written is respected, but one abandoned before its owner was written is recovered', { skip }, () => {
  const app = copy();
  try {
    mkdirSync(app.lock);
    assert.equal(status(app).action, 'busy', 'a brand-new lock folder belongs to a launcher that is starting');
    const past = new Date(Date.now() - 60_000);
    utimesSync(app.lock, past, past);
    assert.equal(status(app).action, '');
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('a second stop waits for the running one instead of running beside it', { skip, timeout: 60_000 }, async () => {
  const app = copy();
  const child = holder();
  try {
    writeLock(app, { pid: child.pid, started: startedAt(child.pid), action: 'start' });
    const second = spawn('/bin/zsh', [app.script, 'stop'], { env: { ...process.env, PUBLIC_DESK_STOP_TIMEOUT: '1' } });
    let output = '';
    second.stdout.on('data', chunk => { output += chunk; });
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.match(output, /already being started or stopped; waiting/);
    assert.doesNotMatch(output, /services are stopped/, 'it has not run yet');
    child.kill('SIGKILL'); // the first launcher finishes (or crashes); the waiting one then proceeds
    await new Promise(resolve => second.on('exit', resolve));
    assert.match(output, /Public Desk services are stopped/);
  } finally { child.kill('SIGKILL'); rmSync(app.dir, { recursive: true, force: true }); }
});

// zsh runs an EXIT trap set inside a function when that function returns; the lock must outlive acquire_lock.
test('the lock stays held after it is taken and records its owner, start time and action', { skip }, () => {
  const app = copy();
  try {
    const run = spawnSync('/bin/zsh', ['-c', `source ${JSON.stringify(app.script)}; LOCK_ACTION=restart acquire_lock; print -r -- "$(<$LOCK_DIR/pid)|$(<$LOCK_DIR/action)|$(<$LOCK_DIR/started)|$$"; process_started_at $$; print -r -- "$REPLY"`], { encoding: 'utf8' });
    const [line, expectedStart] = run.stdout.trim().split('\n');
    const [pid, action, started, shell] = line.split('|');
    assert.equal(pid, shell);
    assert.equal(action, 'restart');
    assert.equal(started, expectedStart);
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('a running command holds the lock until it ends, and an interrupted one releases it', { skip, timeout: 60_000 }, async () => {
  const app = copy();
  try {
    // A fake lsof that is slow makes stop take a few seconds, long enough to look at the lock while it runs.
    const bin = join(app.dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'lsof'), '#!/bin/zsh\nsleep 1\n');
    chmodSync(join(bin, 'lsof'), 0o755);
    const env = { ...process.env, PUBLIC_DESK_LSOF: join(bin, 'lsof'), PUBLIC_DESK_STOP_TIMEOUT: '1' };
    const first = spawn('/bin/zsh', [app.script, 'stop'], { env });
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(existsSync(join(app.lock, 'pid')), true, 'held while stopping');
    assert.equal(readFileSync(join(app.lock, 'action'), 'utf8').trim(), 'stop');
    assert.equal(status(app).action, 'stop');
    first.kill('SIGTERM');
    const code = await new Promise(resolve => first.on('exit', (exitCode, signal) => resolve(exitCode ?? signal)));
    assert.equal(code, 143, 'an interrupted stop exits instead of carrying on');
    assert.equal(existsSync(app.lock), false, 'and releases the lock');
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('stopping forgets which browser tab had the old token', { skip }, () => {
  const app = copy();
  try {
    writeFileSync(join(app.runtime, 'public-desk-token'), 'old-token');
    writeFileSync(join(app.runtime, 'browser-tab'), 'fingerprint');
    control(app, ['stop']);
    assert.equal(existsSync(join(app.runtime, 'public-desk-token')), false);
    assert.equal(existsSync(join(app.runtime, 'browser-tab')), false);
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

// Opening again reuses the browser tab. Fake pgrep, osascript and open record what would have happened.
function fakeBrowser(app, { running = ['Safari'], answer = 'found' } = {}) {
  const bin = join(app.dir, 'bin');
  mkdirSync(bin);
  const log = join(app.dir, 'calls.log');
  const write = (name, body) => { writeFileSync(join(bin, name), `#!/bin/zsh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  write('pgrep', `[[ " ${running.join(' ')} " == *" $2 "* ]]`);
  write('osascript', `print -r -- "osascript args: $*" >> ${JSON.stringify(log)}; cat >> ${JSON.stringify(log)}; print -r -- ${answer}`);
  write('open', `print -r -- "open $*" >> ${JSON.stringify(log)}`);
  return { log, env: { PUBLIC_DESK_PGREP: join(bin, 'pgrep'), PUBLIC_DESK_OSASCRIPT: join(bin, 'osascript'), PUBLIC_DESK_OPEN: join(bin, 'open') } };
}

const openDesk = (app, env, token) => spawnSync('/bin/zsh', ['-c', `source ${JSON.stringify(app.script)}; PUBLIC_DESK_TOKEN=${token}; open_public_desk`], { encoding: 'utf8', env: { ...process.env, ...env } });
const calls = log => (existsSync(log) ? readFileSync(log, 'utf8') : '');

test('opening Public Desk again brings its existing tab forward instead of opening another', { skip }, () => {
  const app = copy();
  try {
    const browser = fakeBrowser(app, { running: ['Safari'] });
    assert.equal(openDesk(app, browser.env, 'token-one').status, 0);
    const first = calls(browser.log);
    assert.match(first, /tell application "Safari"/);
    assert.match(first, /set URL of t to "http:\/\/127\.0\.0\.1:4173\/#access=token-one"/, 'an unknown tab is given the current token');
    assert.doesNotMatch(first, /^open /m, 'no new tab');
    assert.match(first, /osascript args: -$/m, 'the token goes to osascript on standard input, never its arguments');

    writeFileSync(browser.log, '');
    assert.match(openDesk(app, browser.env, 'token-one').stdout, /Brought the open Public Desk tab to the front/);
    const again = calls(browser.log);
    assert.doesNotMatch(again, /set URL/, 'a tab that already has this token is only brought forward, keeping its page');
    assert.match(again, /set current tab of w to t/);

    writeFileSync(browser.log, '');
    openDesk(app, browser.env, 'token-two');
    assert.match(calls(browser.log), /set URL of t to "http:\/\/127\.0\.0\.1:4173\/#access=token-two"/, 'after a restart the tab reloads with the new token');
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('Chromium browsers are asked too, and a new tab opens only when no tab is found', { skip }, () => {
  const app = copy();
  try {
    const browser = fakeBrowser(app, { running: ['Google Chrome'], answer: 'none' });
    assert.equal(openDesk(app, browser.env, 'token-one').status, 0);
    const log = calls(browser.log);
    assert.doesNotMatch(log, /"Safari"/, 'browsers that are not running are never launched');
    assert.match(log, /tell application "Google Chrome"[\s\S]*set active tab index of w to i/);
    assert.match(log, /^open http:\/\/127\.0\.0\.1:4173\/#access=token-one$/m);
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('with no browser running, Public Desk opens in the default browser', { skip }, () => {
  const app = copy();
  try {
    const browser = fakeBrowser(app, { running: [] });
    openDesk(app, browser.env, 'token-one');
    assert.equal(calls(browser.log).trim(), 'open http://127.0.0.1:4173/#access=token-one');
    assert.equal(readFileSync(join(app.runtime, 'browser-tab'), 'utf8').length, 64, 'the token fingerprint is remembered, not the token');
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

// A restart creates a new token; tabs still holding the old one would fail every search until reopened.
const refreshTabs = (app, env, token) => spawnSync('/bin/zsh', ['-c', `source ${JSON.stringify(app.script)}; PUBLIC_DESK_TOKEN=${token}; refresh_open_tabs`], { encoding: 'utf8', env: { ...process.env, ...env } });

test('after a start or restart, open tabs are reconnected with the new token in the background', { skip }, () => {
  const app = copy();
  try {
    const browser = fakeBrowser(app, { running: ['Safari', 'Google Chrome'], answer: '1' });
    const run = refreshTabs(app, browser.env, 'token-two');
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Reconnected 2 open Public Desk tabs to this session/);
    const log = calls(browser.log);
    assert.equal((log.match(/set URL of t to "http:\/\/127\.0\.0\.1:4173\/#access=token-two"/g) || []).length, 2, 'every running browser is asked');
    assert.doesNotMatch(log, /activate|set index of w|set current tab|active tab index/, 'the browser is not brought forward');
    assert.doesNotMatch(log, /^open /m, 'no new tab is opened');
    assert.match(log, /osascript args: -$/m, 'the token goes on standard input');
    assert.equal(readFileSync(join(app.runtime, 'browser-tab'), 'utf8').length, 64);

    writeFileSync(browser.log, '');
    assert.equal(refreshTabs(app, browser.env, 'token-two').stdout, '', 'tabs that already have this token are left alone');
    assert.equal(calls(browser.log), '');
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('with no Public Desk tab open, nothing is reloaded or remembered', { skip }, () => {
  const app = copy();
  try {
    const browser = fakeBrowser(app, { running: ['Safari'], answer: '0' });
    assert.equal(refreshTabs(app, browser.env, 'token-one').stdout, '');
    assert.equal(existsSync(join(app.runtime, 'browser-tab')), false);
    mkdirSync(join(app.dir, 'other'));
    const none = fakeBrowser({ dir: join(app.dir, 'other') }, { running: [] });
    assert.equal(refreshTabs(app, none.env, 'token-one').stdout, '');
    assert.equal(calls(none.log), '', 'browsers that are not running are never asked or launched');
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('start and restart reconnect open tabs when they do not open a new one', () => {
  const controller = readFileSync(join(root, 'scripts/public-desk-control.zsh'), 'utf8');
  assert.match(controller, /if \[\[ "\$\{1:-\}" == "--open" \]\]; then open_public_desk \|\| return 1\s+else refresh_open_tabs\s+fi/);
});

// Stopping Public Desk closes its tabs: they could no longer do anything. Restart keeps them (they reconnect).
const closeTabs = (app, env) => spawnSync('/bin/zsh', ['-c', `source ${JSON.stringify(app.script)}; close_open_tabs`], { encoding: 'utf8', env: { ...process.env, ...env } });

test('closing Public Desk tabs asks every running browser and reports how many closed', { skip }, () => {
  const app = copy();
  try {
    const browser = fakeBrowser(app, { running: ['Safari', 'Google Chrome'], answer: '2' });
    const run = closeTabs(app, browser.env);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), 'Closed 4 Public Desk tabs.');
    const log = calls(browser.log);
    assert.equal((log.match(/close t\n/g) || []).length, 2, 'Safari and Chrome are both asked');
    assert.match(log, /if \(URL of t as text\) starts with "http:\/\/127\.0\.0\.1:4173" then\s+close t/, 'only Public Desk tabs');
    assert.match(log, /repeat with windowIndex from \(count of windows\) to 1 by -1[\s\S]*repeat with tabIndex from \(count of tabs of w\) to 1 by -1/, 'walked backwards so closing does not skip tabs');
    assert.doesNotMatch(log, /activate|set URL|#access=/, 'never brought forward, reloaded or given a token');
    assert.doesNotMatch(log, /^open /m);
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('with no Public Desk tab open, or no browser running, closing says and does nothing', { skip }, () => {
  const app = copy();
  try {
    const none = fakeBrowser(app, { running: ['Safari'], answer: '0' });
    assert.equal(closeTabs(app, none.env).stdout, '');
    mkdirSync(join(app.dir, 'other'));
    const idle = fakeBrowser({ dir: join(app.dir, 'other') }, { running: [] });
    assert.equal(closeTabs(app, idle.env).stdout, '');
    assert.equal(calls(idle.log), '', 'a browser that is not running is never launched');
    const off = fakeBrowser({ dir: (mkdirSync(join(app.dir, 'off')), join(app.dir, 'off')) }, { running: ['Safari'], answer: '1' });
    assert.equal(closeTabs(app, { ...off.env, PUBLIC_DESK_REUSE_TAB: '0' }).stdout, '');
    assert.equal(calls(off.log), '', 'PUBLIC_DESK_REUSE_TAB=0 leaves the browser alone');
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('Stop closes the open Public Desk tabs, and Restart keeps them', { skip, timeout: 60_000 }, () => {
  const app = copy();
  try {
    const browser = fakeBrowser(app, { running: ['Safari'], answer: '1' });
    // A stand-in lsof that sees no services: a Public Desk running on this Mac holds the same ports, and this copy
    // would rightly refuse to stop it, fail, and keep the tabs, which made the test depend on the machine's state.
    writeFileSync(join(app.dir, 'bin', 'lsof'), '#!/bin/zsh\nexit 0\n');
    chmodSync(join(app.dir, 'bin', 'lsof'), 0o755);
    browser.env.PUBLIC_DESK_LSOF = join(app.dir, 'bin', 'lsof');
    const stop = control(app, ['stop'], browser.env);
    assert.equal(stop.status, 0, stop.stderr);
    assert.match(stop.stdout, /Public Desk services are stopped\.\nClosed 1 Public Desk tab\./);
    assert.match(calls(browser.log), /close t/);

    writeFileSync(browser.log, '');
    control(app, ['restart'], browser.env); // this copy has no dependencies, so the start half fails; tabs still stay
    assert.doesNotMatch(calls(browser.log), /close t/, 'restart never closes tabs');
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('a stop that leaves something running keeps the tabs open', () => {
  const controller = readFileSync(join(root, 'scripts/public-desk-control.zsh'), 'utf8');
  assert.match(controller, /stop\) LOCK_ACTION=stop stop_all && close_open_tabs ;;/);
  assert.doesNotMatch(controller.match(/restart\)[\s\S]*?;;/)[0], /close_open_tabs/);
});

// Each start writes a fresh service log; the previous run's log is kept as .log.1 so the reason a service stopped
// survives its restart. Only one previous log is kept, and an empty log is not kept at all.
test('starting a service keeps its previous log as .log.1', { skip }, () => {
  const app = copy();
  try {
    const logs = join(app.dir, 'logs'); mkdirSync(logs);
    const rotate = name => spawnSync('/bin/zsh', ['-c', `source ${JSON.stringify(app.script)}; rotate_log ${JSON.stringify(join(logs, name))}`], { encoding: 'utf8' });
    writeFileSync(join(logs, 'omega.log'), 'first run: Omega crashed here\n');
    assert.equal(rotate('omega.log').status, 0);
    assert.equal(existsSync(join(logs, 'omega.log')), false, 'the service then writes a fresh log');
    assert.equal(readFileSync(join(logs, 'omega.log.1'), 'utf8'), 'first run: Omega crashed here\n');
    writeFileSync(join(logs, 'omega.log'), 'second run\n');
    rotate('omega.log');
    assert.equal(readFileSync(join(logs, 'omega.log.1'), 'utf8'), 'second run\n', 'only the latest previous run is kept');
    writeFileSync(join(logs, 'empty.log'), '');
    assert.equal(rotate('empty.log').status, 0);
    assert.equal(existsSync(join(logs, 'empty.log.1')), false, 'an empty log is not kept');
    assert.equal(rotate('missing.log').status, 0, 'a first start has nothing to keep');
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('every service start rotates its log just before writing a fresh one', () => {
  const controller = readFileSync(join(root, 'scripts/public-desk-control.zsh'), 'utf8');
  for (const log of ['headless', 'mcp', '$service', 'signaldesk']) {
    const pattern = new RegExp(`rotate_log "\\$LOG_DIR/${log.replace('$', '\\$')}\\.log"\\s+\\([\\s\\S]*?>"\\$LOG_DIR/${log.replace('$', '\\$')}\\.log"`);
    assert.match(controller, pattern, log);
  }
});

test('the page reloads with a new token handed to an already-open tab', () => {
  const core = readFileSync(join(root, 'public/app/core.js'), 'utf8');
  assert.match(core, /addEventListener\('hashchange'[\s\S]*?get\('access'\)[\s\S]*?setItem\('publicDesk\.access', access\)[\s\S]*?location\.reload\(\)/);
});
