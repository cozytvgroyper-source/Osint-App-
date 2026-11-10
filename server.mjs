import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const sessions = new Map();

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
  if (token) headers.authorization = `Bearer ${token}`;
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
