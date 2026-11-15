import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `public-desk-control.zsh backup`: cases, saved searches, the search history log and API keys, in one owner-only
// archive per backup. Run against a copy of the scripts with stand-in data, never the real work/.
const root = fileURLToPath(new URL('..', import.meta.url));
const skip = !existsSync('/bin/zsh') || !existsSync('/usr/bin/tar');

function copyWithData() {
  const dir = mkdtempSync(join(tmpdir(), 'pd-backup-'));
  mkdirSync(join(dir, 'scripts'));
  for (const file of ['public-desk-control.zsh', 'service-ownership.zsh']) cpSync(join(root, 'scripts', file), join(dir, 'scripts', file));
  const work = join(dir, 'work');
  for (const folder of ['cases', 'deep-search-runs', 'logs', 'runtime', 'uploads']) mkdirSync(join(work, folder), { recursive: true });
  writeFileSync(join(work, 'cases', 'case-1.json'), '{"name":"Case one"}');
  writeFileSync(join(work, 'cases', 'case-2.json'), '{"name":"Case two"}');
  writeFileSync(join(work, 'deep-search-runs', 'run-1.json'), '{"id":"run-1"}');
  writeFileSync(join(work, 'deep-search-audit.jsonl'), '{"runId":"run-1"}\n');
  writeFileSync(join(work, 'api-keys.env'), 'EXAMPLE_KEY=stand-in\n');
  writeFileSync(join(work, 'consensus-auth.json'), '{"refresh":"stand-in"}');
  writeFileSync(join(work, 'logs', 'omega.log'), 'log');
  return { dir, work, script: join(dir, 'scripts', 'public-desk-control.zsh'), backups: join(work, 'backups') };
}

const backup = (app, args = [], env = {}) => spawnSync('/bin/zsh', [app.script, 'backup', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const archives = app => (existsSync(app.backups) ? readdirSync(app.backups).filter(name => name.endsWith('.tar.gz')).sort() : []);
const contents = file => spawnSync('/usr/bin/tar', ['-tzf', file], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();

test('a backup holds cases, saved searches, the history log and API keys, and nothing else', { skip }, () => {
  const app = copyWithData();
  try {
    const run = backup(app);
    assert.equal(run.status, 0, run.stderr);
    const [name] = archives(app);
    assert.match(name, /^public-desk-backup-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/);
    assert.equal(run.stdout.trim(), `Backed up 2 cases and 1 saved search to backups/${name}.`);
    assert.deepEqual(contents(join(app.backups, name)), ['api-keys.env', 'cases/', 'cases/case-1.json', 'cases/case-2.json',
      'deep-search-audit.jsonl', 'deep-search-runs/', 'deep-search-runs/run-1.json']);
    assert.equal(statSync(join(app.backups, name)).mode & 0o777, 0o600, 'owner-only archive');
    assert.equal(statSync(app.backups).mode & 0o777, 0o700, 'owner-only folder');
    // It restores to the same files.
    const restored = mkdtempSync(join(tmpdir(), 'pd-restore-'));
    spawnSync('/usr/bin/tar', ['-xzf', join(app.backups, name), '-C', restored]);
    assert.equal(readFileSync(join(restored, 'cases', 'case-2.json'), 'utf8'), '{"name":"Case two"}');
    assert.equal(readFileSync(join(restored, 'api-keys.env'), 'utf8'), 'EXAMPLE_KEY=stand-in\n');
    rmSync(restored, { recursive: true, force: true });
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('with nothing to keep yet, no backup or folder is made', { skip }, () => {
  const app = copyWithData();
  try {
    for (const item of ['cases', 'deep-search-runs', 'deep-search-audit.jsonl', 'api-keys.env']) rmSync(join(app.work, item), { recursive: true });
    const run = backup(app);
    assert.equal(run.status, 0);
    assert.equal(run.stdout.trim(), 'Nothing to back up yet.');
    assert.equal(existsSync(app.backups), false);
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('the daily check backs up only when the newest backup is a day old', { skip }, () => {
  const app = copyWithData();
  try {
    backup(app, ['--if-due']);
    assert.equal(archives(app).length, 1, 'the first one is always due');
    const again = backup(app, ['--if-due']);
    assert.equal(again.status, 0);
    assert.equal(again.stdout, '', 'silent when not due');
    assert.equal(archives(app).length, 1);
    const old = new Date(Date.now() - 25 * 3600 * 1000);
    utimesSync(join(app.backups, archives(app)[0]), old, old);
    spawnSync('/bin/sleep', ['1']); // a new name needs a new second
    backup(app, ['--if-due']);
    assert.equal(archives(app).length, 2, 'a day later it backs up again');
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('only the newest 14 backups are kept', { skip }, () => {
  const app = copyWithData();
  try {
    mkdirSync(app.backups);
    for (let day = 1; day <= 16; day++) {
      const file = join(app.backups, `public-desk-backup-2026-10-${String(day).padStart(2, '0')}-120000.tar.gz`);
      writeFileSync(file, 'old');
      const when = new Date(2026, 9, day, 12);
      utimesSync(file, when, when);
    }
    writeFileSync(join(app.backups, 'notes.txt'), 'not a backup'); // anything else in the folder is left alone
    backup(app);
    const kept = archives(app);
    assert.equal(kept.length, 14);
    assert.ok(!kept.includes('public-desk-backup-2026-10-01-120000.tar.gz') && !kept.includes('public-desk-backup-2026-10-03-120000.tar.gz'), 'oldest removed');
    assert.ok(kept.includes('public-desk-backup-2026-10-16-120000.tar.gz'));
    assert.ok(existsSync(join(app.backups, 'notes.txt')));
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});

test('backups follow PUBLIC_DESK_WORK_DIR, where the server keeps its data', { skip }, () => {
  const app = copyWithData();
  const elsewhere = mkdtempSync(join(tmpdir(), 'pd-data-'));
  try {
    mkdirSync(join(elsewhere, 'cases'));
    writeFileSync(join(elsewhere, 'cases', 'moved.json'), '{}');
    const run = backup(app, [], { PUBLIC_DESK_WORK_DIR: elsewhere });
    assert.match(run.stdout, /Backed up 1 case and 0 saved searches/);
    assert.equal(readdirSync(join(elsewhere, 'backups')).length, 1);
    assert.equal(existsSync(app.backups), false, 'not the default folder');
  } finally { rmSync(app.dir, { recursive: true, force: true }); rmSync(elsewhere, { recursive: true, force: true }); }
});

test('a backup that cannot be written fails clearly and leaves no partial file', { skip }, () => {
  const app = copyWithData();
  try {
    writeFileSync(app.backups, 'a file where the backups folder should be'); // nothing can be written inside it
    const run = backup(app);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /The backup could not be written to .*backups\./);
    assert.equal(readFileSync(app.backups, 'utf8'), 'a file where the backups folder should be', 'left untouched');
    assert.deepEqual(readdirSync(app.work).filter(name => name.includes('partial')), []);
  } finally { rmSync(app.dir, { recursive: true, force: true }); }
});
