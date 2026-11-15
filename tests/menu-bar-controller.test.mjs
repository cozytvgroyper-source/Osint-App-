import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The menu-bar controller is Swift. Its logic (state mapping, command execution, duplicate prevention, stale-lock
// recovery, failure handling and menu actions) is tested by macos/Tests/main.swift, built here with Apple's free
// command line tools. Skipped where there is no Swift compiler (only macOS runs the controller).
const root = fileURLToPath(new URL('..', import.meta.url));
const swiftc = spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
const noSwift = process.platform !== 'darwin' || swiftc.status !== 0;
const sources = ['macos/PublicDeskController/Core.swift', 'macos/PublicDeskController/App.swift'].map(file => join(root, file));

test('the controller logic passes its Swift tests', { skip: noSwift, timeout: 300_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-swift-'));
  try {
    const binary = join(dir, 'controller-tests');
    const build = spawnSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-o', binary, sources[0], join(root, 'macos/Tests/main.swift')], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 120_000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /^ok - \d+ checks passed/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the menu-bar app compiles', { skip: noSwift, timeout: 300_000 }, () => {
  const check = spawnSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-parse-as-library', '-typecheck', ...sources], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});

test('the controller offers exactly the requested menu actions and drives only the shared control script', () => {
  const core = readFileSync(sources[0], 'utf8');
  const app = readFileSync(sources[1], 'utf8');
  for (const title of ['Open Public Desk', 'Start', 'Stop', 'Restart', 'Status', 'Diagnostics', 'Quit Controller']) {
    assert.match(core, new RegExp(`= "${title}"`), title);
  }
  assert.match(app, /scripts\/public-desk-control\.zsh/);
  // Service management stays in the zsh controller: the app never launches, kills or probes services itself.
  assert.doesNotMatch(core + app, /server\.mjs|lsof|kill\(|curl|127\.0\.0\.1|nohup/);
  assert.match(core, /\["status", "--json"\]/);
  // Quitting releases only the controller's own lock.
  assert.match(app, /applicationWillTerminate[\s\S]*?lock\.release\(\)/);
  assert.doesNotMatch(app.match(/@objc private func quit\(\) \{[\s\S]*?\n {4}\}/)[0], /perform|choose|stop/);
});

test('the app is built as a single-instance menu-bar app without a paid developer account', () => {
  const build = readFileSync(join(root, 'scripts/build-menu-bar-app.zsh'), 'utf8');
  assert.match(build, /LSUIElement -bool YES/);
  assert.match(build, /LSMultipleInstancesProhibited -bool YES/);
  assert.match(build, /NSAppleEventsUsageDescription/);
  assert.match(build, /codesign --force --sign - /, 'ad-hoc signing only');
  assert.doesNotMatch(build, /Developer ID|notarytool|--sign "?[A-Z0-9]{10}/);
  const app = readFileSync(sources[1], 'utf8');
  assert.match(app, /SMAppService\.mainApp/, 'Start at Login uses the built-in login-item service');
  assert.match(app, /lock\.acquire\(\)[\s\S]*?showMenuNotification[\s\S]*?exit\(0\)/, 'a second copy hands off and exits');
});

test('the build script produces a signed bundle that remembers this folder', { skip: noSwift || !existsSync('/usr/bin/codesign'), timeout: 300_000 }, () => {
  const run = spawnSync('/bin/zsh', [join(root, 'scripts/build-menu-bar-app.zsh'), '--build-only'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const bundle = join(root, 'work/build/menu-bar/Public Desk.app');
  const plist = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' });
  const info = JSON.parse(plist.stdout);
  assert.equal(info.PublicDeskRoot, root.replace(/\/$/, ''));
  assert.equal(info.LSUIElement, true);
  assert.equal(info.LSMultipleInstancesProhibited, true);
  assert.equal(spawnSync('/usr/bin/codesign', ['--verify', '--strict', bundle]).status, 0);
});
