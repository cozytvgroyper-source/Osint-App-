import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionHeader, mcpHttpError, withSessionRecovery } from '../server.mjs';

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
