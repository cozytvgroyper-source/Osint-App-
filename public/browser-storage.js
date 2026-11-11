export const STORAGE_KEYS = {
  servers: 'signaldesk.servers',
  history: 'signaldesk.history',
  evidence: 'signaldesk.evidence',
  toolHealth: 'signaldesk.toolHealth',
  disabledBundled: 'signaldesk.disabledBundledServers'
};

export const MAX_EVIDENCE_ITEMS = 100;
export const MAX_EVIDENCE_BYTES = 2_500_000;

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validServer = value => isRecord(value) && typeof value.name === 'string' && typeof value.endpoint === 'string';
const validHistory = value => isRecord(value) && typeof value.title === 'string';
const validEvidence = value => isRecord(value) && typeof value.title === 'string' && 'result' in value;

function readEntry(storage, key, fallback, validate, recover, label) {
  const raw = storage.getItem(key);
  if (raw == null) return { value: fallback, warnings: [] };
  try {
    const parsed = JSON.parse(raw);
    if (validate(parsed)) return { value: recover ? recover(parsed) : parsed, warnings: [] };
    return { value: fallback, warnings: [`Saved ${label} had an unexpected format and was ignored.`] };
  } catch {
    return { value: fallback, warnings: [`Saved ${label} was damaged and was ignored.`] };
  }
}

function recoverArray(values, predicate) {
  return values.filter(predicate);
}

export function mergeStoredServers(bundledServers, storedServers, disabledEndpoints = []) {
  const disabled = new Set(disabledEndpoints);
  const retained = storedServers.filter(server => !disabled.has(server.endpoint)).map(server => {
    const bundled = bundledServers.find(candidate => candidate.endpoint === server.endpoint);
    return { ...bundled, ...server, status: 'offline', tools: [] };
  });
  const missing = bundledServers.filter(bundled => !disabled.has(bundled.endpoint) && !retained.some(server => server.endpoint === bundled.endpoint));
  return [...missing, ...retained];
}

export function limitEvidence(evidence, { maxItems = MAX_EVIDENCE_ITEMS, maxBytes = MAX_EVIDENCE_BYTES } = {}) {
  const kept = [];
  let bytes = 2;
  for (const item of evidence.filter(validEvidence).slice(0, maxItems)) {
    const serialized = JSON.stringify(item);
    const itemBytes = new TextEncoder().encode(serialized).byteLength + (kept.length ? 1 : 0);
    if (bytes + itemBytes > maxBytes) break;
    kept.push(item);
    bytes += itemBytes;
  }
  return { evidence: kept, dropped: evidence.length - kept.length, bytes };
}

export function loadStoredState(storage) {
  const servers = readEntry(storage, STORAGE_KEYS.servers, [], Array.isArray, values => recoverArray(values, validServer), 'servers');
  const history = readEntry(storage, STORAGE_KEYS.history, [], Array.isArray, values => recoverArray(values, validHistory), 'history');
  const savedEvidence = readEntry(storage, STORAGE_KEYS.evidence, [], Array.isArray, values => recoverArray(values, validEvidence), 'evidence');
  const toolHealth = readEntry(storage, STORAGE_KEYS.toolHealth, {}, isRecord, null, 'tool health');
  const disabledBundled = readEntry(storage, STORAGE_KEYS.disabledBundled, [], Array.isArray, values => values.filter(value => typeof value === 'string'), 'disabled bundled servers');
  const bounded = limitEvidence(savedEvidence.value);
  const warnings = [...servers.warnings, ...history.warnings, ...savedEvidence.warnings, ...toolHealth.warnings, ...disabledBundled.warnings];
  if (bounded.dropped) warnings.push(`${bounded.dropped} older or oversized evidence item${bounded.dropped === 1 ? '' : 's'} could not be retained.`);
  return { servers: servers.value, history: history.value.slice(0, 20), evidence: bounded.evidence, toolHealth: toolHealth.value, disabledBundledEndpoints: disabledBundled.value, warnings };
}

function storedServers(servers) {
  return servers.map(({ tools, token, authorization, ...server }) => ({ ...server, status: 'offline' }));
}

export function persistStoredState(storage, state, options = {}) {
  const bounded = limitEvidence(state.evidence, options);
  const entries = [
    [STORAGE_KEYS.servers, storedServers(state.servers)],
    [STORAGE_KEYS.history, state.history.slice(0, 20)],
    [STORAGE_KEYS.evidence, bounded.evidence],
    [STORAGE_KEYS.toolHealth, state.toolHealth],
    [STORAGE_KEYS.disabledBundled, [...(state.disabledBundledEndpoints || [])]]
  ];
  const warnings = [];
  if (bounded.dropped) warnings.push(`Evidence storage is limited to ${options.maxItems ?? MAX_EVIDENCE_ITEMS} items and ${Math.round((options.maxBytes ?? MAX_EVIDENCE_BYTES) / 1_000_000 * 10) / 10} MB. Export evidence before saving more.`);
  for (const [key, value] of entries) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      warnings.push(error?.name === 'QuotaExceededError' ? 'Browser storage is full. Existing saved data was kept; export evidence before trying again.' : `Could not save ${key}. Existing saved data was kept.`);
    }
  }
  return { evidence: bounded.evidence, warnings };
}
