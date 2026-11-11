// Preload for the Open OSINT data service. Its get_intelx module always calls https://2.intelx.io, Intelligence X's
// server for paid keys, which answers HTTP 401 to free-tier keys; those only work on https://free.intelx.io.
// Loaded with `node --import`, it sends 2.intelx.io requests to INTELX_API_ORIGIN instead (default: the free
// server). A paid key sets INTELX_API_ORIGIN=https://2.intelx.io in work/api-keys.env. Other hosts are untouched.
const PAID_HOST = '2.intelx.io';

function configuredOrigin(value) {
  try {
    const url = new URL(value || 'https://free.intelx.io');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

const origin = configuredOrigin(process.env.INTELX_API_ORIGIN);
const originalFetch = globalThis.fetch;

if (origin && new URL(origin).host !== PAID_HOST) {
  globalThis.fetch = function fetchIntelxOnConfiguredOrigin(input, init) {
    const href = input instanceof Request ? input.url : String(input);
    let url;
    try { url = new URL(href); } catch { return originalFetch(input, init); }
    if (url.host !== PAID_HOST) return originalFetch(input, init);
    const target = `${origin}${url.pathname}${url.search}`;
    return originalFetch(input instanceof Request ? new Request(target, input) : target, init);
  };
}
