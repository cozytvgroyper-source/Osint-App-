import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

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

// Checks an endpoint and returns the URL with the address it must be reached at (null for the bundled local servers,
// which are fixed loopback addresses).
export async function resolveValidatedEndpoint(value, { resolver = lookup } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new EndpointPolicyError('The MCP endpoint is not a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new EndpointPolicyError('Only HTTP(S) MCP endpoints are supported');
  if (url.username || url.password) throw new EndpointPolicyError('Credentials must be supplied as a token, not embedded in the URL');
  if (ALLOWED_LOCAL_URLS.has(url.href)) return { url, pin: null };
  if (url.protocol !== 'https:') throw new EndpointPolicyError('Custom MCP endpoints must use HTTPS');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (hostname === 'metadata.google.internal') throw new EndpointPolicyError('Cloud metadata endpoints are blocked');
  const answers = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some(answer => isPrivateAddress(answer.address))) throw new EndpointPolicyError('Private, local, and metadata endpoint addresses are blocked');
  return { url, pin: { address: answers[0].address, family: answers[0].family || isIP(answers[0].address) } };
}

export async function validatedEndpoint(value, options) {
  return (await resolveValidatedEndpoint(value, options)).url;
}

// Sends a request to a fixed address while keeping the URL's host for TLS certificate checks and the Host header,
// so a second DNS lookup (DNS rebinding) cannot send it somewhere else. Never follows redirects.
export function pinnedFetch(url, { method = 'GET', headers = {}, body, signal } = {}, pin) {
  const client = url.protocol === 'https:' ? https : http;
  const lookupPinned = (host, options, callback) => options?.all ? callback(null, [pin]) : callback(null, pin.address, pin.family);
  return new Promise((resolve, reject) => {
    const request = client.request(url, { method, headers: { 'accept-encoding': 'identity', ...headers }, signal, lookup: lookupPinned }, response => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) responseHeaders.append(name, String(item));
      }
      const empty = method === 'HEAD' || [204, 205, 304].includes(response.statusCode);
      if (empty) response.resume();
      resolve(new Response(empty ? null : Readable.toWeb(response), { status: response.statusCode, statusText: response.statusMessage, headers: responseHeaders }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

const defaultFetch = (url, options, pin) => pin ? pinnedFetch(url, options, pin) : fetch(url, options);

export async function fetchValidated(value, options = {}, { resolver = lookup, fetchImpl = defaultFetch, maxRedirects = 3 } = {}) {
  let { url, pin } = await resolveValidatedEndpoint(value, { resolver });
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchImpl(url, { ...options, redirect: 'manual' }, pin);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirectCount >= maxRedirects) throw new Error('MCP endpoint redirected too many times');
    if (![307, 308].includes(response.status)) throw new Error(`MCP endpoint returned unsupported redirect ${response.status}`);
    const location = response.headers.get('location');
    if (!location) throw new Error('MCP endpoint redirected without a destination');
    // A 307/308 resends the same headers and body, so a redirect to another site would carry the user's token and
    // the search itself there. Only same-site redirects (same scheme, host and port) are followed.
    const next = new URL(location, url);
    if (next.origin !== url.origin) throw new Error(`MCP endpoint redirected to a different site (${next.origin}). Redirects to another site are blocked so your token and search are never sent there; if that address is right, use it as the endpoint instead.`);
    ({ url, pin } = await resolveValidatedEndpoint(next, { resolver }));
  }
}
