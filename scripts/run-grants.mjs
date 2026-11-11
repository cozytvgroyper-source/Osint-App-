import {randomBytes} from 'node:crypto';
import {toolRisk} from '../public/tool-tiers.js';

export const RUN_GRANT_TTL_MS = 2 * 60_000;
export const RUN_GRANT_LIMIT = 100;

const BUNDLED_SERVER_NAMES = new Map([
  ['http://127.0.0.1:8892/mcp', 'Open OSINT'],
  ['http://127.0.0.1:8893/mcp', 'OSINT Toolbox'],
  ['http://127.0.0.1:8894/mcp', 'Omega MCP'],
  ['https://mcp.consensus.app/mcp', 'Consensus']
]);

export class RunGrantError extends Error {
  constructor(message, status = 403) { super(message); this.name = 'RunGrantError'; this.code = 'RUN_GRANT'; this.status = status; }
}

function endpointKey(endpoint) {
  try { return new URL(String(endpoint)).toString().replace(/\/$/, ''); }
  catch { throw new RunGrantError('Run grant endpoint is invalid', 400); }
}

export function serverNameForEndpoint(endpoint) {
  return BUNDLED_SERVER_NAMES.get(endpointKey(endpoint)) || 'Custom MCP';
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

export const stableArguments = value => JSON.stringify(stable(value ?? {}));
const callKey = ({endpoint, name, arguments: args}) => `${endpointKey(endpoint)}\n${name}\n${stableArguments(args)}`;

export function pruneRunGrants(grants, now = Date.now()) {
  for (const [token, grant] of grants) if (grant.expiresAt <= now) grants.delete(token);
  while (grants.size >= RUN_GRANT_LIMIT) grants.delete(grants.keys().next().value);
}

export function createRunGrant(request, grants, {now = Date.now(), ttl = RUN_GRANT_TTL_MS, token = randomBytes(24).toString('base64url')} = {}) {
  pruneRunGrants(grants, now);
  const purpose = request?.purpose === 'deep-search' ? 'deep-search' : 'tool-library';
  const target = String(request?.target || '').trim();
  const level = Number(request?.level);
  const tools = Array.isArray(request?.tools) ? request.tools : [];
  const confirmation = request?.confirmation || {};
  if (!target || target.length > 500) throw new RunGrantError('A target between 1 and 500 characters is required', 400);
  if (!Number.isInteger(level) || level < 0 || level > 3) throw new RunGrantError('Run grant level must be Passive, Light touch, Active, or Intrusive', 400);
  if (!tools.length || tools.length > 25) throw new RunGrantError('Run grants require between 1 and 25 tools', 400);

  const allowedCalls = new Map();
  let highestRisk = 0;
  let spendsCredits = false;
  let hasSideEffects = false;
  for (const item of tools) {
    const name = String(item?.name || '').trim();
    if (!name) throw new RunGrantError('Every granted tool needs a name', 400);
    const endpoint = endpointKey(item.endpoint);
    const risk = toolRisk({name, serverName: serverNameForEndpoint(endpoint)});
    if (risk.level > level) throw new RunGrantError(`${name} is ${risk.label} and exceeds this run's level`);
    highestRisk = Math.max(highestRisk, risk.level);
    spendsCredits ||= risk.flags.includes('credits');
    hasSideEffects ||= risk.flags.includes('side-effects');
    const allowed = {endpoint, name, arguments: item.arguments ?? {}};
    allowedCalls.set(callKey(allowed), {endpoint, name, level: risk.level});
  }
  if (purpose !== 'deep-search' && !highestRisk && !spendsCredits && !hasSideEffects) throw new RunGrantError('This passive lookup does not need a run grant', 400);
  if (!confirmation.acknowledged) throw new RunGrantError('Confirm that the target may notice this request');
  if ((purpose === 'deep-search' || highestRisk >= 2) && !confirmation.authorization) {
    throw new RunGrantError('Confirm that you own this target or have written permission to test it');
  }
  if (highestRisk >= 3) {
    const typed = purpose === 'deep-search' ? confirmation.typedTarget : confirmation.typedName;
    const expected = purpose === 'deep-search' ? target : tools[0].name;
    if (String(typed || '').trim() !== expected) throw new RunGrantError(`Type ${expected} exactly to confirm this intrusive run`);
  }
  if (spendsCredits && !confirmation.credits) throw new RunGrantError('Confirm that this run may spend paid AI credits');
  if (hasSideEffects && !confirmation.sideEffects) throw new RunGrantError('Confirm that this tool may send, store, schedule, or change data');

  const grant = {purpose, target, level, createdAt: now, expiresAt: now + ttl, allowedCalls};
  grants.set(token, grant);
  return {token, target, level, expiresAt: grant.expiresAt};
}

export function authorizeMcpToolCall(payload, grants, {now = Date.now()} = {}) {
  if (payload?.method !== 'tools/call') return {required: false};
  const name = String(payload?.params?.name || '').trim();
  const endpoint = endpointKey(payload?.endpoint);
  const risk = toolRisk({name, serverName: serverNameForEndpoint(endpoint)});
  if (!payload?.runGrant && risk.level === 0 && !risk.flags.some(flag => flag === 'credits' || flag === 'side-effects')) return {required: false, risk};

  pruneRunGrants(grants, now);
  const token = String(payload?.runGrant || '');
  const grant = grants.get(token);
  if (!grant) throw new RunGrantError('This risky tool requires a current confirmed run grant');
  if (String(payload.runTarget || '') !== grant.target) throw new RunGrantError('The run grant does not match this target');
  if (grant.level < risk.level) throw new RunGrantError('The run grant does not allow this tool tier');
  const key = callKey({endpoint, name, arguments: payload?.params?.arguments ?? {}});
  if (!grant.allowedCalls.has(key)) throw new RunGrantError('The run grant does not match this tool or its arguments');

  grant.allowedCalls.delete(key);
  if (!grant.allowedCalls.size) grants.delete(token);
  return {required: true, risk, grant};
}
