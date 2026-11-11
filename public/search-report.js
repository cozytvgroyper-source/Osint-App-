// Builds the main-search report from each source's outcome. `outcomes[i]` is a Promise.allSettled-style entry
// for plan[i] whose value is {tool, outcome: classifyToolResult(...)}.

const NOT_FINDINGS = new Set(['Related Links', 'Search Plan', 'Planner Diagnostics']);

export function buildSearchReport({query, intent, plan, outcomes, diagnostics, links = [], categoryForTool, sourceLabel}) {
  const report = {}; const errors = []; const servers = new Set();
  if (plan.length) {
    report['Search Plan'] = {
      eyebrow: 'DYNAMIC MCP ROUTING',
      description: 'Public Desk inspected every connected tool and selected the most relevant passive capabilities for this query.',
      data: plan.map(item => ({tool: item.tool.name, server: item.tool.serverName, reason: item.reason}))
    };
  }
  if (diagnostics) report['Planner Diagnostics'] = {eyebrow: 'DEVELOPMENT MODE', description: 'Why each tool was or was not chosen. Shown because Public Desk was opened with ?diagnostics.', data: diagnostics};
  if (!plan.length) errors.push({source: 'Relevant MCP server', error: 'No connected server currently provides the tools needed for this search category. Connect the matching server and try again.'});

  plan.forEach(({tool}, index) => {
    const outcome = outcomes[index];
    if (outcome.status !== 'fulfilled') { errors.push({source: sourceLabel(tool.name), error: outcome.reason?.message || 'Source unavailable'}); return; }
    servers.add(tool.serverName);
    const result = outcome.value.outcome;
    if (result.kind === 'error') errors.push({source: sourceLabel(tool.name), error: result.error});
    else if (result.kind === 'empty') errors.push({source: sourceLabel(tool.name), error: 'No matching records returned for this subject.'});
    else {
      const category = categoryForTool(tool); let key = category;
      if (report[key]) key = `${category} — ${sourceLabel(tool.name)}`;
      report[key] = {eyebrow: `${tool.serverName} · ${sourceLabel(tool.name)}`, description: tool.description || `Results from ${tool.serverName}`, data: result.data};
    }
  });

  if (links.length) report['Related Links'] = {eyebrow: 'FOLLOW-UP SOURCES', description: 'Useful external sources for verifying and expanding this search.', data: {links}};

  const findingCount = Object.keys(report).filter(key => !NOT_FINDINGS.has(key)).length;
  const payload = {description: `${intent.label} for “${query}”`, data: {query, modulesQueried: plan.length, modulesWithResults: findingCount, durationMs: 0, report, errors}};
  return {result: {content: [{type: 'text', text: JSON.stringify(payload)}]}, servers, findingCount};
}
