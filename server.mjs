import http from 'node:http';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const UPLOAD_ROOT = fileURLToPath(new URL('./work/uploads/', import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const sessions = new Map();
const uploads = new Map();
const consensusOAuth = { client: null, accessToken: '', refreshToken: '', expiresAt: 0, pending: new Map() };
const CONSENSUS_ENDPOINT = 'https://mcp.consensus.app/mcp';
const CONSENSUS_ISSUER = 'https://consensus.app';
const CONSENSUS_REDIRECT = `http://127.0.0.1:${PORT}/api/oauth/consensus/callback`;
// Keeps the Consensus sign-in across restarts. work/ is git-ignored; the file is readable only by this user.
const CONSENSUS_AUTH_FILE = fileURLToPath(new URL('./work/consensus-auth.json', import.meta.url));

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

// Sent with every response. The page loads only its own scripts and styles and fetches only its own API
// and the IntelMap news feed; other sites may not frame it (clickjacking) or embed its files.
const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
    "connect-src 'self' https://intelmap.watch"
  ].join('; '),
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
});

function json(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request too large');
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

// Only the app registration and refresh token are saved; access tokens stay in memory and expire within an hour.
async function saveConsensusAuth(file, auth) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await chmod(dirname(file), 0o700);
  await writeFile(file, JSON.stringify(auth), { mode: 0o600 });
  await chmod(file, 0o600);
}

async function loadConsensusAuth(file, redirectUri) {
  try {
    const auth = JSON.parse(await readFile(file, 'utf8'));
    const usable = auth?.redirectUri === redirectUri && typeof auth.client?.client_id === 'string' && typeof auth.refreshToken === 'string' && auth.refreshToken;
    return usable ? auth : null;
  } catch {
    return null;
  }
}

async function clearConsensusAuth(file) {
  await unlink(file).catch(error => { if (error?.code !== 'ENOENT') throw error; });
}

async function restoreConsensusSignIn() {
  const auth = await loadConsensusAuth(CONSENSUS_AUTH_FILE, CONSENSUS_REDIRECT);
  if (!auth) return false;
  consensusOAuth.client = auth.client;
  consensusOAuth.refreshToken = auth.refreshToken;
  return true;
}

async function consensusClient() {
  if (consensusOAuth.client) return consensusOAuth.client;
  const response = await fetch(`${CONSENSUS_ISSUER}/oauth/register/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Public Desk Local',
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
  if (!response.ok) {
    const error = new Error(data.error_description || `Consensus token request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  consensusOAuth.accessToken = data.access_token;
  consensusOAuth.refreshToken = data.refresh_token || consensusOAuth.refreshToken;
  consensusOAuth.expiresAt = Date.now() + Math.max(0, (Number(data.expires_in) || 3600) - 60) * 1000;
  if (consensusOAuth.refreshToken) {
    await saveConsensusAuth(CONSENSUS_AUTH_FILE, { redirectUri: CONSENSUS_REDIRECT, client: consensusOAuth.client, refreshToken: consensusOAuth.refreshToken })
      .catch(error => console.error(`Could not save the Consensus sign-in: ${error.message}`));
  }
  return data.access_token;
}

async function consensusAccessToken() {
  if (consensusOAuth.accessToken && Date.now() < consensusOAuth.expiresAt) return consensusOAuth.accessToken;
  if (!consensusOAuth.refreshToken || !consensusOAuth.client?.client_id) return '';
  try {
    return await consensusToken({
      grant_type: 'refresh_token',
      refresh_token: consensusOAuth.refreshToken,
      client_id: consensusOAuth.client.client_id
    });
  } catch (error) {
    // A rejected refresh token means the sign-in is gone; forget it so the app asks to sign in again.
    if (error.status === 400 || error.status === 401) {
      consensusOAuth.refreshToken = '';
      await clearConsensusAuth(CONSENSUS_AUTH_FILE).catch(() => {});
      return '';
    }
    throw error;
  }
}

async function initialize(payload) {
  const result = await mcpRequest({
    ...payload,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'Public Desk', version: '1.0.0' }
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
      res.writeHead(302, { ...SECURITY_HEADERS, location: authorize.toString(), 'cache-control': 'no-store' });
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
      res.writeHead(302, { ...SECURITY_HEADERS, location: '/?consensus=connected', 'cache-control': 'no-store' });
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/api/mcp') {
      const payload = await body(req);
      if (!payload.endpoint || !payload.method) return json(res, 400, { error: 'endpoint and method are required' });
      if (payload.initialize) await initialize(payload);
      const result = await mcpRequest(payload);
      return json(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const payload = await body(req, 75_000_000);
      const name = String(payload.name || '').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180);
      const extension = extname(name).toLowerCase();
      const allowed = new Set(['.jpg','.jpeg','.png','.gif','.webp','.heic','.heif','.tif','.tiff','.bmp','.mp4','.mov','.m4v','.avi','.mkv','.webm','.pdf','.doc','.docx','.txt','.csv','.json','.rtf']);
      if (!name || !allowed.has(extension)) return json(res, 400, { error: 'Unsupported file type' });
      const encoded = String(payload.data || '').replace(/^data:[^;]+;base64,/, '');
      const data = Buffer.from(encoded, 'base64');
      if (!data.length || data.length > 50_000_000) return json(res, 400, { error: 'File must be between 1 byte and 50 MB' });
      const id = crypto.randomUUID();
      await mkdir(UPLOAD_ROOT, { recursive: true });
      const path = join(UPLOAD_ROOT, `${id}-${name}`);
      await writeFile(path, data, { flag: 'wx', mode: 0o600 });
      uploads.set(id, path);
      return json(res, 200, { id, path, name, size: data.length, type: String(payload.type || 'application/octet-stream') });
    }
    if (req.method === 'POST' && url.pathname === '/api/upload/delete') {
      const payload = await body(req);
      const path = uploads.get(payload.id);
      if (path) { await unlink(path).catch(() => {}); uploads.delete(payload.id); }
      return json(res, 200, { deleted: Boolean(path) });
    }
    if (req.method === 'POST' && url.pathname === '/api/mcp/disconnect') {
      const payload = await body(req);
      if (!payload.sessionKey) return json(res, 400, { error: 'sessionKey is required' });
      sessions.delete(payload.sessionKey);
      return json(res, 200, { disconnected: true });
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
      ...SECURITY_HEADERS,
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
  const restored = await restoreConsensusSignIn();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Public Desk running at http://127.0.0.1:${PORT}`);
    if (restored) console.log('Restored the saved Consensus sign-in.');
  });
}

export { validatedEndpoint, parseMcpResponse, loadConsensusAuth, saveConsensusAuth, clearConsensusAuth, SECURITY_HEADERS };
