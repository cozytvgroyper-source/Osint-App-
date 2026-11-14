// Deep Search page: setup, progress, results and run history.
// Moved unchanged from app.js; see app.js for the startup and button wiring.
import { escapeHtml } from '../ui.js?v=6';
import { TIERS } from '../tool-tiers.js?v=1';
import { deepRunBlocked, deepToolsFor, detectDeepTarget, isPersonType } from '../deep-search.js?v=5';
import { runDeepSearch as runDeepEngine } from '../deep-engine.js?v=2';
import { deepStatusLine, initialProgress, reduceProgress, renderProgress } from '../deep-progress.js?v=1';
import { renderDeepResults } from '../deep-results-view.js?v=2';
import { adaptToolResult } from '../deep-adapters.js?v=2';
import { linkFindings } from '../deep-linking.js?v=2';
import { $, $$, state, confirmAction, toast, switchView, apiGet, api } from './core.js';
import { allTools, callTool } from './tools.js';
import { humanize } from './results.js';

async function loadDeepHistory() {
  const box = $('#deepHistory');
  try {
    const { entries, total, skipped } = await apiGet('/api/deep-search/audit');
    const levelName = level => TIERS[level]?.label || `Level ${level}`;
    const seen = new Set();
    const runs = entries.filter(entry => {
      const key = entry.runId || `${entry.time}:${entry.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Deleting is switched off while a search runs, so the running search can't delete its own results mid-write.
    const busy = Boolean(state.deepRun);
    const deleteButton = entry =>
      entry.runId
        ? `<button type="button" class="text-button" data-delete-deep-run="${escapeHtml(entry.runId)}" aria-label="Delete search: ${escapeHtml(entry.target)}"${busy ? ' disabled' : ''}>Delete</button>`
        : `<button type="button" class="text-button" data-delete-deep-time="${escapeHtml(entry.time)}" data-delete-deep-target="${escapeHtml(entry.target)}" aria-label="Delete search: ${escapeHtml(entry.target)}"${busy ? ' disabled' : ''}>Delete</button>`;
    // The count is exact only when the whole log was read; otherwise Delete all doesn't name a number.
    state.deepHistoryCount = total > entries.length ? null : runs.length;
    $('#deleteAllDeepHistory').hidden = !runs.length;
    $('#deleteAllDeepHistory').disabled = busy;
    $('#deepHistoryBusy').hidden = !busy;
    box.innerHTML = runs.length
      ? `<div class="table-scroll" role="region" tabindex="0" aria-label="Run history table"><table class="deep-history-table"><thead><tr><th scope="col">When</th><th scope="col">Target</th><th scope="col">Max level</th><th scope="col">Tools</th><th scope="col">Outcome</th><th scope="col">Results</th></tr></thead><tbody>${runs.map(entry => `<tr><td>${escapeHtml(new Date(entry.time).toLocaleString())}</td><td><code>${escapeHtml(entry.target)}</code></td><td>${escapeHtml(levelName(entry.level))}</td><td title="${escapeHtml((entry.tools || []).join(', '))}">${entry.toolCount ?? (entry.tools || []).length} tool${(entry.toolCount ?? (entry.tools || []).length) === 1 ? '' : 's'}</td><td>${escapeHtml(entry.outcome)}</td><td>${entry.runId ? `<button type="button" class="text-button" data-open-deep="${escapeHtml(entry.runId)}"${busy ? ' disabled' : ''}>Open results</button>` : "Results weren't kept for this run"} ${deleteButton(entry)}</td></tr>`).join('')}</tbody></table></div>${total > runs.length ? `<p class="subtle">Showing the latest ${runs.length} of ${total} audit entries.</p>` : ''}${skipped ? `<p class="subtle">${skipped} damaged line${skipped === 1 ? ' was' : 's were'} skipped in the audit log.</p>` : ''}`
      : '<div class="empty-state">No Deep Search runs yet.</div>';
  } catch (error) {
    $('#deleteAllDeepHistory').hidden = true;
    box.innerHTML = `<div class="empty-state">Could not read the audit log: ${escapeHtml(error.message)}</div>`;
  }
}
function deepCandidateTypes(target) {
  return isPersonType(target?.type) ? ['email', 'username', 'phone', 'domain'] : [target?.type].filter(Boolean);
}

function deepChoices(target, level) {
  return deepCandidateTypes(target)
    .map(type => {
      const choiceLevel = isPersonType(target?.type) && type === 'domain' ? 1 : level;
      return { type, items: deepToolsFor(allTools(), { type, level: choiceLevel }) };
    })
    .filter(group => group.items.length);
}

function selectedDeepTools() {
  return $$('[data-deep-exclude]:checked').map(input => input.dataset.deepExclude);
}

function renderDeepChoices(target, level) {
  const groups = target ? deepChoices(target, level) : [];
  $('#deepTools').innerHTML = groups.length
    ? groups
        .map(
          group =>
            `<section class="deep-tool-group"><h3>${escapeHtml(humanize(group.type))}</h3>${group.items
              .map(item => {
                const key = `${item.tool.serverName}::${item.tool.name}`;
                return `<label class="deep-tool"><input type="checkbox" data-deep-exclude="${escapeHtml(key)}" checked /><span><b>${escapeHtml(item.tool.name)}</b><small>${escapeHtml(item.tool.serverName)} · ${escapeHtml(item.risk.label)}</small></span></label>`;
              })
              .join('')}</section>`
        )
        .join('')
    : '<p class="subtle">No connected, reviewed tools fit this target yet.</p>';
  return groups.flatMap(group => group.items);
}

function updateDeepSetup() {
  if (state.deepRun) return;
  const input = $('#deepTarget')?.value || '';
  const status = deepStatusLine(input);
  const target = detectDeepTarget(input);
  const person = isPersonType(target?.type);
  const deepStatus = $('#deepStatus');
  if (!deepStatus) return;
  if (status.kind === 'unsupported') {
    if (deepStatus.dataset.message !== status.message)
      deepStatus.innerHTML = `${escapeHtml(status.message)} <button type="button" class="text-button" data-view-link="workspace">Open Search</button>`;
  } else if (deepStatus.textContent !== status.message) deepStatus.textContent = status.message;
  deepStatus.dataset.message = status.message;
  $('#deepLevelWrap').hidden = !target || person || !['domain', 'ip'].includes(target.type);
  const level = person ? 0 : Number($('#deepLevel').value || 0);
  const available = renderDeepChoices(target, level);
  const needsAuthorization = Boolean(target && !person && ['domain', 'ip'].includes(target.type));
  $('#deepConfirmations').hidden = !needsAuthorization;
  $('#deepTypedWrap').hidden = level !== 3;
  $('#deepAuthorize').disabled = !needsAuthorization;
  $('#startDeepSearch').disabled = !target || !available.length;
  $('#deepError').textContent = '';
}

const explainDeepLevel = () => {
  $('#deepLevelExplain').textContent =
    `${TIERS[Number($('#deepLevel').value)].label}: ${TIERS[Number($('#deepLevel').value)].targetSees}`;
};
let deepRenderQueued = false,
  deepLastRender = 0,
  deepRenderTimer = 0;
function renderDeepProgressSoon(force = false) {
  const draw = () => {
    deepRenderQueued = false;
    deepLastRender = performance.now();
    if (state.deepProgress) $('#deepProgress').innerHTML = renderProgress(state.deepProgress);
  };
  if (force) {
    clearTimeout(deepRenderTimer);
    deepRenderQueued = false;
    draw();
    return;
  }
  if (deepRenderQueued) return;
  deepRenderQueued = true;
  const wait = Math.max(0, 250 - (performance.now() - deepLastRender));
  deepRenderTimer = setTimeout(() => requestAnimationFrame(draw), wait);
}

const warnDeepUnload = event => {
  event.preventDefault();
  event.returnValue = '';
};

async function startDeepSearch() {
  if (state.deepRun) {
    switchView('deep');
    $('#deepProgress').hidden = false;
    requestAnimationFrame(() => document.getElementById('deepProgressHeading')?.focus());
    return;
  }
  const target = detectDeepTarget($('#deepTarget').value);
  const person = isPersonType(target?.type);
  const level = person ? 0 : Number($('#deepLevel').value || 0);
  const choices = deepChoices(target, level).flatMap(group => group.items);
  const selectedKeys = new Set(selectedDeepTools());
  const excluded = new Set(
    choices.map(item => `${item.tool.serverName}::${item.tool.name}`).filter(key => !selectedKeys.has(key))
  );
  const confirmation = {
    acknowledged: true,
    authorization: $('#deepAuthorize').checked,
    typedTarget: $('#deepTypedTarget').value.trim()
  };
  const blocked = deepRunBlocked({
    target,
    level,
    authorization: confirmation.authorization,
    typedTarget: confirmation.typedTarget,
    person,
    selectedCount: choices.length - excluded.size
  });
  if (blocked) {
    $('#deepError').textContent = blocked;
    return;
  }
  const id = crypto.randomUUID(),
    controller = new AbortController(),
    toolNames = choices
      .filter(item => !excluded.has(`${item.tool.serverName}::${item.tool.name}`))
      .map(item => item.tool.name);
  state.deepRun = { id, target, level };
  state.deepController = controller;
  state.deepProgress = initialProgress(target, level);
  state.deepCurrent = null;
  $('#deepSetup').hidden = true;
  $('#deepResults').hidden = true;
  $('#deepProgress').hidden = false;
  renderDeepProgressSoon(true);
  document.getElementById('deepProgressHeading')?.focus();
  window.addEventListener('beforeunload', warnDeepUnload);
  loadDeepHistory();
  const grantTargets = new Map();
  let run;
  await api('/api/deep-search/audit', {
    target: target.value,
    level,
    tools: toolNames,
    toolCount: toolNames.length,
    runId: id,
    outcome: 'started'
  }).catch(error => toast(`Audit log warning: ${error.message}`));
  try {
    run = await runDeepEngine({
      id,
      target,
      level,
      tools: allTools(),
      excluded,
      confirmation,
      signal: controller.signal,
      callTool: async (tool, args, options) =>
        callTool(
          tool,
          tool.serverId,
          args,
          options.grant ? { token: options.grant, target: grantTargets.get(options.grant) || target.value } : null,
          options
        ),
      requestGrant: async request => {
        const tools = request.tools.map(item => {
          const server = state.servers.find(entry => entry.id === item.tool.serverId);
          return { endpoint: server.endpoint, name: item.tool.name, arguments: item.args };
        });
        const grant = await api('/api/run-grants', {
          purpose: 'deep-search',
          target: request.target,
          level: request.level,
          runId: request.runId,
          ttlMs: request.ttlMs,
          tools,
          confirmation: request.confirmation
        });
        grantTargets.set(grant.token, request.target);
        return grant;
      },
      releaseGrants: runId => api('/api/run-grants/release', { runId }).catch(() => ({ released: 0 })),
      onEvent: event => {
        if (event.type === 'tool-start' && person && event.identifier?.type === 'domain')
          state.deepProgress = reduceProgress(state.deepProgress, {
            type: 'stage',
            stage: 'sites',
            round: state.deepProgress.round
          });
        state.deepProgress = reduceProgress(state.deepProgress, event);
        renderDeepProgressSoon(event.type === 'done');
      }
    });
  } catch (error) {
    const now = new Date().toISOString();
    run = {
      id,
      target,
      level,
      startedAt: now,
      finishedAt: now,
      outcome: controller.signal.aborted ? 'stopped' : 'failed',
      rounds: state.deepProgress?.round || 0,
      calls: [],
      findings: [],
      leadsNotFollowed: [],
      raw: {},
      error: error.message
    };
  } finally {
    await api('/api/deep-search/runs', run).catch(error => toast(`Could not keep these results: ${error.message}`));
    await api('/api/deep-search/audit', {
      target: target.value,
      level,
      tools: toolNames,
      toolCount: toolNames.length,
      runId: id,
      outcome: run.outcome
    }).catch(error => toast(`Audit log warning: ${error.message}`));
    state.deepCurrent = run;
    state.deepRun = null;
    state.deepController = null;
    window.removeEventListener('beforeunload', warnDeepUnload);
    $('#deepProgress').hidden = true;
    $('#deepResults').hidden = false;
    $('#deepResults').innerHTML = renderDeepResults(run);
    document.getElementById('deepResultsHeading')?.focus();
    loadDeepHistory();
  }
}

async function cancelDeepSearch() {
  if (!state.deepController) return;
  // The search may finish while this question is open, and the progress card is redrawn meanwhile, so the button that
  // opened it may be gone: stop only what is still running, then put focus on the heading that is showing.
  if (
    await confirmAction({
      title: 'Stop the search?',
      message: "Stop the search? What's been found so far will be kept.",
      confirmLabel: 'Stop search'
    })
  )
    state.deepController?.abort();
  if (document.activeElement === document.body || !document.activeElement)
    (state.deepRun
      ? document.getElementById('deepProgressHeading')
      : document.getElementById('deepResultsHeading')
    )?.focus();
}

// While a search runs, its progress (and its Stop button) must stay reachable: anything that would replace it shows it.
function showLiveDeepSearch() {
  if (!state.deepRun) return false;
  switchView('deep');
  $('#deepSetup').hidden = true;
  $('#deepResults').hidden = true;
  $('#deepProgress').hidden = false;
  toast('A search is still running. Wait for it to finish, or stop it, first.', 6000);
  document.getElementById('deepProgressHeading')?.focus();
  return true;
}

function resetDeepSearch(value = '') {
  if (showLiveDeepSearch()) return;
  $('#deepSetup').hidden = false;
  $('#deepProgress').hidden = true;
  $('#deepResults').hidden = true;
  $('#deepTarget').value = value;
  $('#deepAuthorize').checked = false;
  $('#deepTypedTarget').value = '';
  updateDeepSetup();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#deepTarget').focus();
}

function rebuildDeepFindings(run) {
  const adapted = [];
  for (const call of run.calls || []) {
    const identifier = call.identifier;
    if (!identifier) continue;
    const key = `${call.serverName}::${call.tool}::${identifier.type}:${identifier.value}`;
    const raw = run.raw?.[key];
    if (!raw) continue;
    try {
      adapted.push(...adaptToolResult({ name: call.tool, serverName: call.serverName }, JSON.parse(raw), identifier));
    } catch {}
  }
  if (!adapted.length) return run;
  const linked = linkFindings(adapted, run.target, {
    searched: (run.calls || []).map(call => call.identifier).filter(Boolean)
  });
  return { ...run, findings: linked.findings };
}

// The status line is written only when its text changes, so screen readers announce each result once.
function setDeepHistoryStatus(text) {
  const box = $('#deepHistoryStatus');
  if (box.textContent !== text) box.textContent = text;
}

// After a delete the removed button can't keep focus, so focus moves to the Run history heading. Results on screen
// that belonged to a deleted search are closed.
async function afterDeepDelete({ runId = null, all = false }, message) {
  if (state.deepCurrent && (all || state.deepCurrent.id === runId)) {
    state.deepCurrent = null;
    $('#deepResults').hidden = true;
    $('#deepResults').innerHTML = '';
    $('#deepSetup').hidden = false;
  }
  await loadDeepHistory();
  setDeepHistoryStatus(message);
  $('#deepHistoryHeading').focus();
}

async function deleteDeepRun({ runId, time, target }) {
  if (state.deepRun) return;
  if (
    !(await confirmAction({
      title: 'Delete this search?',
      message: "Its results and its history entry will be removed for good. This can't be undone.",
      confirmLabel: 'Delete'
    }))
  )
    return;
  if (state.deepRun) return;
  setDeepHistoryStatus(''); // cleared first, so a second delete in a row is announced too
  try {
    if (runId) await api(`/api/deep-search/runs/${encodeURIComponent(runId)}/delete`, {});
    else await api('/api/deep-search/history/delete', { time, target });
    await afterDeepDelete({ runId: runId || null }, 'Search deleted.');
  } catch (error) {
    toast(`Could not delete: ${error.message}`);
  }
}

async function deleteAllDeepRuns() {
  if (state.deepRun) return;
  const count = state.deepHistoryCount;
  if (
    !(await confirmAction({
      title: count === 1 ? 'Delete this search?' : count ? `Delete all ${count} searches?` : 'Delete all searches?',
      message: "Every search's results and history entry will be removed for good. This can't be undone.",
      confirmLabel: 'Delete all'
    }))
  )
    return;
  if (state.deepRun) return;
  setDeepHistoryStatus('');
  try {
    await api('/api/deep-search/history/delete-all', {});
    await afterDeepDelete({ all: true }, 'All searches deleted.');
  } catch (error) {
    toast(`Could not delete: ${error.message}`);
  }
}

async function openDeepResults(runId) {
  if (showLiveDeepSearch()) return;
  const stored = await apiGet(`/api/deep-search/runs/${encodeURIComponent(runId)}`);
  const run = rebuildDeepFindings(stored);
  state.deepCurrent = run;
  switchView('deep');
  $('#deepSetup').hidden = true;
  $('#deepProgress').hidden = true;
  $('#deepResults').hidden = false;
  $('#deepResults').innerHTML = renderDeepResults(run);
  document.getElementById('deepResultsHeading')?.focus();
}

export {
  loadDeepHistory,
  deepCandidateTypes,
  deepChoices,
  selectedDeepTools,
  renderDeepChoices,
  updateDeepSetup,
  explainDeepLevel,
  deepRenderQueued,
  deepLastRender,
  deepRenderTimer,
  renderDeepProgressSoon,
  warnDeepUnload,
  startDeepSearch,
  cancelDeepSearch,
  showLiveDeepSearch,
  resetDeepSearch,
  rebuildDeepFindings,
  setDeepHistoryStatus,
  afterDeepDelete,
  deleteDeepRun,
  deleteAllDeepRuns,
  openDeepResults
};
