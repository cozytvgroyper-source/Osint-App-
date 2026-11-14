// Preload for the bundled Open OSINT data service. Loopback is not an authentication boundary, so require
// the same per-launch token used by Public Desk and the MCP bridges before any HTTP route is dispatched.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const token = process.env.PUBLIC_DESK_TOKEN || '';
if (Buffer.byteLength(token) < 32) throw new Error('PUBLIC_DESK_TOKEN must be set to a strong per-launch token');
const expected = Buffer.from(token);
const originalEmit = http.Server.prototype.emit;

function authorized(value = '') {
  const prefix = 'Bearer ';
  if (!String(value).startsWith(prefix)) return false;
  const supplied = Buffer.from(String(value).slice(prefix.length));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

http.Server.prototype.emit = function emitProtectedRequest(event, request, response, ...rest) {
  if (event === 'listening' && !portRecorded) {
    const address = this.address();
    if (address && typeof address === 'object') { ownPort = address.port; portRecorded = true; }
  }
  if (event === 'request' && !authorized(request.headers.authorization)) {
    response.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ error: 'Authentication required' }));
    return true;
  }
  return originalEmit.call(this, event, request, response, ...rest);
};

// The data service fetches its own routes (e.g. /api/rss-proxy) over loopback. Those calls must carry the
// token too, but nothing else may: only http://127.0.0.1:<own port> and http://localhost:<own port>.
function addSelfToken(url, init, { port, token: bearer }) {
  let target;
  try { target = new URL(typeof url === 'string' ? url : url?.href); } catch { return init; }
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) return init;
  if (Number(target.port) !== Number(port)) return init;
  const headers = new Headers(init?.headers);
  if (headers.has('authorization')) return init;
  headers.set('authorization', `Bearer ${bearer}`);
  return { ...init, headers };
}

let ownPort = 8080;
let portRecorded = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = function fetchWithSelfToken(input, init) {
  // A Request already carries its own headers; leave it alone.
  if (typeof input === 'string' || input instanceof URL) init = addSelfToken(input, init, { port: ownPort, token });
  return originalFetch.call(this, input, init);
};

export { authorized, addSelfToken };
