import test from 'node:test';
import assert from 'node:assert/strict';

// abuse.ch's APIs (MalwareBazaar, ThreatFox, URLhaus) need an Auth-Key header; Open OSINT sends it only for URLhaus,
// so get_malwarebazaar answered 401. scripts/abuse-ch-auth.mjs adds the saved key to the others. A recording fake
// stands in for fetch, so nothing leaves this machine; the preload wraps whatever fetch exists when it loads.
const seen = [];
globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : null;
  const headers = new Headers(init.headers ?? request?.headers);
  seen.push({ url: String(request ? request.url : input), key: headers.get('auth-key'), accept: headers.get('accept') });
  return new Response('{}');
};
await import('../scripts/abuse-ch-auth.mjs');
const last = () => seen.at(-1);

test('adds the saved abuse.ch key to MalwareBazaar and ThreatFox requests', async () => {
  process.env.URLHAUS_AUTH_KEY = 'abuse-test-key';
  await fetch('https://mb-api.abuse.ch/api/v1/', { method: 'POST', headers: { Accept: 'application/json' } });
  assert.deepEqual(last(), { url: 'https://mb-api.abuse.ch/api/v1/', key: 'abuse-test-key', accept: 'application/json' });
  await fetch(new URL('https://threatfox-api.abuse.ch/api/v1/'));
  assert.equal(last().key, 'abuse-test-key');
  await fetch(new Request('https://mb-api.abuse.ch/api/v1/', { method: 'POST' }));
  assert.equal(last().key, 'abuse-test-key');
});

test('keeps a key the module set itself', async () => {
  process.env.URLHAUS_AUTH_KEY = 'abuse-test-key';
  await fetch('https://urlhaus-api.abuse.ch/v1/urls/recent/limit/10/', { headers: { 'Auth-Key': 'module-own-key' } });
  assert.equal(last().key, 'module-own-key');
});

test('never sends the key anywhere else, including look-alike hosts', async () => {
  process.env.URLHAUS_AUTH_KEY = 'abuse-test-key';
  for (const url of ['https://example.com/api', 'https://feodotracker.abuse.ch/downloads/ipblocklist.json', 'https://mb-api.abuse.ch.evil.example/api/v1/', 'https://evilabuse.ch/api/v1/', 'http://mb-api.abuse.ch/api/v1/']) {
    await fetch(url);
    assert.equal(last().key, null, url);
  }
});

test('sends nothing when no key is saved or the source is disconnected', async () => {
  delete process.env.URLHAUS_AUTH_KEY;
  await fetch('https://mb-api.abuse.ch/api/v1/');
  assert.equal(last().key, null);
});
