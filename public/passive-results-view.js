// Draws the grouped answers of a passive search (see passive-results.js) as HTML: who or what it is, news, related data,
// records, and a "Search details" list. Every value is escaped; a link that is not http(s) is shown as plain text.
// Groups are <h3> because the result dialog's title is the <h2>.
import {sortNews} from './passive-results.js';
import {escapeHtml as defaultEscape,safeHttpUrl as defaultSafeUrl} from './ui.js?v=7';

const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const readable=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?String(iso):`${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;};

const WD_ID=/^wd:Q\d+$/;
// Unresolved Wikidata ids ("wd:Q42") mean nothing to a reader. Fold them recursively in displayed records while
// leaving the source answer untouched for evidence storage and fingerprints.
export function foldUnresolvedWikidataIds(value){
  if(typeof value==='string'&&WD_ID.test(value))return undefined;
  if(Array.isArray(value))return value.map(foldUnresolvedWikidataIds).filter(item=>item!==undefined);
  if(value&&typeof value==='object'){
    const out={};
    for(const [key,item] of Object.entries(value)){
      const folded=foldUnresolvedWikidataIds(item);
      if(folded===undefined||Array.isArray(folded)&&!folded.length)continue;
      if(folded&&typeof folded==='object'&&!Array.isArray(folded)&&!Object.keys(folded).length)continue;
      out[key]=folded;
    }
    return out;
  }
  return value;
}
const nameOf=item=>[item?.title,item?.label,item?.name].find(v=>typeof v==='string'&&v.trim())||'';
const sourceItem=item=>item?.item!==undefined?item.item:(()=>{const {key,tier,...source}=item||{};return source;})();

export function renderPassiveResults(results,{sort,savedKeys=new Set(),openKeys=new Set(),escapeHtml=defaultEscape,renderRecord,renderBody}={}){
  const esc=escapeHtml;
  const r=results||{};
  sort=sort||(r.event?'newest':'relevant');
  const save=(key,title)=>savedKeys.has(key)
    ?`<button class="save-result" data-save-result="${esc(key)}" aria-label="Save to case: ${esc(title)}" disabled>Saved</button>`
    :`<button class="save-result" data-save-result="${esc(key)}" aria-label="Save to case: ${esc(title)}">Save to case</button>`;
  const more=(count,body)=>count?`<details class="more-results"><summary>Show ${count} more that don't mention your search</summary>${body}</details>`:'';
  const group=(title,body)=>`<section class="passive-group"><h3>${esc(title)}</h3>${body}</section>`;
  const expanded=(key,summary,item)=>{
    const folded=foldUnresolvedWikidataIds(sourceItem(item));
    const renderer=renderBody||renderRecord||((value)=>esc(JSON.stringify(value)));
    const body=renderer(folded)||'<p class="empty-copy">No additional information reported.</p>';
    return `<details class="passive-result" data-details-key="${esc(key)}"${openKeys.has(key)?' open':''}><summary>${summary}<span class="expand-label">Details</span></summary><div class="passive-result-expanded">${body}</div></details>`;
  };

  const newsRow=n=>`<li class="news-row">${expanded(n.key,`<span class="result-main"><strong>${esc(n.title)}</strong><span class="result-meta">${n.date?`${Number.isNaN(Date.parse(n.date))?esc(n.date):`<time datetime="${esc(n.date)}">${esc(readable(n.date))}</time>`}`:''}${n.source?`<span>${esc(n.source)}</span>`:''}</span>${n.snippet?`<span class="result-snippet">${esc(n.snippet)}</span>`:''}</span>`,n)}${save(n.key,n.title)}</li>`;
  const recordRow=x=>`<li class="record-row">${expanded(x.key,`<span class="result-main"><strong>${esc(x.title)}</strong>${x.detail?`<span class="result-snippet">${esc(x.detail)}</span>`:''}</span>`,x)}${save(x.key,x.title)}</li>`;
  const dataRow=(x,label,n)=>{
    const name=nameOf(x.item);
    const title=name||`Item ${n+1}`;
    return `<li class="data-row">${expanded(x.key,`<span class="result-main"><strong>${esc(title)}</strong></span>`,x)}${save(x.key,name||label)}</li>`;
  };
  const entityBody=e=>{
    const title=e.label||e.id||'Unnamed';
    return `${expanded(e.key,`<span class="result-main"><strong>${esc(title)}</strong>${e.description?`<span class="result-snippet">${esc(e.description)}</span>`:''}</span>`,e)}${save(e.key,title)}`;
  };

  const parts=[];
  const {best,others=[]}=r.identity||{};
  if(best||others.length){
    const bestHtml=best?`<div class="passive-card">${entityBody(best)}</div>`:'';
    const othersHtml=others.length?`<h4>Other people or things with this name</h4><ul class="result-list">${others.map(e=>`<li class="passive-card">${entityBody(e)}</li>`).join('')}</ul>`:'';
    parts.push(group('Who or what this is',bestHtml+othersHtml));
  }
  const hiddenNews=r.hidden?.news||[],hiddenRecords=r.hidden?.records||[];
  if((r.news||[]).length||hiddenNews.length){
    const select=`<label class="news-sort">Sort <select id="newsSort" aria-label="Sort news"><option value="newest"${sort==='relevant'?'':' selected'}>Newest first</option><option value="relevant"${sort==='relevant'?' selected':''}>Most relevant</option></select></label>`;
    const shown=(r.news||[]).length?`<ul class="result-list">${sortNews(r.news,sort).map(newsRow).join('')}</ul>`:'';
    parts.push(group('News',select+shown+more(hiddenNews.length,`<ul class="result-list">${sortNews(hiddenNews,sort).map(newsRow).join('')}</ul>`)));
  }
  const dataGroups=(r.data||[]).filter(g=>g.items.length||(g.hidden||[]).length);
  if(dataGroups.length){
    parts.push(group('Related data',dataGroups.map(g=>`<h4>${esc(g.label)}</h4>${g.items.length?`<ul class="result-list">${g.items.map((x,n)=>dataRow(x,g.label,n)).join('')}</ul>`:''}${more((g.hidden||[]).length,`<ul class="result-list">${g.hidden.map((x,n)=>dataRow(x,g.label,g.items.length+n)).join('')}</ul>`)}`).join('')));
  }
  if((r.records||[]).length||hiddenRecords.length){
    parts.push(group('Records',((r.records||[]).length?`<ul class="result-list">${r.records.map(recordRow).join('')}</ul>`:'')+more(hiddenRecords.length,`<ul class="result-list">${hiddenRecords.map(recordRow).join('')}</ul>`)));
  }

  const STATE={ok:'found results',empty:'nothing found',pending:'still working'};
  const rows=(r.sources||[]).map(x=>`<li>${esc(x.label)}: ${x.state==='failed'?`failed: ${esc(x.error||'the source failed')}`:STATE[x.state]||esc(x.state)}</li>`);
  parts.push(`<details class="search-details"><summary>Search details</summary><ul>${rows.join('')||'<li>No sources were asked.</li>'}</ul></details>`);
  return parts.join('');
}

export function renderPassiveHandOff({label,value}){
  const kind=defaultEscape(label);
  const plural=label.endsWith('s')?`${kind}es`:`${kind}s`;
  return `<div class="passive-handoff"><p>This looks like a ${kind}. Passive search covers people, companies and news; ${plural} are checked in Deep Search.</p><p><strong>${defaultEscape(value)}</strong></p><button class="primary" data-open-deep-search="${defaultEscape(value)}">Open in Deep Search</button></div>`;
}
