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
  if (event === 'request' && !authorized(request.headers.authorization)) {
    response.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ error: 'Authentication required' }));
    return true;
  }
  return originalEmit.call(this, event, request, response, ...rest);
};

export { authorized };
