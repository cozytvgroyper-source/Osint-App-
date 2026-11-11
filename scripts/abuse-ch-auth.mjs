// Preload for the Open OSINT data service. abuse.ch's APIs (MalwareBazaar, ThreatFox, URLhaus) require an Auth-Key
// header, and one free key covers all three. Open OSINT sends it only for URLhaus, so get_malwarebazaar answered 401
// and ThreatFox failed. Loaded with `node --import`, it adds the saved key (URLHAUS_AUTH_KEY, which the Data sources
// panel sets live) to HTTPS requests to those API hosts that carry no Auth-Key of their own. The key is read on every
// call, so connecting or disconnecting it applies at once, and it is never sent to any other host.
const API_HOSTS = new Set(['mb-api.abuse.ch', 'threatfox-api.abuse.ch', 'urlhaus-api.abuse.ch']);
const originalFetch = globalThis.fetch;

globalThis.fetch = function fetchWithAbuseChKey(input, init) {
  const key = process.env.URLHAUS_AUTH_KEY;
  if (!key) return originalFetch(input, init);
  let url;
  try { url = new URL(input instanceof Request ? input.url : String(input)); } catch { return originalFetch(input, init); }
  if (url.protocol !== 'https:' || !API_HOSTS.has(url.hostname)) return originalFetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (headers.has('auth-key')) return originalFetch(input, init);
  headers.set('Auth-Key', key);
  return originalFetch(input, { ...init, headers });
};
