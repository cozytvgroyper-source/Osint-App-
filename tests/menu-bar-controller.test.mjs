import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  // One copy is enforced by the app's file lock; the LaunchServices key would block the self-update handover.
  assert.doesNotMatch(build, /plutil -insert LSMultipleInstancesProhibited/);
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
  assert.equal(info.LSMultipleInstancesProhibited, undefined);
  const hash = spawnSync('/bin/zsh', [join(root, 'scripts/build-menu-bar-app.zsh'), '--source-hash'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(info.PublicDeskSourceHash, hash, 'the app records the source it was built from');
  // The icon: every size macOS uses, packed into the bundle and named in Info.plist.
  assert.equal(info.CFBundleIconFile, 'AppIcon');
  const iconset = join(mkdtempSync(join(tmpdir(), 'pd-iconset-')), 'AppIcon.iconset');
  try {
    assert.equal(spawnSync('/usr/bin/iconutil', ['-c', 'iconset', join(bundle, 'Contents/Resources/AppIcon.icns'), '-o', iconset]).status, 0);
    const sizes = [16, 32, 128, 256, 512].flatMap(size => [`icon_${size}x${size}.png`, `icon_${size}x${size}@2x.png`]);
    for (const file of sizes) assert.ok(existsSync(join(iconset, file)), file);
  } finally { rmSync(join(iconset, '..'), { recursive: true, force: true }); }
  // The build checks the signature strictly before copying; macOS may then tag the copy with a provenance
  // attribute, which strict mode calls detritus but which leaves the signature itself intact.
  const verify = spawnSync('/usr/bin/codesign', ['--verify', '--deep', bundle], { encoding: 'utf8' });
  assert.equal(verify.status, 0, verify.stderr);
});

// The controller updates itself when this fingerprint differs from the one it was built from.
test('the source fingerprint changes with the app\'s code but not with the control script', { skip: !existsSync('/bin/zsh') }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-hash-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    cpSync(join(root, 'macos'), join(dir, 'macos'), { recursive: true });
    for (const file of ['build-menu-bar-app.zsh', 'public-desk-control.zsh']) cpSync(join(root, 'scripts', file), join(dir, 'scripts', file));
    const hash = () => {
      const run = spawnSync('/bin/zsh', [join(dir, 'scripts/build-menu-bar-app.zsh'), '--source-hash'], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      return run.stdout.trim();
    };
    const first = hash();
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(hash(), first, 'stable');
    appendFileSync(join(dir, 'scripts/public-desk-control.zsh'), '\n# changed\n');
    assert.equal(hash(), first, 'control-script changes apply without a rebuild');
    appendFileSync(join(dir, 'macos/PublicDeskController/App.swift'), '\n// changed\n');
    const second = hash();
    assert.notEqual(second, first);
    appendFileSync(join(dir, 'scripts/build-menu-bar-app.zsh'), '\n# changed\n');
    const third = hash();
    assert.notEqual(third, second, 'a changed build recipe rebuilds too');
    appendFileSync(join(dir, 'macos/Icon/DrawIcon.swift'), '\n// changed\n');
    assert.notEqual(hash(), third, 'so does a changed icon');
    assert.equal(existsSync(join(dir, 'work')), false, '--source-hash builds nothing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the app checks for updates only when installed by the build script, and never while Public Desk is busy', () => {
  const app = readFileSync(sources[1], 'utf8');
  assert.match(app, /PublicDeskSourceHash/);
  assert.match(app, /isBusy: \{ \[weak controller\] in controller\?\.state\.isBusy \?\? true \}/);
  assert.match(app, /15 \* 60/);
  assert.match(app, /Retry Controller Update/);
  // macOS ends an app's child processes with it, so a self-update must not stop the controller from the build script:
  // --no-launch skips that and the app hands over to the new copy itself.
  const build = readFileSync(join(root, 'scripts/build-menu-bar-app.zsh'), 'utf8');
  assert.match(build, /if \(\( LAUNCH \)\) && \/usr\/bin\/pgrep -xq "\$NAME"; then/);
  assert.match(app, /private func relaunch\(\) -> Bool \{\s*lock\.release\(\)[\s\S]*?"-n"[\s\S]*?NSApp\.terminate/);
});

// The app icon is the sidebar's brand mark; if the mark's look changes in the stylesheet, the icon must follow.
test('the app icon matches the brand mark in the sidebar', () => {
  const css = readFileSync(join(root, 'public/ui.css'), 'utf8');
  const mark = [...css.matchAll(/\.brand-mark\{([^}]*)\}/g)].map(match => match[1]).at(-1);
  const icon = readFileSync(join(root, 'macos/Icon/DrawIcon.swift'), 'utf8');
  const hex = value => `0x${value.replace('#', '').toUpperCase()}`;
  const [, angle, from, middle, stop, to] = mark.match(/linear-gradient\((\d+)deg,(#\w+),(#\w+) (\d+)%,(#\w+)\)/);
  const letter = mark.match(/color:(#\w+)/)[1];
  assert.match(icon, new RegExp(`let radians = ${angle} \\*`), 'gradient angle');
  assert.ok(icon.includes(`[color(${hex(from === '#fff' ? '#ffffff' : from)}), color(${hex(middle)}), color(${hex(to === '#fff' ? '#ffffff' : to)})]`), 'gradient colours');
  assert.ok(icon.includes(`locations: [0, 0.${stop}, 1]`), 'gradient stop');
  assert.ok(icon.includes(`color(${hex(letter)})`), 'letter colour');
  assert.match(css, /\.brand-mark\{[^}]*font-family:Georgia,serif;font-style:italic/);
  assert.match(icon, /"Georgia-BoldItalic"/);
  assert.match(readFileSync(join(root, 'public/index.html'), 'utf8'), /<span class="brand-mark">P<\/span>/);
  assert.match(icon, /string: "P"/);
});

test('the icon is drawn at 1024 × 1024 without image files or SF Symbols', { skip: noSwift, timeout: 300_000 }, () => {
  const source = readFileSync(join(root, 'macos/Icon/DrawIcon.swift'), 'utf8');
  assert.doesNotMatch(source, /systemSymbolName|NSImage\(named|import AppKit/, 'drawn with Core Graphics, not SF Symbols or files');
  const dir = mkdtempSync(join(tmpdir(), 'pd-icon-'));
  try {
    const binary = join(dir, 'draw-icon');
    const build = spawnSync('/usr/bin/xcrun', ['swiftc', '-O', '-o', binary, join(root, 'macos/Icon/DrawIcon.swift')], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const png = join(dir, 'AppIcon.png');
    assert.equal(spawnSync(binary, [png]).status, 0);
    const info = spawnSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', png], { encoding: 'utf8' }).stdout;
    assert.match(info, /pixelWidth: 1024/);
    assert.match(info, /pixelHeight: 1024/);
    assert.match(info, /hasAlpha: yes/, 'transparent around the rounded tile');
    assert.notEqual(spawnSync(binary, []).status, 0, 'a missing output path is refused');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
