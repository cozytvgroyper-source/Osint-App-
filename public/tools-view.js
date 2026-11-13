// Tool library view: tier filter chips and tool cards as HTML strings, DOM-free so it can be tested with node --test.
// Chips are toggle buttons that explain each tier; cards say where a tool is used and write out paid or side-effect
// flags. The tier names (Passive, Light touch, Active, Intrusive) stay as they are.
import {badge,escapeHtml} from './ui.js?v=4';

const FLAG_TEXT={credits:'Uses paid AI credits','side-effects':'Has side effects: it may send, store, schedule or change data'};
const TONE={passive:'safe',light:'warn',active:'warn',intrusive:'danger'};

export function tierChips(chips,active){
  return chips.map(({key,label,count,explain})=>`<button type="button" class="tier-chip" data-tier-filter="${escapeHtml(key)}" aria-pressed="${key===active}"><span class="tier-chip-label">${escapeHtml(label)}</span> <span class="tier-chip-count">${escapeHtml(count)}</span><span class="tier-chip-explain">${escapeHtml(explain)}</span></button>`).join('');
}

export function toolCard(tool,{risk,usage}){
  const flags=(risk.flags||[]).map(flag=>`<p class="tool-flag">${escapeHtml(FLAG_TEXT[flag]||flag)}</p>`).join('');
  const run=risk.level>=2?`Run ${risk.label.toLowerCase()} tool`:'Run tool';
  return `<article class="tool-card">`
    +`<div class="tool-card-head"><h3><code>${escapeHtml(tool.name)}</code></h3>${badge({text:risk.label,tone:TONE[risk.key]||'danger'})}</div>`
    +`<p class="tool-meta">${escapeHtml(tool.serverName)} · ${escapeHtml(usage)}${risk.needsReview?' · needs review':''}</p>`
    +flags
    +`<p class="tool-desc" title="${escapeHtml(tool.description||'')}">${escapeHtml(tool.description||'No description provided.')}</p>`
    +`<button class="text-button" data-run="${escapeHtml(tool.serverId)}::${escapeHtml(tool.name)}">${escapeHtml(run)}<span aria-hidden="true"> →</span></button>`
    +`</article>`;
}
