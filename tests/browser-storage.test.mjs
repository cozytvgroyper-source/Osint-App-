import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStoredState, limitEvidence, mergeStoredServers, persistStoredState, STORAGE_KEYS } from '../public/browser-storage.js';

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); this.failKey = null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    if (key === this.failKey) {
      const error = new Error('full'); error.name = 'QuotaExceededError'; throw error;
    }
    this.values.set(key, value);
  }
}

const evidence = index => ({ title: `Result ${index}`, time: '2026-11-11T00:00:00.000Z', result: { value: index } });

test('damaged or wrongly shaped saved values cannot prevent startup', () => {
  const storage = new MemoryStorage({
    [STORAGE_KEYS.servers]: '{broken',
    [STORAGE_KEYS.history]: '{}',
    [STORAGE_KEYS.evidence]: JSON.stringify([evidence(1)]),
    [STORAGE_KEYS.toolHealth]: '[]'
  });
  const loaded = loadStoredState(storage);
  assert.deepEqual(loaded.servers, []);
  assert.deepEqual(loaded.history, []);
  assert.equal(loaded.evidence.length, 1);
  assert.deepEqual(loaded.toolHealth, {});
  assert.equal(loaded.warnings.length, 3);
});

test('keeps recoverable entries and ignores malformed array members', () => {
  const storage = new MemoryStorage({
    [STORAGE_KEYS.servers]: JSON.stringify([{ name: 'Good', endpoint: 'https://example.com/mcp' }, { nope: true }]),
    [STORAGE_KEYS.history]: JSON.stringify([{ title: 'Good' }, null]),
    [STORAGE_KEYS.evidence]: JSON.stringify([evidence(1), { title: 'Missing result' }])
  });
  const loaded = loadStoredState(storage);
  assert.equal(loaded.servers.length, 1);
  assert.equal(loaded.history.length, 1);
  assert.equal(loaded.evidence.length, 1);
});

test('limits evidence by item count and serialized byte size', () => {
  assert.equal(limitEvidence(Array.from({ length: 8 }, (_, index) => evidence(index)), { maxItems: 3, maxBytes: 100_000 }).evidence.length, 3);
  const result = limitEvidence([evidence('x'.repeat(200)), evidence(2)], { maxItems: 10, maxBytes: 120 });
  assert.equal(result.evidence.length, 0);
  assert.equal(result.dropped, 2);
});

test('quota failures keep the previous stored evidence and return a clear warning', () => {
  const original = JSON.stringify([evidence('original')]);
  const storage = new MemoryStorage({ [STORAGE_KEYS.evidence]: original });
  storage.failKey = STORAGE_KEYS.evidence;
  const result = persistStoredState(storage, { servers: [], history: [], evidence: [evidence('new')], toolHealth: {} });
  assert.equal(storage.getItem(STORAGE_KEYS.evidence), original);
  assert.match(result.warnings.join(' '), /storage is full/i);
});

test('never persists bearer-token-like fields from server records', () => {
  const storage = new MemoryStorage();
  persistStoredState(storage, { servers: [{ name: 'Custom', endpoint: 'https://example.com/mcp', token: 'secret', authorization: 'Bearer secret', tools: [{}] }], history: [], evidence: [], toolHealth: {} });
  const saved = storage.getItem(STORAGE_KEYS.servers);
  assert.doesNotMatch(saved, /secret|authorization|tools/);
});

test('persists bundled-server disable choices without affecting other saved state', () => {
  const storage = new MemoryStorage();
  persistStoredState(storage, { servers: [], history: [], evidence: [], toolHealth: {}, disabledBundledEndpoints: new Set(['http://127.0.0.1:8894/mcp']) });
  assert.deepEqual(loadStoredState(storage).disabledBundledEndpoints, ['http://127.0.0.1:8894/mcp']);
});

test('disabled bundled servers stay absent after startup while custom servers remain', () => {
  const bundled=[{id:'local',name:'Local',endpoint:'http://127.0.0.1:8892/mcp'}];
  const custom={id:'custom',name:'Custom',endpoint:'https://example.com/mcp'};
  assert.deepEqual(mergeStoredServers(bundled,[bundled[0],custom],new Set([bundled[0].endpoint])).map(server=>server.id),['custom']);
  assert.deepEqual(mergeStoredServers(bundled,[],[]).map(server=>server.id),['local']);
});
