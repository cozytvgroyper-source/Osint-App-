// Results-only view for a ranked search report. DOM-free: returns an HTML string.
// helpers: {escapeHtml, renderArray, renderRecord, renderCategory, renderSources, openKeys}
export function renderRankedReport(data = {}, helpers) {
  const {escapeHtml: esc, renderArray, renderRecord, renderCategory, renderSources, openKeys = null} = helpers;
  const ranking = data.ranking || {};
  const report = data.report || {};
  const errors = data.errors || [];
  const sections = ranking.sections || [];
  const topResults = ranking.topResults || [];

  // A details element is open when the user left it open (openKeys) or when it opens by default. Default-open ones are
  // marked data-default-open so a live redraw does not carry them forward as if the user had opened them.
  const isOpen = (key, byDefault) => byDefault || (openKeys instanceof Set && openKeys.has(key));
  const openAttr = (key, byDefault) => (isOpen(key, byDefault) ? ' open' : '');
  const finished = !report['Still Running'];
  const label = item => `${esc(item.tool)} · ${esc(item.server)}`;

  const parts = [];

  // 1. Status line
  const total = sections.reduce((sum, s) => sum + (s.matching?.length || 0) + (s.nonMatching?.length || 0), 0);
  const running = report['Still Running']?.data?.sources?.length || 0;
  const queried = data.modulesQueried ?? sections.length;
  parts.push(running
    ? `<p class="search-status">${queried - running} of ${queried} tools answered…</p>`
    : `<p class="search-status">${total} results from ${sections.length} tools</p>`);

  // 2. Top results
  if (topResults.length) {
    parts.push(`<section class="result-category"><div class="category-head"><p class="eyebrow">Top results</p></div>${
      topResults.map(item => `<div class="top-result"><p class="result-source">${label(item)}</p>${renderArray([item.item])}</div>`).join('')
    }</section>`);
  }

  // 3. Per-tool sections
  for (const s of sections) {
    let body;
    if (s.single) {
      body = renderRecord(s.matching?.[0] ?? s.nonMatching?.[0]);
    } else {
      body = (s.facts != null ? renderRecord(s.facts) : '') + renderArray(s.matching || []);
      const rest = s.nonMatching || [];
      if (rest.length) {
        const key = `more:${s.toolName}`;
        body += `<details class="more-results" data-details-key="${esc(key)}"${openAttr(key, false)}><summary>Show ${rest.length} more from ${esc(s.tool)}</summary>${renderArray(rest)}</details>`;
      }
    }
    parts.push(`<section class="result-category"><div class="category-head"><p class="eyebrow">${label(s)}</p></div>${body}</section>`);
  }

  // 4. Consolidated findings
  if (report['Consolidated Findings']) parts.push(renderCategory('Consolidated Findings', report['Consolidated Findings']));

  // 6. Empty copy precedes details
  const noResults = finished && !sections.length;
  if (noResults) parts.push('<p class="empty-copy">No results for this search</p>');

  // 5. Search details
  const detail = [`<h3>Search details</h3>`];
  detail.push(renderSources(report.Sources));
  for (const name of ['Still Running', 'Planner Diagnostics', 'Related Links']) {
    if (report[name]) detail.push(renderCategory(name, report[name]));
  }
  if (errors.length) detail.push(renderArray(errors));
  if (sections.length) {
    detail.push(`<ul class="tool-descriptions">${sections.map(s =>
      `<li><strong>${label(s)}</strong>${s.description ? ` — ${esc(s.description)}` : ''}</li>`).join('')}</ul>`);
  }
  parts.push(`<details class="search-details"${noResults ? ' data-default-open' : ''} data-details-key="search-details"${openAttr('search-details', noResults)}>${detail.join('')}</details>`);

  return parts.join('');
}
