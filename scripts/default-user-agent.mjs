// Preload for services Public Desk starts but does not own (the bundled Open OSINT data service). Node's fetch
// sends "User-Agent: node" unless told otherwise, and some public APIs refuse that: rdap.org answers HTTP 403,
// which made get_whois fail. Loaded with `node --import`, it gives requests that set no User-Agent a
// descriptive one. A User-Agent the program chose on purpose is left alone.
const USER_AGENT = 'PublicDesk/1.0 (local OSINT workspace)';
const originalFetch = globalThis.fetch;

globalThis.fetch = function fetchWithDefaultUserAgent(input, init) {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (headers.has('user-agent')) return originalFetch(input, init);
  headers.set('User-Agent', USER_AGENT);
  return originalFetch(input, {...init, headers});
};
