// Search page: planning and running a search, and uploaded files.
// Moved unchanged from app.js; see app.js for the startup and button wiring.
import { emptyState, escapeHtml } from '../ui.js?v=6';
import { classifyToolResult, hasUsefulData, parseToolResult } from '../result-classifier.js';
import { passiveQuery, passiveSources, addCompanySources } from '../passive-search.js';
import { buildPassiveResults } from '../passive-results.js';
import { $, state, toast, iconFor, api, renderAll } from './core.js';
import { noteToolHealth } from './servers.js';
import { allTools, callTool } from './tools.js';
import { recordHistory } from './evidence.js';
import { showResult, updateOpenResult } from './results.js';

let latestSearchId = 0;
// Recent searches: a main search (it has a source log) can be run again; file analyses and single tool runs cannot,
// since rerunning their title as a text search would do something else.
function renderRecentSearches() {
  const items = state.history.slice(0, 5).map(item => {
    const body = `<span class="mini-icon" aria-hidden="true">${iconFor(item.title)}</span><span class="history-text"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.server || 'Local workspace')}</small></span><time datetime="${escapeHtml(item.time || '')}">${new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>`;
    return Array.isArray(item.sourceLog)
      ? `<button type="button" class="history-item" data-rerun="${escapeHtml(item.title)}"><span class="visually-hidden">Search again: </span>${body}</button>`
      : `<div class="history-item">${body}</div>`;
  });
  $('#history').innerHTML = items.length
    ? items.join('')
    : emptyState({ title: 'No searches yet', text: 'Your searches will appear here so you can run them again.' });
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected file'));
    reader.readAsDataURL(file);
  });
}
function clearSelectedFile() {
  state.pendingFile = null;
  $('#fileInput').value = '';
  $('#fileSelection').hidden = true;
  $('#fileName').textContent = '';
  $('#fileDetails').textContent = '';
}

async function analyzeSelectedFile(file, note = '') {
  if (file.size > 50_000_000) throw new Error('Files must be 50 MB or smaller');
  const tool = allTools().find(candidate => candidate.name === 'exiftool_metadata');
  if (!tool) throw new Error('Connect OSINT Toolbox to analyze files, pictures, and videos');
  toast(`Analyzing ${file.name} locally…`);
  const upload = await api('/api/upload', {
    name: file.name,
    type: file.type,
    size: file.size,
    data: await fileAsDataUrl(file)
  });
  try {
    const response = await callTool(tool, tool.serverId, { file_path: upload.path });
    if (response.error) throw new Error(response.error.message || 'File analysis failed');
    const parsed = parseToolResult(response.result);
    const metadata = parsed?.data ?? parsed;
    const kind = file.type.startsWith('image/') ? 'Image' : file.type.startsWith('video/') ? 'Video' : 'Document';
    const report = {
      'File Overview': {
        eyebrow: 'LOCAL FILE',
        description: 'Basic details for the selected file.',
        data: {
          name: file.name,
          type: file.type || 'Unknown',
          category: kind,
          size: formatBytes(file.size),
          investigationNote: note || 'Not provided'
        }
      },
      'Technical Metadata': {
        eyebrow: `${tool.serverName} · ExifTool`,
        description:
          'Embedded metadata, media properties, timestamps, software, camera, codec, and location fields reported by ExifTool.',
        data: metadata
      }
    };
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            description: `Local ${kind.toLowerCase()} analysis for “${file.name}”`,
            data: {
              query: note || file.name,
              modulesQueried: 1,
              modulesWithResults: hasUsefulData(metadata) ? 1 : 0,
              report,
              errors: []
            }
          })
        }
      ]
    };
    const time = new Date().toISOString();
    state.lastResult = { title: file.name, result, time, server: tool.serverName };
    recordHistory({ title: file.name, time, server: `${tool.serverName} · Local file` });
    renderAll();
    showResult(file.name, result);
    clearSelectedFile();
  } finally {
    await api('/api/upload/delete', { id: upload.id }).catch(() => {});
  }
}

// Passive search: a website, IP address, username and the like is handed to Deep Search and nothing runs; a name,
// company or event asks the passive sources and shows their answers grouped, redrawn as each one answers. A newer
// search makes this one's late answers stale.
async function smartInvestigate(query) {
  const searchId = ++latestSearchId;
  state.savedResultKeys = new Set();
  state.savingResultKeys = new Set();
  const info = passiveQuery(query);
  if (info.kind === 'target') {
    showResult(query, { passiveHandOff: { label: info.label, value: info.target.value } });
    return;
  }
  state.newsSort = info.event ? 'newest' : 'relevant';
  const tools = allTools();
  const sources = passiveSources(info, tools);
  if (!sources.length) {
    recordHistory({ title: query, time: new Date().toISOString(), server: 'Demo workspace' });
    renderAll();
    showResult(query, {
      message: 'Connect Open OSINT to run this investigation with live sources.',
      suggested_next_step: 'Open MCP servers and connect http://127.0.0.1:8892/mcp'
    });
    return;
  }
  const outcomes = [];
  const servers = () => [...new Set(sources.map(source => source.tool.serverName))].join(', ');
  const build = () => buildPassiveResults({ query, subject: info.subject, event: info.event, sources, outcomes });
  const record = results => ({
    title: query,
    result: { passive: results },
    time: new Date().toISOString(),
    server: servers()
  });
  // Background answers update the stored result, but never reopen a window the user closed. The initial call below
  // opens it once; every later redraw, including the final one, only refreshes it while it remains open.
  const show = () => {
    if (searchId !== latestSearchId) return null;
    const results = build();
    state.lastResult = record(results);
    updateOpenResult(query, state.lastResult.result);
    return results;
  };
  let companyChecked = false;
  const run = async (source, index) => {
    const tool = source.tool;
    try {
      const response = await callTool(tool, tool.serverId, source.args);
      if (response.error) throw new Error(response.error.message || 'Tool call failed');
      const outcome = classifyToolResult(response.result);
      outcomes[index] = { status: 'fulfilled', value: { tool, outcome } };
      noteToolHealth(tool.serverId, tool.name, outcome.kind);
    } catch (error) {
      outcomes[index] = { status: 'rejected', reason: error };
      noteToolHealth(tool.serverId, tool.name, 'error');
    }
    const results = show();
    // Once Wikidata says the subject is an organisation, company registers and filings are asked too.
    if (results && source.group === 'identity' && !companyChecked) {
      companyChecked = true;
      const extra = addCompanySources(info, tools, results.identity.best);
      if (extra.length) {
        const start = sources.length;
        sources.push(...extra);
        show();
        await Promise.allSettled(extra.map((added, n) => run(added, start + n)));
      }
    }
  };
  state.lastResult = record(build());
  showResult(query, state.lastResult.result);
  await Promise.allSettled(sources.map(run));
  const final = show();
  if (!final) return;
  recordHistory({
    title: query,
    time: state.lastResult.time,
    server: state.lastResult.server,
    sourceLog: final.sources
  });
  renderAll();
}

export {
  latestSearchId,
  renderRecentSearches,
  formatBytes,
  fileAsDataUrl,
  clearSelectedFile,
  analyzeSelectedFile,
  smartInvestigate
};
