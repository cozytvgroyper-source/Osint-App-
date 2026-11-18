import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionHeader, mcpHttpError, withSessionRecovery, mcpSessionKey, rememberSession, forgetSessions } from '../server.mjs';

test('initialize never presents a cached session, other calls do', () => {
  const store = new Map([['omega', 'old-session']]);
  assert.deepEqual(sessionHeader(store, 'omega', 'initialize'), {});
  assert.deepEqual(sessionHeader(store, 'omega', 'tools/call'), { 'mcp-session-id': 'old-session' });
  assert.deepEqual(sessionHeader(store, 'unknown', 'tools/call'), {});
  assert.deepEqual(sessionHeader(store, undefined, 'tools/call'), {});
});

test('a 404 for a call that presented a session means the session expired', () => {
  assert.equal(mcpHttpError(404, 'Session not found', true).code, 'MCP_SESSION_EXPIRED');
  assert.equal(mcpHttpError(404, 'Not Found', false).code, undefined, 'without a session a 404 is an ordinary failure');
  assert.equal(mcpHttpError(500, 'boom', true).code, undefined);
  assert.match(mcpHttpError(404, 'Session not found', true).message, /MCP server returned 404: Session not found/);
});

test('an expired session is dropped, re-initialized and the call retried once', async () => {
  const store = new Map([['omega', 'old-session']]);
  const events = [];
  let attempts = 0;
  const result = await withSessionRecovery({ sessionKey: 'omega' }, async () => {
    attempts += 1;
    events.push(`call ${attempts} with ${store.get('omega') ?? 'no session'}`);
    if (attempts === 1) throw mcpHttpError(404, 'Session not found', true);
    return { ok: true };
  }, async () => { events.push('initialize'); store.set('omega', 'new-session'); }, store);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, ['call 1 with old-session', 'initialize', 'call 2 with new-session']);
});

test('recovery happens at most once and leaves other failures alone', async () => {
  const store = new Map([['omega', 'old-session']]);
  let initializations = 0;
  await assert.rejects(withSessionRecovery({ sessionKey: 'omega' },
    async () => { throw mcpHttpError(404, 'Session not found', true); },
    async () => { initializations += 1; }, store), { code: 'MCP_SESSION_EXPIRED' });
  assert.equal(initializations, 1);

  store.set('omega', 'old-session');
  await assert.rejects(withSessionRecovery({ sessionKey: 'omega' },
    async () => { throw mcpHttpError(500, 'boom', true); },
    async () => { initializations += 1; }, store), /returned 500/);
  assert.equal(initializations, 1, 'a server error does not trigger re-initialization');
  assert.equal(store.get('omega'), 'old-session');
});

// Sessions were kept by the browser's key alone, so a custom server whose address was edited was sent the old
// server's session id, and the list grew by one entry per tab forever. They are now kept per address and capped.
test('a session belongs to one server address', () => {
  const store = new Map();
  const first = mcpSessionKey({ endpoint: 'https://one.example/mcp', sessionKey: 'tab:custom' });
  const moved = mcpSessionKey({ endpoint: 'https://two.example/mcp', sessionKey: 'tab:custom' });
  rememberSession(store, first, 'session-for-one');
  assert.notEqual(first, moved);
  assert.deepEqual(sessionHeader(store, moved, 'tools/call'), {}, 'the new address is never sent the old session');
  assert.equal(mcpSessionKey({ endpoint: 'https://one.example/mcp' }), '', 'no browser key, no session');
});

test('the session list keeps only the most recently used sessions', () => {
  const store = new Map();
  for (let index = 0; index < 5; index++) rememberSession(store, `key-${index}`, `session-${index}`, 3);
  assert.deepEqual([...store.keys()], ['key-2', 'key-3', 'key-4']);
  rememberSession(store, 'key-2', 'session-2b', 3);
  rememberSession(store, 'key-5', 'session-5', 3);
  assert.deepEqual([...store.keys()], ['key-4', 'key-2', 'key-5'], 'a session used again moves to the back');
});

test('disconnecting forgets a browser key\'s session on every address, and recovery drops the right one', async () => {
  const store = new Map();
  const a = mcpSessionKey({ endpoint: 'https://one.example/mcp', sessionKey: 'tab:s' });
  const b = mcpSessionKey({ endpoint: 'https://two.example/mcp', sessionKey: 'tab:s' });
  const other = mcpSessionKey({ endpoint: 'https://one.example/mcp', sessionKey: 'tab:other' });
  for (const key of [a, b, other]) rememberSession(store, key, 'id');
  forgetSessions(store, 'tab:s');
  assert.deepEqual([...store.keys()], [other]);

  rememberSession(store, a, 'expired');
  let attempts = 0;
  await withSessionRecovery({ endpoint: 'https://one.example/mcp', sessionKey: 'tab:s' }, async () => {
    attempts += 1;
    if (attempts === 1) { assert.equal(store.get(a), 'expired'); throw mcpHttpError(404, 'Session not found', true); }
    assert.equal(store.has(a), false, 'the expired session was dropped before the retry');
    return {};
  }, async () => {}, store);
});
