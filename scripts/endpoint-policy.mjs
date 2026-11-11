import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const LOCAL_PORTS = [8892, 8893, 8894];
const ALLOWED_LOCAL_URLS = new Set(LOCAL_PORTS.flatMap(port => [
  `http://127.0.0.1:${port}/mcp`,
  `http://127.0.0.1:${port}/health`
]));

function ipv4Bytes(address) {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function ipv6Bytes(address) {
  let source = address.toLowerCase().split('%')[0];
  if (source.includes('.')) {
    const index = source.lastIndexOf(':');
    const bytes = ipv4Bytes(source.slice(index + 1));
    if (!bytes) return null;
    source = `${source.slice(0, index)}:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = source.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.flatMap(group => { const value = Number.parseInt(group, 16); return [value >> 8, value & 255]; });
}

export function isPrivateAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = ipv4Bytes(address);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(address) !== 6) return true;
  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  const allZero = bytes.every(byte => byte === 0);
  const loopback = bytes.slice(0, 15).every(byte => byte === 0) && bytes[15] === 1;
  const mapped = bytes.slice(0, 10).every(byte => byte === 0) && bytes[10] === 255 && bytes[11] === 255;
  if (mapped) return isPrivateAddress(bytes.slice(12).join('.'));
  return allZero || loopback || (bytes[0] & 0xfe) === 0xfc ||
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) || bytes[0] === 0xff;
}

// A refused address is the caller's mistake, not an upstream failure; the server answers it with HTTP 400.
export class EndpointPolicyError extends Error {
  constructor(message) { super(message); this.name = 'EndpointPolicyError'; this.code = 'ENDPOINT_POLICY'; }
}

export async function validatedEndpoint(value, { resolver = lookup } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new EndpointPolicyError('The MCP endpoint is not a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new EndpointPolicyError('Only HTTP(S) MCP endpoints are supported');
  if (url.username || url.password) throw new EndpointPolicyError('Credentials must be supplied as a token, not embedded in the URL');
  if (ALLOWED_LOCAL_URLS.has(url.href)) return url;
  if (url.protocol !== 'https:') throw new EndpointPolicyError('Custom MCP endpoints must use HTTPS');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (hostname === 'metadata.google.internal') throw new EndpointPolicyError('Cloud metadata endpoints are blocked');
  const answers = isIP(hostname) ? [{ address: hostname }] : await resolver(hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some(answer => isPrivateAddress(answer.address))) throw new EndpointPolicyError('Private, local, and metadata endpoint addresses are blocked');
  return url;
}

export async function fetchValidated(value, options = {}, { resolver = lookup, fetchImpl = fetch, maxRedirects = 3 } = {}) {
  let url = await validatedEndpoint(value, { resolver });
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchImpl(url, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirectCount >= maxRedirects) throw new Error('MCP endpoint redirected too many times');
    if (![307, 308].includes(response.status)) throw new Error(`MCP endpoint returned unsupported redirect ${response.status}`);
    const location = response.headers.get('location');
    if (!location) throw new Error('MCP endpoint redirected without a destination');
    url = await validatedEndpoint(new URL(location, url), { resolver });
  }
}
