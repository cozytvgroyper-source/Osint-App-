// Data sources whose API keys Public Desk passes to the Open OSINT data service, and the work/api-keys.env format.
// Used by server.mjs (the Data sources panel) and by live-api-keys.mjs (the data service preload).
//
// The file holds KEY=value lines plus PUBLIC_DESK_DISABLED=<source ids> for sources the user disconnected. It is
// only parsed as text, never sourced, so nothing in it runs. Only the names below are read: AI and hosting keys
// (Groq, OpenRouter, Upstash...) are left out on purpose, since they spend credits. Key values never leave
// this module's callers: statuses report which fields are saved, never what they contain.

const field = (env, label = 'API key') => ({ env, label });

export const DATA_SOURCES = Object.freeze([
  { id: 'otx', name: 'AlienVault OTX', fields: [field('OTX_API_KEY')], feeds: ['get_cyber_threats'],
    signup: 'https://otx.alienvault.com', note: 'Threat indicators. Rated medium, so short cyber result lists show C2Intel first.',
    improves: 'Cyber threat searches: adds AlienVault OTX indicators to the threat feed.', example: 'Find recent cyber threats affecting healthcare', recommended: true },
  { id: 'abuseipdb', name: 'AbuseIPDB', fields: [field('ABUSEIPDB_API_KEY')], feeds: ['get_cyber_threats'],
    signup: 'https://www.abuseipdb.com/account/api', note: 'The free plan allows 5 blacklist requests a day, and each cyber search uses one.',
    improves: "Cyber threat searches: adds AbuseIPDB's most-reported IPs to the threat feed.", example: 'Find recent cyber threats affecting healthcare', recommended: true },
  { id: 'intelx', name: 'Intelligence X', fields: [field('INTELX_API_KEY')], feeds: ['get_intelx'],
    signup: 'https://intelx.io/account?tab=developer', note: 'Free keys work: Public Desk sends them to free.intelx.io.',
    improves: 'Leak and breach lookups run from Tool Library or Deep Search (get_intelx); the automatic search rarely picks it.', example: '', recommended: false },
  { id: 'aisstream', name: 'AISStream', fields: [field('AISSTREAM_API_KEY')], feeds: ['get_ais_vessels'],
    signup: 'https://aisstream.io/apikeys', note: 'Live ship positions. Needs map coordinates in the search; coverage is thin in some regions, such as the Persian Gulf.',
    improves: 'Ship positions (get_ais_vessels) when a search includes map coordinates; run it from Tool Library otherwise.', example: '', recommended: false },
  { id: 'urlhaus', name: 'abuse.ch', fields: [field('URLHAUS_AUTH_KEY', 'Auth-Key')], feeds: ['get_malwarebazaar', 'get_threatfox', 'get_cyber_threats'],
    signup: 'https://auth.abuse.ch', note: 'One free key covers MalwareBazaar (file hashes), ThreatFox (indicators) and URLhaus (malicious URLs).',
    improves: 'File-hash and malware searches: MalwareBazaar and ThreatFox answer only with this key.', example: '44d88612fea8a8f36de82e1278abb02f', recommended: true },
  { id: 'greynoise', name: 'GreyNoise', fields: [field('GREYNOISE_API_KEY')], feeds: ['get_greynoise'],
    signup: 'https://www.greynoise.io', note: 'Community tier: IP noise and scanner data.',
    improves: 'IP searches: GreyNoise noise and scanner status, beyond the keyless community lookup.', example: '8.8.8.8', recommended: true },
  { id: 'acled', name: 'ACLED', fields: [field('ACLED_ACCESS_TOKEN', 'Access token'), field('ACLED_EMAIL', 'Account email')],
    feeds: ['get_acled_conflicts'], signup: 'https://acleddata.com', note: 'Conflict events. Free for non-commercial use.',
    improves: 'Conflict searches: recorded armed-conflict and protest events.', example: 'armed conflict in Sudan', recommended: false },
  { id: 'faa', name: 'FAA NOTAM', fields: [field('FAA_NOTAM_API_KEY')], feeds: ['get_notams'],
    signup: 'https://api.faa.gov', note: 'Free after the FAA approves your account.',
    improves: 'Aviation searches: FAA NOTAMs (airspace notices).', example: 'NOTAMs for JFK airport', recommended: false },
  { id: 'fmp', name: 'Financial Modeling Prep', fields: [field('FMP_API_KEY')], feeds: ['get_fmp_quote', 'get_fmp_profile', 'get_fmp_ratios', 'get_fmp_estimates'],
    signup: 'https://financialmodelingprep.com', note: 'Stock quotes and profiles. Small free daily quota.',
    improves: 'Stock and company searches: quotes, profiles, ratios and estimates.', example: 'AAPL stock quote', recommended: false },
  { id: 'fred', name: 'FRED', fields: [field('FRED_API_KEY')], feeds: ['get_fred_series'],
    signup: 'https://fred.stlouisfed.org/docs/api/api_key.html', note: 'US economic series.',
    improves: 'Economic searches: US economic series from the St. Louis Fed.', example: 'US unemployment rate economic series', recommended: false },
  { id: 'eia', name: 'US EIA', fields: [field('EIA_API_KEY')], feeds: [],
    signup: 'https://www.eia.gov/opendata/', note: 'Energy prices for Open OSINT\'s internal feeds; no search tool uses it directly.',
    improves: "Open OSINT's internal energy feeds only; no search shows it directly.", example: '', recommended: false },
  { id: 'finnhub', name: 'Finnhub', fields: [field('FINNHUB_API_KEY')], feeds: [],
    signup: 'https://finnhub.io', note: 'Market quotes for Open OSINT\'s internal feeds; no search tool uses it directly.',
    improves: "Open OSINT's internal market feeds only; no search shows it directly.", example: '', recommended: false },
  { id: 'firms', name: 'NASA FIRMS', fields: [field('NASA_FIRMS_API_KEY', 'Map key')], feeds: [],
    signup: 'https://firms.modaps.eosdis.nasa.gov/api/', note: 'Fire detections. Open OSINT does not offer its wildfire tool yet.',
    improves: 'Nothing yet: Open OSINT does not offer its wildfire tool.', example: '', recommended: false },
  { id: 'opencorporates', name: 'OpenCorporates', fields: [field('OPENCORPORATES_API_KEY')], feeds: ['get_opencorporates'],
    signup: 'https://opencorporates.com', note: 'Company registers. Generally paid.',
    improves: 'Company and filing searches: official company register records.', example: 'Acme Corp company filing', recommended: false },
]);

// Settings that are not keys but are read from the same file (a paid Intelligence X key sets its server).
const SETTINGS = ['INTELX_API_ORIGIN'];
const DISABLED_NAME = 'PUBLIC_DESK_DISABLED';
const KEY_NAMES = DATA_SOURCES.flatMap(source => source.fields.map(f => f.env));
export const MANAGED_ENV_NAMES = Object.freeze([...KEY_NAMES, ...SETTINGS]);
const READABLE = new Set([...MANAGED_ENV_NAMES, DISABLED_NAME]);
const SOURCE_IDS = new Set(DATA_SOURCES.map(source => source.id));

const LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

function unquote(raw) {
  const value = raw.trim();
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) return value.slice(1, -1);
  return value;
}

export function parseKeyFile(text) {
  const values = new Map();
  const disabled = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const match = line.match(LINE);
    if (!match || !READABLE.has(match[1])) continue;
    const value = unquote(match[2]);
    if (match[1] === DISABLED_NAME) {
      for (const id of value.split(',').map(s => s.trim())) if (SOURCE_IDS.has(id)) disabled.add(id);
    } else if (value) {
      values.set(match[1], value);
    }
  }
  return { values, disabled };
}

export function sourceStatuses({ values, disabled }) {
  return DATA_SOURCES.map(source => {
    const saved = source.fields.filter(f => values.has(f.env)).map(f => f.env);
    const configured = saved.length === source.fields.length;
    const status = !configured ? 'not_configured' : disabled.has(source.id) ? 'disconnected' : 'connected';
    return { id: source.id, name: source.name, feeds: source.feeds, signup: source.signup, note: source.note,
      improves: source.improves, example: source.example, recommended: source.recommended, fields: source.fields, saved, status };
  });
}

export function effectiveEnv(parsed) {
  const env = {};
  for (const source of sourceStatuses(parsed)) {
    if (source.status !== 'connected') continue;
    for (const f of source.fields) env[f.env] = parsed.values.get(f.env);
  }
  for (const name of SETTINGS) if (parsed.values.has(name)) env[name] = parsed.values.get(name);
  return env;
}

// Keys and emails are single tokens: no spaces, quotes or control characters, so a value always stays on its line.
export function validateKeyValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new Error('Paste the key first.');
  if (trimmed.length > 500) throw new Error('That is longer than any API key.');
  if (!/^[\x21-\x7e]+$/.test(trimmed) || /["'`]/.test(trimmed)) throw new Error('A key cannot contain spaces, quotes or line breaks.');
  return trimmed;
}

// Rewrites only the lines it changes, so the template's comments and order survive. Removed keys keep an empty line.
export function updateKeyFile(text, { set = {}, unset = [], disabled } = {}) {
  const changes = new Map(Object.entries(set));
  for (const name of unset) changes.set(name, '');
  if (disabled) changes.set(DISABLED_NAME, [...new Set(disabled)].filter(id => SOURCE_IDS.has(id)).join(','));
  for (const name of changes.keys()) if (!READABLE.has(name)) throw new Error(`${name} is not a data-source key`);

  const lines = String(text).replace(/\n$/, '').split('\n');
  const written = new Set();
  const out = [];
  for (const line of lines) {
    const match = line.match(LINE);
    if (match && changes.has(match[1]) && !/^\s*#/.test(line)) {
      if (written.has(match[1])) continue;
      out.push(`${match[1]}=${changes.get(match[1])}`);
      written.add(match[1]);
    } else {
      out.push(line);
    }
  }
  for (const [name, value] of changes) {
    if (written.has(name) || (!value && name !== DISABLED_NAME)) continue;
    if (name === DISABLED_NAME && !value) continue;
    out.push(`${name}=${value}`);
  }
  const result = out.join('\n').replace(/^\n+/, '');
  return result ? `${result}\n` : '';
}
