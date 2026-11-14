// Startup and button wiring. Each page's code lives in public/app/ (core, news, servers, tools, evidence, results,
// search, deep); this file connects the page's buttons to it and starts the app.
import { normalizeEndpoint, validateServerForm } from './servers-view.js?v=4';
import { caseSummary } from './evidence-view.js?v=3';
import { deepEvidenceRecord } from './deep-results-view.js?v=2';
import {
  $,
  $$,
  localStore,
  accessHeaders,
  bundledServers,
  removedBundledEndpoints,
  state,
  openDialog,
  confirmAction,
  setupMenu,
  toast,
  switchView,
  api,
  renderAll
} from './app/core.js';
import { formatBytes, clearSelectedFile, analyzeSelectedFile, smartInvestigate } from './app/search.js';
import { intelNews, renderIntelNews, loadIntelNews } from './app/news.js';
import {
  focusSourceCard,
  connect,
  disconnect,
  focusServerCard,
  dataSources,
  loadDataSources,
  openKeyDialog,
  dataSourceAction
} from './app/servers.js';
import {
  allTools,
  renderTools,
  selfCheck,
  runSelfCheck,
  openTool,
  runBlockedReason,
  requestRunGrant,
  runTool
} from './app/tools.js';
import { loadCases, selectCase, createCase, saveLastResultToCase, importBrowserEvidence } from './app/evidence.js';
import {
  loadDeepHistory,
  updateDeepSetup,
  explainDeepLevel,
  startDeepSearch,
  cancelDeepSearch,
  resetDeepSearch,
  deleteDeepRun,
  deleteAllDeepRuns,
  openDeepResults
} from './app/deep.js';
import { showResult } from './app/results.js';

document.addEventListener('click', async event => {
  if (event.target.closest('[data-deep-cancel]')) {
    cancelDeepSearch();
    return;
  }
  if (event.target.closest('[data-deep-new]')) {
    resetDeepSearch();
    return;
  }
  if (event.target.closest('[data-deep-save]')) {
    if (!state.deepCurrent) return;
    state.lastResult = deepEvidenceRecord(state.deepCurrent);
    saveLastResultToCase().catch(error => toast(`Could not save: ${error.message}`));
    return;
  }
  const delRun = event.target.closest('[data-delete-deep-run]');
  if (delRun) {
    deleteDeepRun({ runId: delRun.dataset.deleteDeepRun });
    return;
  }
  const delOld = event.target.closest('[data-delete-deep-time]');
  if (delOld) {
    deleteDeepRun({ time: delOld.dataset.deleteDeepTime, target: delOld.dataset.deleteDeepTarget });
    return;
  }
  const openDeep = event.target.closest('[data-open-deep]');
  if (openDeep) {
    openDeepResults(openDeep.dataset.openDeep).catch(error => toast(`Could not open results: ${error.message}`));
    return;
  }
  const deepTarget = event.target.closest('[data-deep-target]');
  if (deepTarget) {
    switchView('deep');
    resetDeepSearch(deepTarget.dataset.deepTarget);
    return;
  }
  const consensusSignIn = event.target.closest('[data-consensus-sign-in]');
  if (consensusSignIn) {
    try {
      const { authorize } = await api('/api/oauth/consensus/start', {});
      location.assign(authorize);
    } catch (error) {
      toast(`Could not start sign-in: ${error.message}`);
    }
    return;
  }
  const pivot = event.target.closest('[data-pivot]');
  if (pivot) {
    event.preventDefault();
    const target = pivot.dataset.pivot;
    $('#resultDialog').close();
    switchView('workspace');
    $('#query').value = target;
    $('#query').focus();
    try {
      await smartInvestigate(target);
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const nav = event.target.closest('[data-view]');
  if (nav) switchView(nav.dataset.view);
  const link = event.target.closest('[data-view-link]');
  if (link) switchView(link.dataset.viewLink);
  const rerun = event.target.closest('[data-rerun]');
  if (rerun) {
    const query = rerun.dataset.rerun;
    switchView('workspace');
    $('#query').value = query;
    $('#query').focus();
    try {
      await smartInvestigate(query);
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const prompt = event.target.closest('[data-prompt]');
  if (prompt) {
    switchView('workspace');
    $('#query').value = prompt.dataset.prompt;
    $('#query').focus();
  }
  const connectButton = event.target.closest('[data-connect]');
  if (connectButton) {
    const server = state.servers.find(s => s.id === connectButton.dataset.connect);
    if (server) {
      const done = connect(server);
      focusServerCard(server.id);
      done.then(() => focusServerCard(server.id, { onlyIfStranded: true }));
    }
  }
  const disconnectButton = event.target.closest('[data-disconnect]');
  if (disconnectButton) {
    const server = state.servers.find(s => s.id === disconnectButton.dataset.disconnect);
    if (server) disconnect(server).then(() => focusServerCard(server.id, { onlyIfStranded: true }));
  }
  const remove = event.target.closest('[data-remove]');
  if (remove) {
    const server = state.servers.find(s => s.id === remove.dataset.remove);
    if (server && bundledServers.some(item => item.endpoint === server.endpoint))
      removedBundledEndpoints.add(server.endpoint);
    state.servers = state.servers.filter(s => s.id !== remove.dataset.remove);
    renderAll();
    $('#addServer').focus();
  }
  const run = event.target.closest('[data-run]');
  if (run) {
    const [serverId, name] = run.dataset.run.split('::');
    const tool = allTools().find(t => t.serverId === serverId && t.name === name);
    if (tool) openTool(tool, serverId);
  }
  const del = event.target.closest('[data-delete-evidence]');
  if (del && state.activeCaseId) {
    const item = state.activeCase?.evidence.find(entry => entry.id === del.dataset.deleteEvidence);
    if (
      await confirmAction({
        title: 'Remove this finding?',
        message: `"${item?.title || 'This finding'}" will be removed from this case. This can't be undone.`,
        confirmLabel: 'Remove finding'
      })
    )
      api(`/api/cases/${state.activeCaseId}/evidence/${del.dataset.deleteEvidence}/delete`, {})
        .then(loadCases)
        .then(() => $('#caseSummary').focus())
        .catch(error => toast(error.message));
    return;
  }
  const open = event.target.closest('[data-open-finding]');
  if (open) {
    const item = state.activeCase?.evidence.find(entry => entry.id === open.dataset.openFinding);
    if (item) showResult(item.title, item.result, { saved: true });
    return;
  }
  if (event.target.closest('[data-new-case]')) {
    createCase().catch(error => toast(error.message));
    return;
  }
  if (event.target.closest('#importBrowserEvidence'))
    importBrowserEvidence().catch(error => toast(`Import stopped: ${error.message}. Your browser copy was kept.`));
  const tierChip = event.target.closest('[data-tier-filter]');
  if (tierChip) {
    const key = tierChip.dataset.tierFilter;
    state.tierFilter = key;
    renderTools();
    document.querySelector(`[data-tier-filter="${CSS.escape(key)}"]`)?.focus();
  }
  const moreNews = event.target.closest('[data-load-more-news]');
  if (moreNews) {
    const shown = intelNews.visibleLimit;
    intelNews.visibleLimit += 30;
    renderIntelNews();
    document.querySelectorAll('#intelNewsList .news-card')[shown]?.focus();
  }
  const sourceEdit = event.target.closest('[data-source-edit]');
  if (sourceEdit) {
    const source = dataSources.list.find(s => s.id === sourceEdit.dataset.sourceEdit);
    if (source) openKeyDialog(source);
  }
  const sourceConnect = event.target.closest('[data-source-connect]');
  if (sourceConnect) dataSourceAction('connect', sourceConnect.dataset.sourceConnect);
  const sourceDisconnect = event.target.closest('[data-source-disconnect]');
  if (sourceDisconnect) dataSourceAction('disconnect', sourceDisconnect.dataset.sourceDisconnect);
  const sourceRemove = event.target.closest('[data-source-remove]');
  if (sourceRemove) {
    const source = dataSources.list.find(s => s.id === sourceRemove.dataset.sourceRemove);
    if (
      source &&
      (await confirmAction({
        title: 'Remove this key?',
        message: `The saved key for ${source.name} will be removed from this Mac. You'll need to paste it again to reconnect.`,
        confirmLabel: 'Remove key'
      }))
    )
      dataSourceAction('remove', source.id).then(() => focusSourceCard(source.id));
  }
});

$('#investigateForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#query').value.trim();
  if (!q && !state.pendingFile) return;
  try {
    if (state.pendingFile) await analyzeSelectedFile(state.pendingFile, q);
    else await smartInvestigate(q);
  } catch (error) {
    toast(error.message);
  }
});
$('#fileInput').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  state.pendingFile = file;
  $('#fileName').textContent = file.name;
  $('#fileDetails').textContent = `${file.type || 'Unknown type'} · ${formatBytes(file.size)}`;
  $('#fileIcon').textContent = file.type.startsWith('image/') ? '▧' : file.type.startsWith('video/') ? '▶' : '◇';
  $('#fileSelection').hidden = false;
});
$('#removeFile').onclick = clearSelectedFile;
$('#addServer').onclick = () => openDialog($('#serverDialog'), $('#addServer'));
$('#newInvestigation').onclick = () => {
  switchView('workspace');
  $('#query').focus();
};
$('#cmdButton').onclick = () => {
  switchView('workspace');
  $('#query').focus();
};
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    switchView('workspace');
    $('#query').focus();
  }
});
// Add MCP server: a mistake is shown next to its field, the field is marked invalid and focused, and nothing is saved.
function clearServerFormErrors() {
  for (const id of ['serverName', 'serverEndpoint']) {
    $(`#${id}-error`).textContent = '';
    $(`#${id}`).removeAttribute('aria-invalid');
  }
  $('#serverFormStatus').textContent = '';
}
// Enter inside the field with the mistake submits while focus is already there, so moving focus cannot read the error.
// The status line says it then; it is emptied first so the same message is read again on a second try.
function announceServerProblem(message) {
  const status = $('#serverFormStatus');
  status.textContent = '';
  setTimeout(() => {
    status.textContent = message;
  }, 50);
}
$('#serverForm').addEventListener('input', clearServerFormErrors);
$('#addServer').addEventListener('click', clearServerFormErrors);
$('#saveServer').addEventListener('click', e => {
  e.preventDefault();
  const form = new FormData($('#serverForm'));
  const server = {
    id: crypto.randomUUID(),
    name: form.get('name').trim(),
    endpoint: normalizeEndpoint(form.get('endpoint')),
    status: 'offline',
    tools: []
  };
  clearServerFormErrors();
  const problem = validateServerForm(server);
  if (problem) {
    const field = $(`#${problem.field}`);
    $(`#${problem.field}-error`).textContent = problem.message;
    field.setAttribute('aria-invalid', 'true');
    if (document.activeElement === field) announceServerProblem(problem.message);
    else field.focus();
    return;
  }
  removedBundledEndpoints.delete(server.endpoint);
  state.servers.push(server);
  state.tokens.set(server.id, form.get('token'));
  $('#serverDialog').close();
  renderAll();
  connect(server);
});
$('#executeTool').addEventListener('click', async e => {
  e.preventDefault();
  const blocked = runBlockedReason(state.activeTool.tool);
  if (blocked) {
    $('#runError').textContent = blocked;
    return;
  }
  try {
    const args = JSON.parse($('#runArgs').value);
    const grant = await requestRunGrant(state.activeTool.tool, state.activeTool.serverId, args);
    $('#runDialog').close();
    await runTool(state.activeTool.tool, state.activeTool.serverId, args, state.activeTool.tool.name, grant);
  } catch (error) {
    $('#runDialog').open
      ? ($('#runError').textContent = error.message)
      : toast(`${state.activeTool.tool.name} failed: ${error.message}`, 8000);
  }
});
$('#deepTarget').oninput = updateDeepSetup;
$('#deepLevel').onchange = () => {
  explainDeepLevel();
  updateDeepSetup();
};
$('#startDeepSearch').onclick = startDeepSearch;
explainDeepLevel();
updateDeepSetup();
$$('[data-close-result]').forEach(b => (b.onclick = () => $('#resultDialog').close()));
$$('[data-close-dialog]').forEach(button => (button.onclick = () => button.closest('dialog')?.close()));
$('#saveEvidence').onclick = () => saveLastResultToCase().catch(error => toast(`Could not save: ${error.message}`));
$('#caseSelect').onchange = event => selectCase(event.target.value);
const updateFinding = (itemId, changes, message) =>
  api(`/api/cases/${state.activeCaseId}/evidence/${itemId}/update`, changes)
    .then(() => {
      toast(message);
      return loadCases();
    })
    .catch(error => toast(`Could not update: ${error.message}`));
// Status buttons: set the stored value, then put focus back on the same button after the list re-renders.
$('#evidenceList').addEventListener('click', event => {
  const option = event.target.closest('[data-set-status]');
  if (!option || !state.activeCaseId) return;
  const finding = option.dataset.finding,
    status = option.dataset.setStatus;
  updateFinding(finding, { status }, `Marked as "${option.dataset.label}"`).then(() =>
    document.querySelector(`[data-finding="${CSS.escape(finding)}"][data-set-status="${CSS.escape(status)}"]`)?.focus()
  );
});
$('#evidenceList').addEventListener('input', event => {
  const note = event.target.closest('[data-evidence-note]');
  if (note)
    $(`#note-count-${CSS.escape(note.dataset.evidenceNote)}`).textContent = `${note.value.length} of 4000 characters`;
});
$('#evidenceList').addEventListener('click', event => {
  const button = event.target.closest('[data-save-note]');
  if (!button || !state.activeCaseId) return;
  const note = $(`[data-evidence-note="${button.dataset.saveNote}"]`).value;
  updateFinding(button.dataset.saveNote, { note }, 'Note saved');
});
$('#refreshDeepHistory').onclick = () => loadDeepHistory();
$('#deleteAllDeepHistory').onclick = () => deleteAllDeepRuns();
$('#runSelfCheck').onclick = () => runSelfCheck();
$('#stopSelfCheck').onclick = () => {
  selfCheck.stop = true;
  $('#stopSelfCheck').hidden = true;
};
const downloadReport = async extension => {
  if (!state.activeCaseId) return;
  try {
    const response = await fetch(`/api/cases/${state.activeCaseId}/report.${extension}`, { headers: accessHeaders() });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Report download failed');
    }
    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const disposition = response.headers.get('content-disposition') || '';
    a.download = disposition.match(/filename="([^"]+)"/i)?.[1] || `public-desk-report.${extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (error) {
    toast(error.message);
  }
};
setupMenu($('#exportButton'), $('#exportItems'));
$('#reportMarkdown').onclick = () => downloadReport('md');
$('#reportHtml').onclick = () => downloadReport('html');
$('#newCase').onclick = () => createCase().catch(error => toast(error.message));
$('#renameCase').onclick = async () => {
  if (!state.activeCase) return;
  const name = prompt('New name for this case', state.activeCase.name);
  if (name && name.trim())
    await api(`/api/cases/${state.activeCaseId}/rename`, { name })
      .then(loadCases)
      .catch(error => toast(error.message));
};
$('#deleteCase').onclick = async () => {
  const c = state.activeCase;
  if (
    !c ||
    !(await confirmAction({
      title: 'Delete this case?',
      message: `"${c.name}" and its ${c.evidence.length} finding${c.evidence.length === 1 ? '' : 's'} will be deleted from this Mac. This can't be undone.`,
      confirmLabel: 'Delete case'
    }))
  )
    return;
  await api(`/api/cases/${c.id}/delete`, {}).catch(error => toast(error.message));
  state.activeCaseId = null;
  await loadCases();
  $('#caseSelect').focus();
};
$('#clearHistory').onclick = async () => {
  if (
    await confirmAction({
      title: 'Clear recent searches?',
      message: 'Your recent searches will be removed from this browser. Saved cases are not affected.',
      confirmLabel: 'Clear searches'
    })
  ) {
    state.history = [];
    renderAll();
  }
};
$('#toolFilter').oninput = renderTools;
$('#intelNewsFilter').oninput = () => {
  intelNews.visibleLimit = 30;
  renderIntelNews();
};
$('#intelNewsCategory').onchange = () => {
  intelNews.visibleLimit = 30;
  renderIntelNews();
};
$('#refreshIntelNews').onclick = () => loadIntelNews(true);
$('#exportEvidence').onclick = () => {
  const c = state.activeCase;
  if (!c) return;
  const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `public-desk-case-${
    c.name
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || c.id
  }.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
// The switch is a toggle for the dark theme: it says which theme is on, so screen readers announce its state.
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = $('#themeToggle');
  toggle.setAttribute('aria-pressed', String(theme === 'dark'));
  toggle.setAttribute('aria-label', 'Dark theme');
}
$('#themeToggle').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStore.setItem('signaldesk.theme', next);
};
applyTheme(localStore.getItem('signaldesk.theme') || 'light');
if (new URLSearchParams(location.search).get('consensus') === 'connected') {
  history.replaceState({}, '', location.pathname);
  toast('Consensus sign-in complete');
}
$('#saveKey').addEventListener('click', async e => {
  e.preventDefault();
  const id = dataSources.editing;
  if (!id) return;
  const values = Object.fromEntries(
    [...$$('#keyFields input')].map(input => [input.name, input.value.trim()]).filter(([, value]) => value)
  );
  const source = dataSources.list.find(s => s.id === id);
  if (!Object.keys(values).length && source?.status === 'not_configured') {
    $('#keyError').textContent = 'Paste the key first.';
    return;
  }
  if (await dataSourceAction('connect', id, values)) $('#keyDialog').close();
});
// Drop typed keys from the page as soon as the dialog closes, whether saved or cancelled.
$('#keyDialog').addEventListener('close', () => {
  $('#keyFields').innerHTML = '';
  dataSources.editing = null;
});
renderAll();
loadDataSources();
loadCases();
setTimeout(() => state.servers.filter(server => !server.disconnected).forEach(server => connect(server)), 100);
