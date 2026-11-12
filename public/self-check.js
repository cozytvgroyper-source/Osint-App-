// Tool self-check: runs the tools the automatic search uses against fixed, harmless test targets, so a tool that breaks
// after an update (like GreyNoise's 404, or a changed API) shows up without waiting for a real search to hit it.
// Only passive, unflagged, read-only tools are checked; the targets are reserved or public test values.
import {explainSearchPlan,isPassiveSearchTool} from './search-planner.js';
import {argsForSearch,searchIntent} from './search-query.js';
import {toolRisk} from './tool-tiers.js';

export const SELF_CHECK_TARGETS = Object.freeze([
  {type: 'domain', query: 'example.com'},                         // reserved by IANA for examples
  {type: 'ip', query: '8.8.8.8'},                                 // Google Public DNS
  {type: 'email', query: 'user@example.com'},                     // reserved domain
  {type: 'username', query: '@octocat'},                          // GitHub's public test account
  {type: 'cve', query: 'CVE-2021-44228'},                         // Log4Shell
  {type: 'hash', query: '44d88612fea8a8f36de82e1278abb02f'}       // MD5 of the EICAR antivirus test file
]);

const safe = tool => {
  const risk = toolRisk(tool);
  return risk.level === 0 && !risk.flags.length && isPassiveSearchTool(tool)
    && tool.annotations?.readOnlyHint !== false && tool.annotations?.destructiveHint !== true;
};

export function selfCheckPlan(tools) {
  const plan = [];
  const seen = new Set();
  for (const {type, query} of SELF_CHECK_TARGETS) {
    const intent = searchIntent(query);
    const selected = explainSearchPlan({query, intentId: intent.id, preferredNames: intent.tools, tools, maxTools: 6}).selected;
    for (const entry of selected) {
      const tool = entry.tool;
      const key = `${tool.serverId}::${tool.name}`;
      if (seen.has(key) || !safe(tool)) continue;
      seen.add(key);
      plan.push({tool, type, target: query, args: entry.args || argsForSearch(tool, query)});
    }
  }
  return plan;
}

export function summarizeSelfCheck(results) {
  const count = outcome => results.filter(result => result.outcome === outcome).length;
  const working = count('working'), empty = count('empty'), failing = count('failing');
  const parts = [`${results.length} tool${results.length === 1 ? '' : 's'} checked`, `${working} working`];
  if (empty) parts.push(`${empty} returned nothing`);
  if (failing) parts.push(`${failing} failing`);
  return {total: results.length, working, empty, failing, label: parts.join(' · ')};
}
