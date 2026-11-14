// Evidence page: cases, saved findings and recent-search history.
// Moved unchanged from app.js; see app.js for the startup and button wiring.
import { browserOnlyNotice, caseSummary, evidenceEmpty, findingCard } from '../evidence-view.js?v=3';
import { escapeHtml } from '../ui.js?v=6';
import { activeCaseId, defaultCaseName, newestFirst } from '../cases-client.js';
import { $, localStore, state, persist, toast, apiGet, api } from './core.js';
import { updateOpenResult } from './results.js';

function renderEvidence() {
  const options = state.cases
    .map(
      item =>
        `<option value="${escapeHtml(item.id)}"${item.id === state.activeCaseId ? ' selected' : ''}${item.damaged ? ' disabled' : ''}>${escapeHtml(item.name)}${item.damaged ? '' : ` (${item.evidenceCount})`}</option>`
    )
    .join('');
  $('#caseSelect').innerHTML = state.cases.length
    ? `<option value="">Choose a case…</option>${options}`
    : '<option value="">No cases yet</option>';
  $('#caseSelect').value = state.activeCaseId || '';
  $('#renameCase').disabled = $('#deleteCase').disabled = $('#exportButton').disabled = !state.activeCase;
  const legacy = state.evidence.length;
  $('#caseImport').hidden = !legacy;
  $('#caseImport').innerHTML = legacy ? browserOnlyNotice(legacy) : '';
  const current = state.activeCase;
  $('#caseSummary').textContent = caseSummary(current);
  $('#evidenceList').innerHTML = !current
    ? evidenceEmpty('no-case')
    : current.evidence.length
      ? newestFirst(current.evidence)
          .map(item => findingCard(item))
          .join('')
      : evidenceEmpty('empty-case');
}
async function loadCases() {
  try {
    state.cases = (await apiGet('/api/cases')).cases;
    state.activeCaseId = activeCaseId(state.cases, state.activeCaseId);
    state.activeCase = state.activeCaseId ? await apiGet(`/api/cases/${state.activeCaseId}`) : null;
  } catch (error) {
    toast(`Could not load cases: ${error.message}`);
  }
  if (state.activeCaseId) localStore.setItem('signaldesk.activeCase', state.activeCaseId);
  else localStore.removeItem('signaldesk.activeCase');
  renderEvidence();
}
async function selectCase(id) {
  state.activeCaseId = id || null;
  await loadCases();
}
async function createCase(suggested) {
  const name = prompt('Name for the new case', suggested || defaultCaseName(''));
  if (name === null || !name.trim()) return null;
  const created = await api('/api/cases', { name });
  await selectCase(created.id);
  return created;
}
function recordHistory(entry) {
  state.history.unshift(entry);
  if (state.activeCaseId)
    api(`/api/cases/${state.activeCaseId}/searches`, { title: entry.title, time: entry.time, server: entry.server })
      .then(() => loadCases())
      .catch(() => {});
}
async function saveLastResultToCase() {
  if (!state.lastResult) return;
  if (!state.activeCase && !(await createCase(defaultCaseName(state.lastResult.title)))) return;
  await api(`/api/cases/${state.activeCaseId}/evidence`, state.lastResult);
  await loadCases();
  toast(`Saved to ${state.activeCase?.name || 'the case'}`);
  $('#resultDialog').close();
}
// One result of a passive search, found by its key, with where it came from. Keys are "<group>:<tool>:<index>".
function passiveItem(results, key) {
  const groups = [
    ...[results?.identity?.best, ...(results?.identity?.others || [])]
      .filter(Boolean)
      .map(e => ({ item: e, title: e.label || e.id })),
    ...[...(results?.news || []), ...(results?.hidden?.news || [])].map(n => ({ item: n, title: n.title })),
    ...[...(results?.records || []), ...(results?.hidden?.records || [])].map(r => ({ item: r, title: r.title })),
    ...(results?.data || []).flatMap(g =>
      [...g.items, ...(g.hidden || [])].map(x => ({
        item: x,
        title: [x.item?.title, x.item?.label, x.item?.name].find(v => typeof v === 'string' && v.trim()) || g.label
      }))
    )
  ];
  const found = groups.find(entry => entry.item.key === key);
  if (!found) return null;
  const tool = key.split(':')[1];
  const label = (results.sources || []).find(source => source.tool === tool)?.label || tool;
  return { ...found, label };
}
// Saves one passive-search result into the open case (or a new one), once: a key already saved, or being saved, does
// nothing.
async function saveResultToCase(key) {
  const last = state.lastResult;
  const results = last?.result?.passive;
  const saved = state.savedResultKeys,
    saving = state.savingResultKeys;
  if (!results || saved.has(key) || saving.has(key)) return;
  const found = passiveItem(results, key);
  if (!found) return;
  saving.add(key);
  try {
    if (!state.activeCase && !(await createCase(defaultCaseName(last.title)))) return;
    await api(`/api/cases/${state.activeCaseId}/evidence`, {
      title: found.title,
      result: found.item,
      server: found.label,
      time: last.time,
      note: `From Passive search: ${results.query}`
    });
    saved.add(key);
    await loadCases();
    toast(`Saved to ${state.activeCase?.name || 'the case'}`);
    // Redraw only while the window still shows this search.
    if (saved === state.savedResultKeys && state.lastResult)
      updateOpenResult(state.lastResult.title, state.lastResult.result);
  } finally {
    saving.delete(key);
  }
}
async function importBrowserEvidence() {
  const items = [...state.evidence];
  if (!items.length) return;
  const created = await api('/api/cases', { name: `Imported from browser — ${new Date().toISOString().slice(0, 10)}` });
  for (const item of [...items].reverse()) await api(`/api/cases/${created.id}/evidence`, item);
  state.evidence = [];
  persist();
  await selectCase(created.id);
  toast(`Imported ${items.length} finding${items.length === 1 ? '' : 's'} into a case on this Mac`);
}

export {
  renderEvidence,
  loadCases,
  selectCase,
  createCase,
  recordHistory,
  saveLastResultToCase,
  saveResultToCase,
  importBrowserEvidence
};
