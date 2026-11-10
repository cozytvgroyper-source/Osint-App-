import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const sessions = new Map();
const consensusOAuth = { client: null, accessToken: '', refreshToken: '', expiresAt: 0, pending: new Map() };
const CONSENSUS_ENDPOINT = 'https://mcp.consensus.app/mcp';
const CONSENSUS_ISSUER = 'https://consensus.app';
const CONSENSUS_REDIRECT = `http://127.0.0.1:${PORT}/api/oauth/consensus/callback`;

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function validatedEndpoint(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) MCP endpoints are supported');
  if (url.username || url.password) throw new Error('Credentials must be supplied as a token, not embedded in the URL');
  if (['169.254.169.254', 'metadata.google.internal'].includes(url.hostname)) throw new Error('Cloud metadata endpoints are blocked');
  return url;
}

function parseMcpResponse(text, contentType) {
  if (contentType.includes('text/event-stream')) {
    const payloads = text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim());
    const last = payloads.filter(Boolean).at(-1);
    return last ? JSON.parse(last) : { error: { message: 'Empty MCP event stream' } };
  }
  return JSON.parse(text || '{}');
}

async function mcpRequest({ endpoint, token, method, params = {}, sessionKey }) {
  const url = validatedEndpoint(endpoint);
  const isNotification = method.startsWith('notifications/');
  const id = isNotification ? undefined : crypto.randomUUID();
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': '2025-03-26'
  };
  const effectiveToken = endpoint === CONSENSUS_ENDPOINT ? await consensusAccessToken() : token;
  if (effectiveToken) headers.authorization = `Bearer ${effectiveToken}`;
  if (sessionKey && sessions.has(sessionKey)) headers['mcp-session-id'] = sessions.get(sessionKey);
  const response = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, params }),
    signal: AbortSignal.timeout(45_000)
  });
  const sessionId = response.headers.get('mcp-session-id');
  if (sessionId && sessionKey) sessions.set(sessionKey, sessionId);
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP server returned ${response.status}: ${text.slice(0, 240)}`);
  if (isNotification && !text) return { accepted: true };
  return parseMcpResponse(text, response.headers.get('content-type') || '');
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function consensusClient() {
  if (consensusOAuth.client) return consensusOAuth.client;
  const response = await fetch(`${CONSENSUS_ISSUER}/oauth/register/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'SignalDesk Local',
      redirect_uris: [CONSENSUS_REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Consensus client registration failed (${response.status})`);
  consensusOAuth.client = await response.json();
  return consensusOAuth.client;
}

async function consensusToken(form) {
  const response = await fetch(`${CONSENSUS_ISSUER}/oauth/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(15_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || `Consensus token request failed (${response.status})`);
  consensusOAuth.accessToken = data.access_token;
  consensusOAuth.refreshToken = data.refresh_token || consensusOAuth.refreshToken;
  consensusOAuth.expiresAt = Date.now() + Math.max(0, (Number(data.expires_in) || 3600) - 60) * 1000;
  return data.access_token;
}

async function consensusAccessToken() {
  if (consensusOAuth.accessToken && Date.now() < consensusOAuth.expiresAt) return consensusOAuth.accessToken;
  if (!consensusOAuth.refreshToken || !consensusOAuth.client?.client_id) return '';
  return consensusToken({
    grant_type: 'refresh_token',
    refresh_token: consensusOAuth.refreshToken,
    client_id: consensusOAuth.client.client_id
  });
}

async function initialize(payload) {
  const result = await mcpRequest({
    ...payload,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'SignalDesk', version: '1.0.0' }
    }
  });
  await mcpRequest({ ...payload, method: 'notifications/initialized', params: {} }).catch(() => {});
  return result;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/oauth/consensus/start') {
      const client = await consensusClient();
      const state = base64url(randomBytes(24));
      const verifier = base64url(randomBytes(48));
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      consensusOAuth.pending.set(state, { verifier, createdAt: Date.now() });
      const authorize = new URL(`${CONSENSUS_ISSUER}/oauth/authorize/`);
      authorize.search = new URLSearchParams({
        response_type: 'code', client_id: client.client_id, redirect_uri: CONSENSUS_REDIRECT,
        scope: 'search', state, code_challenge: challenge, code_challenge_method: 'S256'
      });
      res.writeHead(302, { location: authorize.toString(), 'cache-control': 'no-store' });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/oauth/consensus/callback') {
      const state = url.searchParams.get('state');
      const pending = state && consensusOAuth.pending.get(state);
      if (!pending || Date.now() - pending.createdAt > 10 * 60_000) return json(res, 400, { error: 'Invalid or expired OAuth state' });
      consensusOAuth.pending.delete(state);
      const oauthError = url.searchParams.get('error');
      if (oauthError) return json(res, 400, { error: url.searchParams.get('error_description') || oauthError });
      const code = url.searchParams.get('code');
      if (!code) return json(res, 400, { error: 'Consensus did not return an authorization code' });
      await consensusToken({
        grant_type: 'authorization_code', code, redirect_uri: CONSENSUS_REDIRECT,
        client_id: consensusOAuth.client.client_id, code_verifier: pending.verifier
      });
      res.writeHead(302, { location: '/?consensus=connected', 'cache-control': 'no-store' });
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/api/mcp') {
      const payload = await body(req);
      if (!payload.endpoint || !payload.method) return json(res, 400, { error: 'endpoint and method are required' });
      if (payload.initialize) await initialize(payload);
      const result = await mcpRequest(payload);
      return json(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/health') {
      const payload = await body(req);
      const endpoint = validatedEndpoint(payload.endpoint);
      const healthUrl = new URL('/health', endpoint);
      const headers = payload.token ? { authorization: `Bearer ${payload.token}` } : {};
      const response = await fetch(healthUrl, { headers, signal: AbortSignal.timeout(8_000) });
      return json(res, 200, { ok: response.ok, status: response.status });
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const resolved = normalize(join(ROOT, requestPath));
    if (!resolved.startsWith(ROOT)) return json(res, 403, { error: 'Forbidden' });
    const data = await readFile(resolved);
    res.writeHead(200, {
      'content-type': mime[extname(resolved)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(data);
  } catch (error) {
    if (error?.code === 'ENOENT') return json(res, 404, { error: 'Not found' });
    json(res, 502, { error: error.message || 'Request failed' });
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`SignalDesk running at http://127.0.0.1:${PORT}`);
  });
}

export { validatedEndpoint, parseMcpResponse };
