// News page view: IntelMap events and metrics as HTML strings, DOM-free so it can be tested with node --test.
// Times read as words with the exact time for screen readers; metrics carry a one-line explanation; outside links
// say they open a new tab.
import {badge} from './ui.js?v=5';

const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;

function validDate(value){
  if(value===undefined||value===null||value==='')return null;
  const date=new Date(value);
  return Number.isNaN(date.getTime())?null:date;
}

export function relativeTime(value,now=Date.now()){
  const date=validDate(value);
  if(!date)return 'Time unknown';
  const seconds=Math.max(0,Math.floor((now-date.getTime())/1000));
  if(seconds<60)return 'just now';
  if(seconds<3600)return `${plural(Math.floor(seconds/60),'minute')} ago`;
  if(seconds<86400)return `${plural(Math.floor(seconds/3600),'hour')} ago`;
  return `${plural(Math.floor(seconds/86400),'day')} ago`;
}

const METRICS=[
  ['Signal index',m=>m.threatIndex!=null?`${m.threatIndex} · ${m.threatLevel||'Unknown'}`:'—',"IntelMap's overall activity score"],
  ['Live signals',(m,count)=>m.signals??count,'Events in the current feed'],
  ['High priority',m=>m.highPriority??'—','Events IntelMap rates as most severe'],
  ['Sources online',m=>m.sourcesOnline!=null?`${m.sourcesOnline}/${m.sourcesTotal||m.sourcesOnline}`:'—','Feeds IntelMap could reach just now']
];

export function newsMetrics(metrics,eventCount,{escapeHtml}){
  const m=metrics||{};
  return METRICS.map(([label,value,explain])=>`<article class="news-metric"><span class="news-metric-label">${escapeHtml(label)}</span><b>${escapeHtml(value(m,eventCount))}</b><p class="news-metric-explain">${escapeHtml(explain)}</p></article>`).join('');
}

export function newsCard(event,{escapeHtml,safeExternalUrl,now=Date.now()}){
  const date=validDate(event.timestamp);
  const time=date
    ?`<time datetime="${escapeHtml(date.toISOString())}">${escapeHtml(relativeTime(date,now))}<span class="visually-hidden"> (${escapeHtml(date.toLocaleString())})</span></time>`
    :'<span class="news-time">Time unknown</span>';
  const description=event.description?`<p>${escapeHtml(event.description)}</p>`:'';
  const link=event.url?`<a class="text-button" href="${escapeHtml(safeExternalUrl(event.url))}" target="_blank" rel="noopener noreferrer">Open source<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in a new tab)</span></a>`:'';
  return `<article class="news-card" tabindex="-1"><div class="news-card-top">${badge({text:event.category||event.kind||'signal'})}${time}</div><h3>${escapeHtml(event.title||'Untitled signal')}</h3>${description}<div class="news-meta"><span>${escapeHtml(event.source||'Unknown source')}</span><span>${escapeHtml(event.country||event.region||'Global')}</span><span>Severity ${escapeHtml(event.severity??'—')} · ${escapeHtml(event.confidence??'—')}% confidence</span></div>${link}</article>`;
}
