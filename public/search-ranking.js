// Ranks search results for the report. Pure and DOM-free: finds the record lists in each tool's data,
// scores every record by how well it matches the searched subject, and returns the best ones overall
// (topResults) plus one section per tool with its matching records, folded non-matching records and facts.
const TEXT_FIELDS = ['title', 'name', 'headline', 'place', 'description', 'summary', 'snippet', 'text'];
const TOP_LIMIT = 10;

const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isItemList = value => Array.isArray(value) && value.every(isPlain);
const strings = values => values.filter(value => typeof value === 'string');
const splitWords = text => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function subjectWords(subject) {
  const words = splitWords(subject.toLowerCase());
  const long = words.filter(word => word.length > 2);
  return long.length ? long : words;
}

export function matchScore(text, subject) {
  const needle = String(subject ?? '').trim().toLowerCase();
  if (!needle) return 1;
  const haystack = String(text ?? '').toLowerCase();
  if (haystack.includes(needle)) return 3;
  const present = new Set(splitWords(haystack));
  const hits = subjectWords(needle).filter(word => present.has(word)).length;
  const total = subjectWords(needle).length;
  return hits === 0 ? 0 : hits === total ? 2 : 1;
}

function itemText(item, single) {
  if (typeof item === 'string') return item;
  const named = strings(TEXT_FIELDS.map(field => item[field]));
  return (named.length || !single ? named : strings(Object.values(item))).join(' ');
}

// Returns the data's item lists (combined in order; an empty array counts as a list) and the data with those lists removed.
function split(data) {
  const items = [];
  let listed = false;
  const strip = value => {
    if (isItemList(value)) { listed = true; items.push(...value); return undefined; }
    if (!isPlain(value) && !Array.isArray(value)) return value;
    const entries = Array.isArray(value) ? value.map(strip) : Object.entries(value).map(([key, child]) => [key, strip(child)]);
    if (Array.isArray(value)) return entries.every(child => child === undefined) && entries.length ? undefined : entries.filter(child => child !== undefined);
    const kept = entries.filter(([, child]) => child !== undefined);
    return kept.length || !Object.keys(value).length ? Object.fromEntries(kept) : undefined;
  };
  const rest = strip(data);
  return {items, rest, listed};
}

export function rankResults({subject = '', preferredNames = [], entries = []} = {}) {
  const preferred = new Set(preferredNames);
  const sections = [];
  let order = 0;
  for (const {tool, toolLabel, data} of entries) {
    const direct = preferred.has(tool.name);
    let {items, rest, listed} = split(data);
    let single = false;
    if (!listed && ((isPlain(data) && Object.keys(data).length) || (typeof data === 'string' && data.trim()))) {
      items = [data];
      single = true;
    }
    const scored = items.map(item => ({
      toolName: tool.name, tool: toolLabel, server: tool.serverName, direct, item, index: order++,
      score: matchScore(itemText(item, single), subject)
    }));
    const facts = single || rest === undefined || rest === null || (isPlain(rest) && !Object.keys(rest).length) ? null : rest;
    sections.push({tool, toolLabel, direct, single, scored, facts});
  }
  const compare = (a, b) => b.score - a.score || Number(b.direct) - Number(a.direct) || a.index - b.index;
  const ranked = sections.map(section => {
    const sorted = [...section.scored].sort(compare);
    return {section, sorted, best: sorted[0]};
  });
  ranked.sort((a, b) => (a.best && b.best ? compare(a.best, b.best) : a.best ? -1 : b.best ? 1 : 0));
  const topResults = ranked.flatMap(({sorted}) => sorted).filter(entry => entry.score > 0).sort(compare).slice(0, TOP_LIMIT)
    .map(({toolName, tool, server, score, direct, item}) => ({toolName, tool, server, score, direct, item}));
  return {
    subject,
    topResults,
    sections: ranked.map(({section, sorted}) => ({
      toolName: section.tool.name,
      tool: section.toolLabel,
      server: section.tool.serverName,
      description: section.tool.description,
      direct: section.direct,
      single: section.single,
      matching: sorted.filter(entry => entry.score > 0).map(entry => entry.item),
      nonMatching: section.scored.filter(entry => entry.score === 0).map(entry => entry.item),
      facts: section.facts
    }))
  };
}
