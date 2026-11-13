const LIST_TYPES = new Map([
  ['domains', 'domains'], ['domain', 'domains'], ['subdomains', 'domains'], ['hostnames', 'domains'], ['hosts', 'domains'],
  ['emails', 'emailAddresses'], ['email_addresses', 'emailAddresses'],
  ['ips', 'ipAddresses'], ['ip_addresses', 'ipAddresses'], ['addresses', 'ipAddresses'],
  ['urls', 'urls']
]);

const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL = /https?:\/\/[^\s,;]+/gi;
const DOMAIN = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const isIpv6 = value => value.includes(':') && (value.match(/:/g) || []).length >= 2 && /^[0-9a-f:]+$/i.test(value);

function normalized(type, value) {
  const text = String(value).trim().replace(/[),.;]+$/, '');
  return type === 'ipAddresses' ? text : text.toLowerCase();
}

function domainValues(text) {
  const values = [];
  for (const token of String(text).split(/[\s,;]+/).filter(Boolean)) {
    if (isIpv6(token)) { values.push({type: 'ipAddresses', value: token}); continue; }
    const withoutWildcard = token.replace(/^\*\./, '');
    const ipMatches = withoutWildcard.match(IPV4) || [];
    const host = withoutWildcard.replace(/:\d{1,5}$/, '').split(':')[0];
    if (DOMAIN.test(host)) values.push({type: 'domains', value: host});
    for (const ip of ipMatches) values.push({type: 'ipAddresses', value: ip});
  }
  return values;
}

function valuesFor(type, value) {
  const text = String(value);
  if (type === 'domains') return domainValues(text);
  if (type === 'emailAddresses') return (text.match(EMAIL) || []).map(item => ({type, value: item}));
  if (type === 'ipAddresses') return text.split(/[\s,;]+/).filter(item => (item.match(IPV4) || [])[0] === item || isIpv6(item)).map(item => ({type, value: item}));
  if (type === 'urls') return (text.match(URL) || []).map(item => ({type, value: item}));
  return [];
}

// Pull only primitive indicator arrays into a neutral list. Object-rich arrays stay with their source because
// flattening them would discard certificate, registration, or event details.
export function extractIndicatorLists(data) {
  const findings = [];
  let changed = false;
  function visit(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const copy = {};
    for (const [key, child] of Object.entries(value)) {
      const type = LIST_TYPES.get(key.toLowerCase());
      if (type && Array.isArray(child) && child.every(item => ['string', 'number'].includes(typeof item))) {
        const perItem = child.map(item => ({item, extracted: valuesFor(type, item)}));
        const extracted = perItem.flatMap(entry => entry.extracted);
        if (extracted.length) {
          findings.push(...extracted.map(item => ({...item, normalized: normalized(item.type, item.value)})));
          changed = true;
          // Anything not recognised (localhost, a street address, an ftp link) stays with its source, never dropped.
          const leftover = perItem.filter(entry => !entry.extracted.length).map(entry => entry.item);
          if (leftover.length) copy[key] = leftover;
          continue;
        }
      }
      copy[key] = visit(child);
    }
    return copy;
  }
  return {data: visit(data), findings, changed};
}

export function consolidateIndicatorLists(entries) {
  const merged = new Map();
  for (const entry of entries) {
    for (const finding of entry.findings) {
      const key = `${finding.type}:${finding.normalized}`;
      if (!merged.has(key)) merged.set(key, {type: finding.type, value: finding.value, sources: new Set()});
      merged.get(key).sources.add(entry.source);
    }
  }
  const hasDuplicates = [...merged.values()].some(item => item.sources.size > 1);
  const groups = {};
  if (hasDuplicates) {
    for (const item of merged.values()) {
      (groups[item.type] ||= []).push({title: item.value, foundBy: [...item.sources].join('; '), sourceCount: item.sources.size});
    }
    for (const items of Object.values(groups)) items.sort((a, b) => a.title.localeCompare(b.title));
  }
  return {hasDuplicates, groups};
}
