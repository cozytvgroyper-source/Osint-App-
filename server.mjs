import http from 'node:http';
import { chmod, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DATA_SOURCES, parseKeyFile, sourceStatuses, updateKeyFile, validateKeyValue } from './scripts/api-keys.mjs';
import { fetchValidated, validatedEndpoint } from './scripts/endpoint-policy.mjs';
import {authorizeMcpToolCall, createRunGrant, releaseRunGrants, serverNameForEndpoint} from './scripts/run-grants.mjs';
import {deepCallTimeout} from './scripts/deep-call-timeout.mjs';
import {appendDeepSearchAudit,readDeepSearchAudit} from './scripts/deep-search-audit.mjs';
import {CaseStore,MAX_EVIDENCE_BYTES,handleCaseRequest} from './scripts/cases.mjs';
import {DeepRunStore,MAX_DEEP_RUN_BYTES} from './scripts/deep-search-runs.mjs';
import {handleDeepHistoryRequest} from './scripts/deep-history-routes.mjs';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
// Private working data (cases, uploads, runs, keys). PUBLIC_DESK_WORK_DIR points it elsewhere, so tests never touch the real work/.
const WORK_DIR = process.env.PUBLIC_DESK_WORK_DIR ? resolve(process.env.PUBLIC_DESK_WORK_DIR) : fileURLToPath(new URL('./work/', import.meta.url));
const UPLOAD_ROOT = join(WORK_DIR, 'uploads/');
const DEEP_SEARCH_AUDIT_FILE = join(WORK_DIR, 'deep-search-audit.jsonl');
const cases = new CaseStore(join(WORK_DIR, 'cases/'));
const deepRuns = new DeepRunStore(join(WORK_DIR, 'deep-search-runs/'));
const PORT = Number(process.env.PORT || 4173);
const MAX_MCP_RESPONSE_BYTES = 5_000_000;
const MAX_MCP_SSE_EVENTS = 1_000;
const MAX_MCP_SSE_EVENT_BYTES = 1_000_000;
const UPLOAD_TTL_MS = 30 * 60_000;
const MAX_ACTIVE_UPLOADS = 8;
const MAX_UPLOAD_BYTES = 200_000_000;
const MAX_CONCURRENT_UPLOADS = 2;
const UPLOAD_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-/i;
const sessions = new Map();
const uploads = new Map();
let uploadRequests = 0;
let reservedUploadSlots = 0;
let reservedUploadBytes = 0;
const runGrants = new Map();
const consensusOAuth = { client: null, accessToken: '', refreshToken: '', expiresAt: 0, pending: new Map() };
const CONSENSUS_ENDPOINT = 'https://mcp.consensus.app/mcp';
const CONSENSUS_ISSUER = 'https://consensus.app';
const CONSENSUS_REDIRECT = `http://127.0.0.1:${PORT}/api/oauth/consensus/callback`;
const CONFIGURED_PUBLIC_DESK_TOKEN = process.env.PUBLIC_DESK_TOKEN || '';
const PUBLIC_DESK_TOKEN = CONFIGURED_PUBLIC_DESK_TOKEN || randomBytes(32).toString('base64url');
const LOCAL_MCP_ENDPOINTS = new Set(['http://127.0.0.1:8892/mcp','http://127.0.0.1:8893/mcp','http://127.0.0.1:8894/mcp']);
// Keeps the Consensus sign-in across restarts. work/ is git-ignored; the file is readable only by this user.
const CONSENSUS_AUTH_FILE = join(WORK_DIR, 'consensus-auth.json');
// Data-source API keys for the Open OSINT data service, which reads this file live (scripts/live-api-keys.mjs).
const API_KEYS = {
  file: join(WORK_DIR, 'api-keys.env'),
  template: fileURLToPath(new URL('./config/api-keys.env.example', import.meta.url))
};

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
    if (size > limit) throw Object.assign(new Error('Request too large'), { code: 'REQUEST_TOO_LARGE' });
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch (error) { throw Object.assign(error, { code: 'REQUEST_JSON', message: 'The request body is not valid JSON' }); }
  // Every route expects a JSON object; null, a string, a number or a list is the caller's mistake (400), not a crash.
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('The request body must be a JSON object'), { code: 'REQUEST_JSON' });
  return value;
}

async function cleanupStaleUploads(root = UPLOAD_ROOT, { now = Date.now(), maxAge = UPLOAD_TTL_MS } = {}) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return 0; throw error; }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !UPLOAD_NAME_PATTERN.test(entry.name)) continue;
    const path = join(root, entry.name);
    const info = await lstat(path);
    if (!info.isFile() || now - info.mtimeMs <= maxAge) continue;
    await unlink(path);
    removed += 1;
  }
  return removed;
}

async function restoreFreshUploads(root = UPLOAD_ROOT, uploadMap = uploads, { now = Date.now(), maxAge = UPLOAD_TTL_MS } = {}) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return 0; throw error; }
  let restored = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !UPLOAD_NAME_PATTERN.test(entry.name)) continue;
    const path = join(root, entry.name);
    let info;
    try { info = await lstat(path); }
    catch (error) { if (error?.code === 'ENOENT') continue; throw error; }
    const age = Math.max(0, now - info.mtimeMs);
    if (!info.isFile() || age > maxAge) continue;
    const id = entry.name.slice(0, 36);
    trackUpload(id, path, uploadMap, Math.max(1, maxAge - age), info.size);
    restored += 1;
  }
  return restored;
}

async function deleteTrackedUpload(id, uploadMap = uploads) {
  const upload = uploadMap.get(id);
  if (!upload) return false;
  uploadMap.delete(id);
  clearTimeout(upload.timer);
  await unlink(upload.path).catch(() => {});
  return true;
}

function trackUpload(id, path, uploadMap = uploads, ttl = UPLOAD_TTL_MS, size = 0) {
  const timer = setTimeout(() => { void deleteTrackedUpload(id, uploadMap); }, ttl);
  timer.unref?.();
  uploadMap.set(id, { path, timer, size });
}

function trackedUploadBytes(uploadMap = uploads) {
  return [...uploadMap.values()].reduce((total, upload) => total + (Number(upload.size) || 0), 0);
}

// Public Desk only serves its own page. Browsers let any website send simple cross-site requests to
// 127.0.0.1, and a DNS-rebinding site can pose as this host, so every request must carry this host and,
// when a browser says where it came from, come from this app. API posts must be JSON, which other
// sites cannot send without a CORS preflight that this server never approves.
const OWN_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const OWN_ORIGINS = new Set([...OWN_HOSTS].map(host => `http://${host}`));
const OAUTH_CALLBACK_PATH = '/api/oauth/consensus/callback';

// Sign-ins expire after 10 minutes; when 20 are pending the oldest is dropped, so a new sign-in always works.
function prunePendingSignIns(pending, now = Date.now()) {
  for (const [key, entry] of pending) if (now - entry.createdAt > 10 * 60_000) pending.delete(key);
  while (pending.size >= 20) pending.delete(pending.keys().next().value);
}

function validAccessToken(value, expected = PUBLIC_DESK_TOKEN) {
  const supplied = Buffer.from(String(value || ''));
  const wanted = Buffer.from(String(expected || ''));
  return supplied.length === wanted.length && supplied.length >= 32 && timingSafeEqual(supplied, wanted);
}

function requestGuard({ method, url, headers }, expectedToken = PUBLIC_DESK_TOKEN) {
  if (!OWN_HOSTS.has(String(headers.host || '').toLowerCase())) return { status: 403, error: 'Unexpected Host header' };
  // Consensus redirects the browser back here from its own site; the one-time state check protects it.
  if (url.pathname === OAUTH_CALLBACK_PATH) return null;
  // Opening a page or file has no side effects, and browsers mark the return from the Consensus sign-in as
  // cross-site. Other sites still cannot frame the page or use its files (see SECURITY_HEADERS).
  if ((method === 'GET' || method === 'HEAD') && !url.pathname.startsWith('/api/')) return null;
  const fetchSite = headers['sec-fetch-site'];
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return { status: 403, error: 'Cross-site requests are not allowed' };
  const origin = headers.origin;
  if (origin !== undefined && !OWN_ORIGINS.has(origin)) return { status: 403, error: 'Requests from other origins are not allowed' };
  if (method === 'POST' && !/^application\/json(?:;|$)/i.test(String(headers['content-type'] || ''))) {
    return { status: 415, error: 'API requests must be JSON' };
  }
  if (!validAccessToken(headers['x-public-desk-token'], expectedToken)) return { status: 401, error: 'Open Public Desk from its launcher to continue' };
  return null;
}

async function readLimitedResponse(response, limit = MAX_MCP_RESPONSE_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error(`MCP response exceeded the ${Math.round(limit / 1_000_000)} MB limit`);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel('Response size limit exceeded').catch(() => {});
        throw new Error(`MCP response exceeded the ${Math.round(limit / 1_000_000)} MB limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

// A streamed answer may carry notifications around the reply, so the reply is the message with the request's id
// (the last message when no id is known).
function parseMcpResponse(text, contentType, { id, maxSseEvents = MAX_MCP_SSE_EVENTS, maxSseEventBytes = MAX_MCP_SSE_EVENT_BYTES } = {}) {
  if (contentType.includes('text/event-stream')) {
    // One event is every data line up to a blank line, joined with line breaks (the server-sent events format).
    const payloads = [];
    let lines = [];
    const finish = () => {
      if (!lines.length) return;
      if (payloads.length >= maxSseEvents) throw new Error('MCP event stream contained too many events');
      const payload = lines.join('\n').trim();
      if (Buffer.byteLength(payload, 'utf8') > maxSseEventBytes) throw new Error('MCP event stream contained an oversized event');
      payloads.push(payload);
      lines = [];
    };
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (line === '') { finish(); continue; }
      if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
    }
    finish();
    const messages = payloads.filter(Boolean).map(payload => JSON.parse(payload));
    if (!messages.length) return { error: { message: 'Empty MCP event stream' } };
    if (id === undefined) return messages.at(-1);
    // Notices (progress, logs) can come around the reply; without the reply itself the call has no answer.
    return messages.find(message => message?.id === id) ?? { error: { message: 'MCP stream ended without a reply to this request' } };
  }
  return JSON.parse(text || '{}');
}

// MCP sessions (Streamable HTTP): the server issues an mcp-session-id on initialize and answers 404 to a session it no
// longer knows, for example after its bridge restarts. initialize must start a fresh session, so it never sends one.
export function sessionHeader(store, sessionKey, method) {
  return method !== 'initialize' && sessionKey && store.has(sessionKey) ? { 'mcp-session-id': store.get(sessionKey) } : {};
}

export function mcpHttpError(status, text, sentSession) {
  const error = new Error(`MCP server returned ${status}: ${text.slice(0, 240)}`);
  if (status === 404 && sentSession) error.code = 'MCP_SESSION_EXPIRED';
  return error;
}

// The server rejected an expired session before running anything, so one retry on a new session cannot repeat a call.
export async function withSessionRecovery(payload, run, reinitialize, store = sessions) {
  try {
    return await run();
  } catch (error) {
    if (error?.code !== 'MCP_SESSION_EXPIRED' || !payload.sessionKey) throw error;
    store.delete(payload.sessionKey);
    await reinitialize();
    return run();
  }
}

async function mcpRequest({ endpoint, token, method, params = {}, sessionKey }, {timeoutMs=45_000,signal}={}) {
  const url = await validatedEndpoint(endpoint);
  const isNotification = method.startsWith('notifications/');
  const id = isNotification ? undefined : crypto.randomUUID();
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': '2025-03-26'
  };
  const effectiveToken = LOCAL_MCP_ENDPOINTS.has(endpoint) ? PUBLIC_DESK_TOKEN : endpoint === CONSENSUS_ENDPOINT ? await consensusAccessToken() : token;
  if (effectiveToken) headers.authorization = `Bearer ${effectiveToken}`;
  Object.assign(headers, sessionHeader(sessions, sessionKey, method));
  const response = await fetchValidated(url, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, params }),
    signal: AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])])
  });
  const sessionId = response.headers.get('mcp-session-id');
  if (sessionId && sessionKey) sessions.set(sessionKey, sessionId);
  const text = await readLimitedResponse(response);
  if (!response.ok) throw mcpHttpError(response.status, text, 'mcp-session-id' in headers);
  if (isNotification && !text) return { accepted: true };
  return parseMcpResponse(text, response.headers.get('content-type') || '', { id });
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

async function readKeyFile({ file, template }) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return readFile(template, 'utf8').catch(() => '');
  }
}

// Written to a private temporary file and renamed into place, so the data service never reads a half-written file.
async function writeKeyFile(file, text) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, text, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}

// The Data sources panel's actions. Responses carry statuses and saved field names, never key values.
let keyFileQueue = Promise.resolve();
function dataSourcesAction(action, payload = {}, paths = API_KEYS) {
  const run = async () => {
    const text = await readKeyFile(paths);
    const parsed = parseKeyFile(text);
    if (action === 'list') return { status: 200, body: { sources: sourceStatuses(parsed) } };
    const source = DATA_SOURCES.find(item => item.id === payload.id);
    if (!source) return { status: 400, body: { error: 'Unknown data source' } };
    const others = [...parsed.disabled].filter(id => id !== source.id);
    let update;
    if (action === 'connect') {
      const set = {};
      try {
        for (const field of source.fields) {
          const given = payload.values?.[field.env];
          if (given !== undefined && String(given).trim() !== '') set[field.env] = validateKeyValue(given);
          else if (!parsed.values.has(field.env)) return { status: 400, body: { error: `${field.label} is required for ${source.name}.` } };
        }
      } catch (error) {
        return { status: 400, body: { error: error.message } };
      }
      update = { set, disabled: others };
    } else if (action === 'disconnect') {
      update = { disabled: [...others, source.id] };
    } else if (action === 'remove') {
      update = { unset: source.fields.map(field => field.env), disabled: others };
    } else {
      return { status: 404, body: { error: 'Not found' } };
    }
    const next = updateKeyFile(text, update);
    await writeKeyFile(paths.file, next);
    return { status: 200, body: { source: sourceStatuses(parseKeyFile(next)).find(item => item.id === source.id) } };
  };
  const result = keyFileQueue.then(run, run);
  keyFileQueue = result.catch(() => {});
  return result;
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

// Callers that arrive while a run is in flight share its result instead of starting their own.
function oneAtATime(run) {
  let inFlight = null;
  return () => inFlight ??= Promise.resolve().then(run).finally(() => { inFlight = null; });
}

async function consensusAccessToken() {
  if (consensusOAuth.accessToken && Date.now() < consensusOAuth.expiresAt) return consensusOAuth.accessToken;
  if (!consensusOAuth.refreshToken || !consensusOAuth.client?.client_id) return '';
  return refreshConsensusAccessToken();
}

// Searches run tools in parallel, so several may need a new token at once. They share one refresh: a provider that
// rotates refresh tokens would reject a second refresh with the old token, and the app would then forget the sign-in.
const refreshConsensusAccessToken = oneAtATime(async () => {
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
});

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
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const blocked = requestGuard({ method: req.method, url, headers: req.headers });
    if (blocked) {
      req.resume();
      return json(res, blocked.status, { error: blocked.error });
    }
    if (req.method === 'POST' && url.pathname === '/api/oauth/consensus/start') {
      const client = await consensusClient();
      const state = base64url(randomBytes(24));
      const verifier = base64url(randomBytes(48));
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      prunePendingSignIns(consensusOAuth.pending);
      consensusOAuth.pending.set(state, { verifier, createdAt: Date.now() });
      const authorize = new URL(`${CONSENSUS_ISSUER}/oauth/authorize/`);
      authorize.search = new URLSearchParams({
        response_type: 'code', client_id: client.client_id, redirect_uri: CONSENSUS_REDIRECT,
        scope: 'search', state, code_challenge: challenge, code_challenge_method: 'S256'
      });
      return json(res, 200, { authorize: authorize.toString() });
    }
    if (req.method === 'GET' && url.pathname === OAUTH_CALLBACK_PATH) {
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
      if (typeof payload.endpoint !== 'string' || !payload.endpoint || typeof payload.method !== 'string' || !payload.method) return json(res, 400, { error: 'endpoint and method are required' });
      const authorization=authorizeMcpToolCall(payload, runGrants);
      if (payload.initialize) await initialize(payload);
      const cancelled=new AbortController();res.once('close',()=>{if(!res.writableEnded)cancelled.abort();});
      const options={timeoutMs:deepCallTimeout({
        ...payload.params,
        serverName:serverNameForEndpoint(payload.endpoint),
        deepSearch:payload.deepSearch,
        timeoutMs:payload.timeoutMs
      },authorization),signal:cancelled.signal};
      const result = await withSessionRecovery(payload,()=>mcpRequest(payload,options),()=>initialize(payload));
      return json(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/run-grants') {
      const payload = await body(req, 100_000);
      if (!Array.isArray(payload.tools) || payload.tools.some(tool => !tool || typeof tool !== 'object' || typeof tool.endpoint !== 'string')) return json(res, 400, { error: 'tools must be a list of tools, each with an endpoint' });
      for (const tool of payload.tools) await validatedEndpoint(tool.endpoint);
      return json(res, 200, createRunGrant(payload, runGrants));
    }
    if (req.method === 'POST' && url.pathname === '/api/run-grants/release') {
      const payload=await body(req,10_000);
      return json(res,200,{released:releaseRunGrants(runGrants,payload.runId)});
    }
    if (url.pathname === '/api/cases' || url.pathname.startsWith('/api/cases/')) {
      const handled = await handleCaseRequest(cases, req.method, url.pathname, () => body(req, MAX_EVIDENCE_BYTES + 100_000));
      if (handled?.raw !== undefined) {
        // Reports download as files rather than opening inside the app.
        res.writeHead(handled.status, { ...SECURITY_HEADERS, 'content-type': handled.contentType, 'content-disposition': `attachment; filename="${handled.filename}"`, 'cache-control': 'no-store' });
        return res.end(handled.raw);
      }
      if (handled) return json(res, handled.status, handled.body);
      return json(res, 404, { error: 'Unknown case route' });
    }
    if (req.method === 'GET' && url.pathname === '/api/deep-search/audit') {
      return json(res, 200, await readDeepSearchAudit(DEEP_SEARCH_AUDIT_FILE));
    }
    if (req.method === 'POST' && url.pathname === '/api/deep-search/audit') {
      return json(res, 200, await appendDeepSearchAudit(DEEP_SEARCH_AUDIT_FILE,await body(req,100_000)));
    }
    if (req.method === 'POST' && url.pathname === '/api/deep-search/runs') {
      return json(res,200,await deepRuns.save(await body(req,MAX_DEEP_RUN_BYTES+100_000)));
    }
    const handledHistory=await handleDeepHistoryRequest({runs:deepRuns,auditFile:DEEP_SEARCH_AUDIT_FILE},req.method,url.pathname,()=>body(req,10_000));
    if (handledHistory) return json(res,handledHistory.status,handledHistory.body);
    const deepRunRoute=url.pathname.match(/^\/api\/deep-search\/runs\/([a-z0-9-]{8,64})$/);
    if (req.method === 'GET' && deepRunRoute) {
      return json(res,200,await deepRuns.read(deepRunRoute[1]));
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      if (uploadRequests >= MAX_CONCURRENT_UPLOADS) return json(res, 429, { error: 'Too many uploads are already in progress' });
      if (uploads.size + reservedUploadSlots >= MAX_ACTIVE_UPLOADS) return json(res, 429, { error: 'Temporary upload limit reached; wait for an existing analysis to finish' });
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > 75_000_000) return json(res, 413, { error: 'Request too large' });
      uploadRequests += 1;
      reservedUploadSlots += 1;
      let reservedBytes = 0;
      try {
        const payload = await body(req, 75_000_000);
        const name = String(payload.name || '').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180);
        const extension = extname(name).toLowerCase();
        const allowed = new Set(['.jpg','.jpeg','.png','.gif','.webp','.heic','.heif','.tif','.tiff','.bmp','.mp4','.mov','.m4v','.avi','.mkv','.webm','.pdf','.doc','.docx','.txt','.csv','.json','.rtf']);
        if (!name || !allowed.has(extension)) return json(res, 400, { error: 'Unsupported file type' });
        const encoded = String(payload.data || '').replace(/^data:[^;]+;base64,/, '');
        const data = Buffer.from(encoded, 'base64');
        if (!data.length || data.length > 50_000_000) return json(res, 400, { error: 'File must be between 1 byte and 50 MB' });
        if (trackedUploadBytes() + reservedUploadBytes + data.length > MAX_UPLOAD_BYTES) return json(res, 507, { error: 'Temporary upload storage limit reached' });
        reservedUploadBytes += data.length;
        reservedBytes = data.length;
        const id = crypto.randomUUID();
        await mkdir(UPLOAD_ROOT, { recursive: true, mode: 0o700 });
        await chmod(UPLOAD_ROOT, 0o700);
        const path = join(UPLOAD_ROOT, `${id}-${name}`);
        await writeFile(path, data, { flag: 'wx', mode: 0o600 });
        trackUpload(id, path, uploads, UPLOAD_TTL_MS, data.length);
        return json(res, 200, { id, path, name, size: data.length, type: String(payload.type || 'application/octet-stream') });
      } finally {
        uploadRequests -= 1;
        reservedUploadSlots -= 1;
        reservedUploadBytes -= reservedBytes;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/upload/delete') {
      const payload = await body(req);
      const deleted = await deleteTrackedUpload(payload.id);
      return json(res, 200, { deleted });
    }
    if (req.method === 'POST' && url.pathname === '/api/mcp/disconnect') {
      const payload = await body(req);
      if (!payload.sessionKey) return json(res, 400, { error: 'sessionKey is required' });
      sessions.delete(payload.sessionKey);
      return json(res, 200, { disconnected: true });
    }
    const dataSourcesRoute = url.pathname.match(/^\/api\/data-sources(?:\/(connect|disconnect|remove))?$/);
    if (req.method === 'POST' && dataSourcesRoute) {
      const result = await dataSourcesAction(dataSourcesRoute[1] || 'list', await body(req, 10_000));
      return json(res, result.status, result.body);
    }
    if (req.method === 'POST' && url.pathname === '/api/health') {
      const payload = await body(req);
      const endpoint = await validatedEndpoint(payload.endpoint);
      const healthUrl = new URL('/health', endpoint);
      const headers = LOCAL_MCP_ENDPOINTS.has(payload.endpoint) ? { authorization: `Bearer ${PUBLIC_DESK_TOKEN}` } : payload.token ? { authorization: `Bearer ${payload.token}` } : {};
      const response = await fetchValidated(healthUrl, { headers, signal: AbortSignal.timeout(8_000) });
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
    const status = errorStatus(error);
    json(res, status, { error: ['ENOENT', 'EISDIR'].includes(error?.code) ? 'Not found' : error.message || 'Request failed' });
  }
});

// A refused MCP address is a bad request (400); a missing file is 404; anything else is an upstream failure (502).
function errorStatus(error) {
  if (error?.code === 'REQUEST_TOO_LARGE') return 413;
  if (error?.code === 'REQUEST_JSON') return 400;
  if (error?.code === 'ENOENT' || error?.code === 'EISDIR') return 404;
  if (error?.code === 'ENDPOINT_POLICY') return 400;
  if (error?.code === 'RUN_GRANT') return error.status || 403;
  if (error?.code === 'AUDIT_INPUT') return 400;
  if (error?.code === 'CASE_INPUT') return 400;
  if (error?.code === 'CASE_NOT_FOUND') return 404;
  if (error?.code === 'CASE_TOO_LARGE') return 413;
  if (error?.code === 'CASE_DAMAGED') return 422;
  if (error?.code === 'DEEP_RUN_INPUT') return 400;
  if (error?.code === 'DEEP_RUN_NOT_FOUND') return 404;
  if (error?.code === 'DEEP_RUN_TOO_LARGE') return 413;
  if (error?.code === 'DEEP_RUN_DAMAGED') return 422;
  return 502;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const restored = await restoreConsensusSignIn();
  const removedUploads = await cleanupStaleUploads().catch(error => { console.warn(`Could not clean temporary uploads: ${error.message}`); return 0; });
  const restoredUploads = await restoreFreshUploads().catch(error => { console.warn(`Could not inventory temporary uploads: ${error.message}`); return 0; });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(CONFIGURED_PUBLIC_DESK_TOKEN
      ? `Public Desk running at http://127.0.0.1:${PORT}`
      : `Public Desk running at http://127.0.0.1:${PORT}/#access=${PUBLIC_DESK_TOKEN}`);
    if (restored) console.log('Restored the saved Consensus sign-in.');
    if (removedUploads) console.log(`Removed ${removedUploads} expired temporary upload${removedUploads === 1 ? '' : 's'}.`);
    if (restoredUploads) console.log(`Restored ${restoredUploads} temporary upload lease${restoredUploads === 1 ? '' : 's'}.`);
  });
}

export { validatedEndpoint, fetchValidated, parseMcpResponse, readLimitedResponse, cleanupStaleUploads, restoreFreshUploads, trackUpload, trackedUploadBytes, deleteTrackedUpload, loadConsensusAuth, saveConsensusAuth, clearConsensusAuth, SECURITY_HEADERS, requestGuard, validAccessToken, prunePendingSignIns, dataSourcesAction, errorStatus, oneAtATime };
