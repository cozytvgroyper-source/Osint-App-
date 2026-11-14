// Draws the grouped answers of a passive search (see passive-results.js) as HTML: who or what it is, news, related data,
// records, and a "Search details" list. Every value is escaped; a link that is not http(s) is shown as plain text.
// Groups are <h3> because the result dialog's title is the <h2>.
import {sortNews} from './passive-results.js';
import {escapeHtml as defaultEscape,safeHttpUrl as defaultSafeUrl} from './ui.js';

const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const readable=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?String(iso):`${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;};

const WD_ID=/^wd:Q\d+$/;
// Wikidata ids ("wd:Q42") mean nothing to a reader: drop them from facts, and drop a fact left with no value.
function readableFacts(facts){
  const out={};
  for(const [key,value] of Object.entries(facts||{})){
    if(Array.isArray(value)){const kept=value.filter(v=>!(typeof v==='string'&&WD_ID.test(v)));if(kept.length)out[key]=kept;}
    else if(!(typeof value==='string'&&WD_ID.test(value)))out[key]=value;
  }
  return out;
}
const nameOf=item=>[item?.title,item?.label,item?.name].find(v=>typeof v==='string'&&v.trim())||'';

export function renderPassiveResults(results,{sort,savedKeys=new Set(),escapeHtml=defaultEscape,safeHttpUrl=defaultSafeUrl,renderRecord}={}){
  const esc=escapeHtml;
  const r=results||{};
  sort=sort||(r.event?'newest':'relevant');
  const save=(key,title)=>savedKeys.has(key)
    ?`<button class="save-result" data-save-result="${esc(key)}" aria-label="Save to case: ${esc(title)}" disabled>Saved</button>`
    :`<button class="save-result" data-save-result="${esc(key)}" aria-label="Save to case: ${esc(title)}">Save to case</button>`;
  const linked=(title,link)=>{
    const href=link?safeHttpUrl(link):'';
    return href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>`:esc(title);
  };
  const more=(count,body)=>count?`<details class="more-results"><summary>Show ${count} more that don't mention your search</summary>${body}</details>`:'';
  const group=(title,body)=>`<section class="passive-group"><h3>${esc(title)}</h3>${body}</section>`;

  const newsRow=n=>`<li class="news-row"><div class="result-main">${linked(n.title,n.link)}<span class="result-meta">${n.date?`${Number.isNaN(Date.parse(n.date))?esc(n.date):`<time datetime="${esc(n.date)}">${esc(readable(n.date))}</time>`}`:''}${n.source?`<span>${esc(n.source)}</span>`:''}</span>${n.snippet?`<p>${esc(n.snippet)}</p>`:''}</div>${save(n.key,n.title)}</li>`;
  const recordRow=x=>`<li class="record-row"><div class="result-main">${linked(x.title,x.link)}${x.detail?`<p>${esc(x.detail)}</p>`:''}</div>${save(x.key,x.title)}</li>`;
  const dataRow=(x,label,n)=>{
    const name=nameOf(x.item);
    const body=renderRecord(x.item)||esc(name||`Item ${n+1}`);
    return `<li class="data-row"><div class="result-main">${body}</div>${save(x.key,name||label)}</li>`;
  };
  const entityBody=e=>{
    const kept=e.facts&&typeof e.facts==='object'?readableFacts(e.facts):{};
    const facts=Object.keys(kept).length?renderRecord(kept):'';
    return `<div class="result-main"><strong>${linked(e.label||e.id||'Unnamed',e.wikiUrl)}</strong>${e.description?`<p>${esc(e.description)}</p>`:''}${facts}</div>${save(e.key,e.label||e.id||'Unnamed')}`;
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
  return `<div class="passive-handoff"><p>This looks like a ${kind}. Passive search covers people, companies and news; ${kind}s are checked in Deep Search.</p><p><strong>${defaultEscape(value)}</strong></p><button class="primary" data-open-deep-search="${defaultEscape(value)}">Open in Deep Search</button></div>`;
}
