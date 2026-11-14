// Shared setup: page helpers, saved settings, the shared state, dialogs, messages, page switching and server calls.
// Moved unchanged from app.js; see app.js for the startup and button wiring.
import { activeCaseId } from '../cases-client.js';
import { loadStoredState, mergeStoredServers, persistStoredState, safeStorage } from '../browser-storage.js';
import { renderRecentSearches } from './search.js';
import { intelNews, loadIntelNews } from './news.js';
import { renderSourcesStatus, renderServers, renderDataSources } from './servers.js';
import { renderTools } from './tools.js';
import { renderEvidence } from './evidence.js';
import { loadDeepHistory, updateDeepSetup } from './deep.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const bootstrapFragment = new URLSearchParams(location.hash.slice(1));
const fragmentAccess = bootstrapFragment.get('access');
const localStore = safeStorage(() => localStorage);
const sessionStore = safeStorage(() => sessionStorage);
if (fragmentAccess) {
  sessionStore.setItem('publicDesk.access', fragmentAccess);
  history.replaceState({}, '', `${location.pathname}${location.search}`);
}
const publicDeskAccess = sessionStore.getItem('publicDesk.access') || '';
const accessHeaders = () => (publicDeskAccess ? { 'x-public-desk-token': publicDeskAccess } : {});
const bundledServers = [
  { id: 'osint-local', name: 'Open OSINT', endpoint: 'http://127.0.0.1:8892/mcp', status: 'offline', tools: [] },
  {
    id: 'osint-toolbox-local',
    name: 'OSINT Toolbox',
    endpoint: 'http://127.0.0.1:8893/mcp',
    status: 'offline',
    tools: []
  },
  {
    id: 'omega-local',
    name: 'Omega MCP',
    endpoint: 'http://127.0.0.1:8894/mcp',
    status: 'offline',
    tools: [],
    caution: 'Use active scanning tools only on systems you own or are authorized to test.'
  },
  {
    id: 'consensus',
    name: 'Consensus',
    endpoint: 'https://mcp.consensus.app/mcp',
    status: 'offline',
    tools: [],
    oauth: 'consensus'
  }
];
// Storage keys keep the original 'signaldesk.' prefix so saved data survives the Public Desk rename.
const storedState = loadStoredState(localStore);
const removedBundledEndpoints = new Set(storedState.disabledBundledEndpoints);
const startupServers = mergeStoredServers(bundledServers, storedState.servers, removedBundledEndpoints);
const state = {
  servers: startupServers,
  tokens: new Map(),
  history: storedState.history,
  evidence: storedState.evidence,
  toolHealth: storedState.toolHealth,
  disabledBundledEndpoints: removedBundledEndpoints,
  activeTool: null,
  lastResult: null,
  pendingFile: null,
  tierFilter: 'all',
  deepRun: null,
  deepProgress: null,
  deepCurrent: null,
  deepController: null,
  cases: [],
  activeCaseId: localStore.getItem('signaldesk.activeCase'),
  activeCase: null
};
const clientSessionId = sessionStore.getItem('signaldesk.clientSessionId') || crypto.randomUUID();
sessionStore.setItem('signaldesk.clientSessionId', clientSessionId);
const sessionKeyFor = serverId => `${clientSessionId}:${serverId}`;
// Development mode: open Public Desk at /?diagnostics to see why the planner chose each tool.
const diagnosticsEnabled = new URLSearchParams(location.search).has('diagnostics');
let pendingStorageWarnings = [...storedState.warnings];
let lastStorageWarning = '';
function persist() {
  const saved = persistStoredState(localStore, state);
  state.evidence = saved.evidence;
  const warning = [...pendingStorageWarnings, ...saved.warnings].at(-1) || '';
  pendingStorageWarnings = [];
  if (warning && warning !== lastStorageWarning) {
    lastStorageWarning = warning;
    queueMicrotask(() => toast(warning));
  }
}

// Opens a modal dialog with focus inside it (the first field, or else its close button) and gives focus back to the
// control that opened it when it closes, so keyboard and screen-reader users keep their place.
function openDialog(dialog, trigger = document.activeElement) {
  dialog.showModal();
  const first =
    dialog.querySelector(
      'input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled])'
    ) || dialog.querySelector('[data-close-dialog],[data-close-result]');
  first?.focus();
  // Only when nothing else took focus meanwhile (a Pivot closes the results and focuses the search box).
  dialog.addEventListener(
    'close',
    () => {
      const stranded = document.activeElement === document.body || dialog.contains(document.activeElement);
      if (stranded && trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus();
    },
    { once: true }
  );
}
// Asks before something that cannot be undone, in a real dialog that starts on Cancel. Resolves true only when the
// user presses the confirm button; Cancel, Escape and the backdrop all resolve false. Text is set as text, never HTML.
function confirmAction({ title, message, confirmLabel }) {
  const dialog = $('#confirmDialog');
  // One question at a time: a second ask while one is open is answered "no" and leaves the open one as it is.
  if (dialog.open) return Promise.resolve(false);
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  dialog.querySelector('[data-confirm="yes"]').textContent = confirmLabel;
  return new Promise(resolve => {
    let answer = false;
    // A click on the backdrop and a click on the dialog's own padding both target the <dialog>; only the backdrop,
    // outside the dialog's box, cancels.
    const outside = event => {
      const box = dialog.getBoundingClientRect();
      return (
        event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
      );
    };
    const choose = event => {
      const button = event.target.closest('[data-confirm]');
      if (button) {
        answer = button.dataset.confirm === 'yes';
        dialog.close();
      } else if (event.target === dialog && outside(event)) dialog.close();
    };
    dialog.addEventListener('click', choose);
    dialog.addEventListener(
      'close',
      () => {
        dialog.removeEventListener('click', choose);
        resolve(answer);
      },
      { once: true }
    );
    openDialog(dialog);
    dialog.querySelector('[data-confirm="no"]').focus();
  });
}
// A menu button (WAI-ARIA menu pattern): Enter, Space or ArrowDown opens it on the first item, ArrowUp on the last;
// arrows move and wrap, Home and End jump, Escape closes and returns focus to the button, Tab or a click outside closes.
function setupMenu(button, menu) {
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
  const open = index => {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const list = items();
    list[(index + list.length) % list.length]?.focus();
  };
  const close = (refocus = true) => {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus();
  };
  button.addEventListener('click', () => {
    if (menu.hidden) open(0);
    else close();
  });
  button.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      open(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      open(-1);
    }
  });
  menu.addEventListener('keydown', event => {
    const list = items(),
      at = list.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      list[(at + 1) % list.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      list[(at - 1 + list.length) % list.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      list[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      list.at(-1).focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close(false);
    }
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('[role="menuitem"]')) close();
  });
  document.addEventListener('click', event => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== button) close(false);
  });
}
function toast(message, ms = 2400) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}
function iconFor(name = '') {
  if (/cyber|cve|threat|domain|ip/i.test(name)) return '⌁';
  if (/geo|satellite|place|flight|vessel/i.test(name)) return '◈';
  if (/sanction|entity|company/i.test(name)) return '◎';
  return '▤';
}

// Each view's name and one plain line on what it is for, shown in the page header and the browser tab.
const PAGES = {
  workspace: {
    title: 'Search',
    intro:
      'Look up a person, company, website, IP address, username or event. Public Desk asks connected sources and shows the best matches first.'
  },
  evidence: {
    title: 'Evidence',
    intro: 'Save findings into cases, mark what you’ve checked, and export a report. Cases are stored on this Mac.'
  },
  news: {
    title: 'News',
    intro: 'Live public events from IntelMap. Always open the original source before relying on a report.'
  },
  servers: {
    title: 'MCP servers',
    intro:
      'MCP servers are the services Public Desk asks when you search. The first four are included; you can add your own.'
  },
  library: {
    title: 'Tool library',
    intro:
      'Every tool your MCP servers offer, grouped by how visible it is to the target. The main search only uses Passive tools.'
  },
  deep: {
    title: 'Deep Search',
    intro:
      'Run stronger checks against one target you own or have written permission to test. Nothing runs until you confirm.'
  }
};

function switchView(id) {
  $$('.view').forEach(v => v.classList.toggle('active-view', v.id === id));
  $$('.nav[data-view]').forEach(v => {
    const current = v.dataset.view === id;
    v.classList.toggle('active', current);
    if (current) v.setAttribute('aria-current', 'page');
    else v.removeAttribute('aria-current');
  });
  const page = PAGES[id] || PAGES.workspace;
  $('#pageTitle').textContent = page.title;
  $('#pageIntro').textContent = page.intro;
  document.title = `${page.title} · Public Desk`;
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  if (id === 'news' && !intelNews.loaded && !intelNews.loading) loadIntelNews();
  if (id === 'deep') loadDeepHistory();
}

async function apiGet(path) {
  const response = await fetch(path, { headers: accessHeaders() });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function api(path, payload, options = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...accessHeaders() },
    body: JSON.stringify(payload),
    signal: options.signal
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function renderAll() {
  renderRecentSearches();
  renderSourcesStatus();
  renderServers();
  renderDataSources();
  renderTools();
  renderEvidence();
  updateDeepSetup();
  persist();
}

export {
  $,
  $$,
  bootstrapFragment,
  fragmentAccess,
  localStore,
  sessionStore,
  publicDeskAccess,
  accessHeaders,
  bundledServers,
  storedState,
  removedBundledEndpoints,
  startupServers,
  state,
  clientSessionId,
  sessionKeyFor,
  diagnosticsEnabled,
  pendingStorageWarnings,
  lastStorageWarning,
  persist,
  openDialog,
  confirmAction,
  setupMenu,
  toast,
  iconFor,
  PAGES,
  switchView,
  apiGet,
  api,
  renderAll
};
