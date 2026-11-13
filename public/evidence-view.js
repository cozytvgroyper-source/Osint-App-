// Evidence page view: finding cards, the case summary, empty states and the browser-only notice as HTML strings,
// DOM-free so it can be tested with node --test. Statuses keep their stored values (unverified, confirmed, ruled out);
// only their labels are plain words from the glossary.
import {button,emptyState,escapeHtml,term} from './ui.js?v=5';
import {GLOSSARY} from './glossary.js';
import {shortFingerprint} from './cases-client.js';

const NOTE_LIMIT=4000;
const STATUSES=[['unverified','unverified','○'],['confirmed','confirmed','✓'],['ruled out','ruledOut','✕']];
const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;

export function caseSummary(record){
  if(!record)return '';
  const evidence=record.evidence||[];
  const count=status=>evidence.filter(item=>(item.status||'unverified')===status).length;
  return `${plural(evidence.length,'finding')}: ${count('confirmed')} confirmed, ${count('unverified')} not checked yet, ${count('ruled out')} ruled out`;
}

export function findingCard(item){
  const id=escapeHtml(item.id);
  const current=item.status||'unverified';
  const found=item.time?new Date(item.time).toLocaleString():'';
  const statuses=STATUSES.map(([value,key,icon])=>`<button type="button" class="status-option" data-set-status="${escapeHtml(value)}" data-finding="${id}" data-label="${escapeHtml(GLOSSARY[key].label)}" aria-pressed="${current===value}"><span aria-hidden="true">${icon}</span>${escapeHtml(GLOSSARY[key].label)}</button>`).join('');
  const note=String(item.note||'');
  return `<article class="evidence-card">`
    +`<h3>${escapeHtml(item.title)}</h3>`
    +`<p class="evidence-meta">${escapeHtml(found)}${item.server?` · ${escapeHtml(item.server)}`:''}</p>`
    +`<div role="group" aria-label="Status of ${escapeHtml(item.title)}" class="status-group">${statuses}</div>`
    +`<div class="evidence-note"><label for="note-${id}">Note</label><textarea id="note-${id}" data-evidence-note="${id}" maxlength="${NOTE_LIMIT}" aria-describedby="note-count-${id}" rows="2" placeholder="Why you trust or doubt this finding">${escapeHtml(note)}</textarea>`
    +`<p id="note-count-${id}" class="note-count">${note.length} of ${NOTE_LIMIT} characters</p>${button({label:'Save note',attrs:{'data-save-note':item.id}})}</div>`
    +`<div class="card-actions">${button({label:'Open',kind:'quiet',attrs:{'data-open-finding':item.id}})}${button({label:'Remove',kind:'quiet',attrs:{'data-delete-evidence':item.id}})}</div>`
    +`<p class="fingerprint">${term('fingerprint',{visible:true})} <code>${escapeHtml(shortFingerprint(item.sha256))}</code></p>`
    +`</article>`;
}

export function evidenceEmpty(kind){
  if(kind==='no-case')return emptyState({title:"You don't have a case yet.",text:"Create one, then use 'Save to evidence' on any search result.",action:button({label:'New case',kind:'primary',attrs:{'data-new-case':true}})});
  return emptyState({title:'This case has no findings yet.',text:'Run a search and save results here.'});
}

export function browserOnlyNotice(count){
  const one=count===1;
  const text=`${plural(count,'finding')} ${one?'is':'are'} saved only in this browser. Import ${one?'it':'them'} into a new case so ${one?"it's":"they're"} kept on this Mac.`;
  return `<p>${escapeHtml(text)}</p><button class="primary" id="importBrowserEvidence">Import into a new case</button>`;
}
