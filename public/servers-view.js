// MCP servers page view: server cards as HTML strings, DOM-free so it can be tested with node --test. Each bundled
// server says what it is for, the state reads as words, and the actions keep the data-* hooks app.js listens for.
import {escapeHtml} from './ui.js?v=4';

export const SERVER_PURPOSES=Object.freeze({
  'http://127.0.0.1:8892/mcp':'Public databases and news feeds; never contacts your target.',
  'http://127.0.0.1:8893/mcp':'Well-known open-source lookup tools.',
  'http://127.0.0.1:8894/mcp':'A large toolkit; some tools contact the target and need confirmation.',
  'https://mcp.consensus.app/mcp':'Search published research papers.'
});

export function serverStatusText(server,toolCountText=''){
  if(server.status==='connected')return toolCountText?`Connected · ${toolCountText}`:'Connected';
  if(server.needsAuth)return 'Needs sign-in';
  if(server.status==='connecting')return 'Connecting…';
  if(server.disconnected)return 'Disconnected';
  if(server.error)return 'Not running';
  return 'Not connected';
}

export function serverCard(server,{bundled=false,toolCountText=''}={}){
  const id=escapeHtml(server.id);
  const purpose=SERVER_PURPOSES[server.endpoint];
  const action=(label,attr,kind='ghost')=>`<button type="button" class="${kind}" ${attr}="${id}">${escapeHtml(label)}</button>`;
  const primary=server.needsAuth
    ?'<button type="button" class="primary" data-consensus-sign-in>Sign in to Consensus</button>'
    :server.status==='connected'
      ?action('Disconnect','data-disconnect')+action('Reconnect','data-connect','primary')
      :action(server.status==='connecting'?'Connecting…':'Connect','data-connect','primary');
  return `<article class="server-card" data-server-card="${id}">`
    +`<div class="server-card-top"><h3>${escapeHtml(server.name)}</h3><span class="server-dot${server.status==='connected'?' connected':''}" aria-hidden="true"></span></div>`
    +(purpose?`<p class="server-purpose">${escapeHtml(purpose)}</p>`:'')
    +`<p class="server-status">${escapeHtml(serverStatusText(server,toolCountText))}</p>`
    +`<p class="endpoint"><span class="visually-hidden">Address: </span>${escapeHtml(server.endpoint)}</p>`
    +(server.caution?`<p class="form-note">${escapeHtml(server.caution)}</p>`:'')
    +`<div class="server-actions">${action(bundled?'Disable':'Remove','data-remove')}${primary}</div>`
    +`</article>`;
}
