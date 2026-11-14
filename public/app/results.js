// Result window: turning a tool answer into readable sections.
// Moved unchanged from app.js; see app.js for the startup and button wiring.
import { escapeHtml, term } from '../ui.js?v=6';
import { parseToolResult } from '../result-classifier.js';
import { reportHasFindings } from '../search-report.js?v=4';
import { renderRankedReport } from '../search-results-view.js?v=4';
import { resultPivot } from '../result-pivots.js?v=1';
import { $, state, openDialog } from './core.js';
import { tierBadge } from './tools.js';

function humanize(value = '') {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
function sourceLabel(value = '') {
  return humanize(String(value).replace(/^(?:get_|omega_)/, ''));
}
function readableValue(key, value) {
  if (value === null || value === undefined || value === '') return 'Not reported';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (/At$|timestamp|date/i.test(key) && value > 1e11) return new Date(value).toLocaleString();
    return value.toLocaleString();
  }
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value))
      return `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">Open source ↗</a>`;
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.valueOf())) return date.toLocaleString();
    }
    return escapeHtml(value);
  }
  return escapeHtml(JSON.stringify(value));
}
function pivotButton(value) {
  const pivot = resultPivot(value);
  return pivot
    ? `<button type="button" class="pivot-button" data-pivot="${escapeHtml(pivot.target)}" aria-label="${escapeHtml(`Pivot: ${pivot.label[0].toLowerCase()}${pivot.label.slice(1)} ${pivot.target}`)}">Pivot →</button>`
    : '';
}
function renderRecord(data) {
  // Multi-line text (Omega's captured module output) keeps its line breaks and column alignment.
  if (typeof data === 'string' && data.includes('\n')) return `<pre>${escapeHtml(data)}</pre>`;
  if (!data || typeof data !== 'object') return `<p>${readableValue('', data)}</p>`;
  const scalarEntries = Object.entries(data).filter(
    ([, value]) => !Array.isArray(value) && (typeof value !== 'object' || value === null)
  );
  return scalarEntries.length
    ? `<dl class="fact-list">${scalarEntries.map(([key, value]) => `<div><dt>${escapeHtml(humanize(key))}</dt><dd>${readableValue(key, value)}${pivotButton(value)}</dd></div>`).join('')}</dl>`
    : '';
}
function renderArray(items) {
  if (!items.length) return '<p class="empty-copy">No matching items reported.</p>';
  return `<div class="result-items">${items
    .slice(0, 25)
    .map((item, index) => {
      if (typeof item !== 'object' || item === null)
        return `<div class="result-item"><b>${index + 1}.</b> ${readableValue('', item)}${pivotButton(item)}</div>`;
      const title = item.title || item.name || item.place || item.headline || item.id || `Item ${index + 1}`;
      const rest = Object.fromEntries(
        Object.entries(item).filter(([key]) => !['title', 'name', 'place', 'headline', 'id'].includes(key))
      );
      return `<article class="result-item"><div class="result-item-title"><h4>${escapeHtml(title)}</h4>${pivotButton(title)}</div>${renderRecord(rest)}</article>`;
    })
    .join(
      ''
    )}</div>${items.length > 25 ? `<p class="result-note">Showing 25 of ${items.length.toLocaleString()} items.</p>` : ''}`;
}
// A record's scalars, then its nested objects and lists as subgroups. Shared by categories and the ranked view.
function renderBody(data) {
  const arrays =
    data && typeof data === 'object' ? Object.entries(data).filter(([, value]) => Array.isArray(value)) : [];
  const objects =
    data && typeof data === 'object'
      ? Object.entries(data).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
      : [];
  return `${renderRecord(data)}${objects.map(([key, value]) => `<div class="result-subgroup"><h4>${escapeHtml(humanize(key))}</h4>${renderRecord(value)}</div>`).join('')}${arrays.map(([key, items]) => `<div class="result-subgroup"><h4>${escapeHtml(humanize(key))}</h4>${renderArray(items)}</div>`).join('')}`;
}
function renderCategory(name, entry) {
  const data = entry?.data ?? entry;
  return `<section class="result-category"><div class="category-head"><div><p class="eyebrow">${escapeHtml(entry?.eyebrow || 'CATEGORY')}</p><h3>${escapeHtml(humanize(name))}</h3></div>${entry?.description ? `<p>${escapeHtml(entry.description)}</p>` : ''}</div>${renderBody(data)}</section>`;
}
function renderSources(entry) {
  const sources = entry?.data?.sources || [];
  const when = value =>
    value ? `<time datetime="${escapeHtml(value)}">${escapeHtml(new Date(value).toLocaleString())}</time>` : '—';
  const cards = sources
    .map(source => {
      const outcome = source.outcome || { kind: 'running' };
      const error = outcome.error ? `<p class="source-error">${escapeHtml(outcome.error)}</p>` : '';
      return `<article class="source-entry"><div class="source-entry-head"><div><h4>${escapeHtml(source.tool)}</h4><p>${escapeHtml(source.server)}</p></div>${tierBadge(source.tier)}</div><p class="source-reason">${escapeHtml(source.reason)}</p><dl class="source-meta"><div><dt>Started</dt><dd>${when(source.startedAt)}</dd></div><div><dt>Finished</dt><dd>${when(source.finishedAt)}</dd></div><div><dt>Outcome</dt><dd><span class="source-outcome source-outcome-${escapeHtml(outcome.kind)}">${escapeHtml(humanize(outcome.kind))}</span></dd></div></dl><div class="source-arguments"><b>Arguments sent</b><pre>${escapeHtml(JSON.stringify(source.arguments || {}, null, 2))}</pre></div>${error}</article>`;
    })
    .join('');
  return `<section class="result-category sources-category"><div class="category-head"><div><p class="eyebrow">${escapeHtml(entry?.eyebrow || 'SEARCH PROVENANCE')}</p><h3>Sources</h3></div>${entry?.description ? `<p>${escapeHtml(entry.description)}</p>` : ''}</div><div class="source-list">${cards}</div></section>`;
}
function renderReadableResult(result, openKeys = null) {
  const parsed = parseToolResult(result);
  const payload = parsed?.data ?? parsed;
  const report = payload?.report;
  if (payload?.ranking && payload?.report)
    return renderRankedReport(payload, {
      escapeHtml,
      renderArray,
      renderRecord,
      renderBody,
      renderCategory,
      renderSources,
      openKeys
    });
  if (report && typeof report === 'object') {
    const entries = Object.entries(report);
    const hasFindings = reportHasFindings(report);
    const content = entries
      .map(([name, entry]) => (name === 'Sources' ? renderSources(entry) : renderCategory(name, entry)))
      .join('');
    const errors =
      !('Still Running' in report) && !hasFindings && Array.isArray(payload.errors) && payload.errors.length
        ? `<section class="result-category warning"><div class="category-head"><div><p class="eyebrow">SEARCH RESULT</p><h3>No results returned</h3></div></div>${renderArray(payload.errors)}</section>`
        : '';
    return `${content}${errors}` || '<p class="empty-copy">No matching results returned.</p>';
  }
  if (Array.isArray(payload))
    return `<section class="result-category"><div class="category-head"><div><p class="eyebrow">RESULT</p><h3>Findings</h3></div></div>${renderArray(payload)}</section>`;
  if (payload && typeof payload === 'object')
    return `<section class="result-category"><div class="category-head"><div><p class="eyebrow">RESULT</p><h3>Findings</h3></div></div>${renderRecord(payload)}${Object.entries(
      payload
    )
      .filter(([, value]) => Array.isArray(value))
      .map(
        ([key, items]) =>
          `<div class="result-subgroup"><h4>${escapeHtml(humanize(key))}</h4>${renderArray(items)}</div>`
      )
      .join(
        ''
      )}</section><details class="raw-result"><summary>Technical details</summary><pre>${escapeHtml(JSON.stringify(parsed, null, 2))}</pre></details>`;
  return `<div class="plain-result">${escapeHtml(String(payload ?? 'No result returned.'))}</div>`;
}
// The save button says where a finding goes: the open case, or a new one created for it.
function saveButtonLabel(activeCase) {
  return activeCase?.name ? `Save to ${activeCase.name} case` : 'Save to a new case';
}
// saved:true shows a finding that is already in the case, so there is nothing to save.
function showResult(title, result, { saved = false } = {}) {
  const dialog = $('#resultDialog');
  const refresh = dialog.open && $('#resultTitle').textContent === title;
  const scroll = refresh ? [dialog.scrollTop, $('#resultBody').scrollTop] : [0, 0];
  const openKeys = refresh
    ? new Set(
        [...$('#resultBody').querySelectorAll('details[data-details-key][open]:not([data-default-open])')].map(
          el => el.dataset.detailsKey
        )
      )
    : null;
  $('#resultTitle').textContent = title;
  $('#resultBody').innerHTML = renderReadableResult(result, openKeys);
  // Explain Pivot once, above the first result that offers one.
  if ($('#resultBody').querySelector('.pivot-button'))
    $('#resultBody').insertAdjacentHTML('afterbegin', `<p class="pivot-note">${term('pivot', { visible: true })}</p>`);
  $('#saveEvidence').textContent = saveButtonLabel(state.activeCase);
  $('#saveEvidence').hidden = saved;
  if (refresh) {
    dialog.scrollTop = scroll[0];
    $('#resultBody').scrollTop = scroll[1];
  }
  if (!dialog.open) openDialog(dialog);
}
// Refreshes a search that is still running without reopening the window if the user has closed it.
function updateOpenResult(title, result) {
  if ($('#resultDialog').open && $('#resultTitle').textContent === title) showResult(title, result);
}

const categoryNames = {
  get_nvd_cves: 'Vulnerability Details',
  get_cisa_kev: 'Known Exploitation Status',
  whois_lookup: 'Registration and Ownership',
  dnstwist_lookalike_domains: 'Look-alike and Phishing Risk',
  get_bgp: 'Routing and Network Ownership',
  get_greynoise: 'Scanner and Reputation Context',
  get_whois: 'Registration Data',
  get_wikidata: 'Identity and Background',
  get_opencorporates: 'Corporate Records',
  get_news_rss: 'Related Coverage',
  get_gdelt: 'Global Event Coverage',
  get_news_velocity: 'Coverage Momentum',
  get_geocode: 'Map and Coordinates',
  get_country_facts: 'Country Overview',
  get_travel_advisories: 'Travel and Safety',
  get_arxiv: 'Research Papers',
  get_opensanctions: 'Global Sanctions Matches',
  get_sanctions: 'OFAC Sanctions Matches',
  get_earthquakes: 'Earthquake Activity',
  get_natural_events: 'Active Natural Events',
  get_disaster_alerts: 'Disaster Alerts',
  get_cyber_news: 'Cybersecurity Coverage',
  get_ransomware: 'Ransomware Activity',
  get_threatfox: 'Threat Indicators',
  get_maritime_news: 'Maritime Coverage',
  get_chokepoints: 'Chokepoint Status',
  get_ais_vessels: 'Vessel Positions',
  get_notams: 'Airspace Notices',
  get_aviation_news: 'Aviation Coverage',
  get_aircraft: 'Aircraft Positions',
  get_crypto: 'Market Prices',
  get_fear_greed: 'Market Sentiment',
  get_stablecoins: 'Stablecoin Market',
  get_fmp_quote: 'Market Quote',
  get_fmp_profile: 'Company Profile',
  get_sec_filings: 'Regulatory Filings',
  get_economic_macro: 'Macroeconomic Snapshot',
  get_bis_rates: 'Policy Rates',
  get_bis_fx: 'Exchange Rates',
  get_github_activity: 'Public Repository Activity',
  get_satellite_snapshot: 'Satellite Imagery Links',
  get_satellites: 'Satellite Tracking',
  get_election_monitor: 'Election Monitoring',
  get_health_advisories: 'Health Advisories',
  get_nuclear_status: 'Nuclear and Arms-Control Updates',
  get_radiation_safecast: 'Radiation Monitoring',
  get_energy_commodities_news: 'Energy and Commodities Coverage',
  get_critical_minerals: 'Critical Minerals',
  get_offshore_leaks: 'Offshore Records',
  get_food_security: 'Food-Security Conditions',
  sherlock_username_search: 'Username Matches',
  blackbird_username_search: 'Additional Account Matches',
  holehe_email_search: 'Email Account Presence',
  phoneinfoga_scan: 'Phone Information',
  get_malwarebazaar: 'Malware Records',
  omega_malware: 'Malware Reputation'
};
function categoryForTool(tool) {
  return categoryNames[tool.name] || sourceLabel(tool.name);
}

export {
  humanize,
  sourceLabel,
  readableValue,
  pivotButton,
  renderRecord,
  renderArray,
  renderBody,
  renderCategory,
  renderSources,
  renderReadableResult,
  saveButtonLabel,
  showResult,
  updateOpenResult,
  categoryNames,
  categoryForTool
};
