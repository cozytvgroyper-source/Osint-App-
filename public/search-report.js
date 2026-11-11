// Builds the main-search report from whatever sources have answered so far, so results can be shown as each
// source answers instead of waiting for the slowest one. `outcomes[i]` is undefined while plan[i] is still running,
// otherwise a Promise.allSettled-style entry whose value is {tool, outcome: classifyToolResult(...)}.

const NOT_FINDINGS = new Set(['Related Links', 'Still Running', 'Planner Diagnostics']);

// Whether a report holds real findings. The result view uses this to decide whether to list source errors.
export function reportHasFindings(report) {
  return Object.keys(report || {}).some(key => !NOT_FINDINGS.has(key));
}

export function buildSearchReport({query, intent, plan, outcomes, diagnostics = null, links = [], categoryForTool, sourceLabel, elapsedMs = 0}) {
  const report = {}; const errors = []; const servers = new Set(); const pending = [];
  if (!plan.length) errors.push({source: 'Relevant MCP server', error: 'No connected server currently provides the tools needed for this search category. Connect the matching server and try again.'});

  plan.forEach(({tool}, index) => {
    const outcome = outcomes[index];
    if (!outcome) { pending.push(tool); return; }
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

  const finished = pending.length === 0;
  if (!finished) {
    report['Still Running'] = {
      eyebrow: 'IN PROGRESS',
      description: 'These sources have not answered yet. Their results appear here as soon as they do.',
      data: {sources: pending.map(tool => ({name: sourceLabel(tool.name), server: tool.serverName}))}
    };
  }
  if (diagnostics) report['Planner Diagnostics'] = {eyebrow:'DEVELOPMENT MODE',description:'Why the automatic planner selected or skipped tools for this search.',data:diagnostics};
  if (links.length) report['Related Links'] = {eyebrow: 'FOLLOW-UP SOURCES', description: 'Useful external sources for verifying and expanding this search.', data: {links}};
  const findingCount = Object.keys(report).filter(key => !NOT_FINDINGS.has(key)).length;
  const answered = plan.length - pending.length;
  const description = finished ? `${intent.label} for “${query}”` : `${intent.label} for “${query}” — ${answered} of ${plan.length} sources answered`;
  const payload = {description, data: {query, modulesQueried: plan.length, modulesWithResults: findingCount, durationMs: finished ? elapsedMs : 0, report, errors}};
  return {result: {content: [{type: 'text', text: JSON.stringify(payload)}]}, finished, servers, findingCount};
}
