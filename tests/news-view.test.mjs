import test from 'node:test';
import assert from 'node:assert/strict';
import {relativeTime,newsMetrics,newsCard} from '../public/news-view.js';

// News for non-technical readers: times in words, metrics that explain themselves, and links that say they open a tab.
const now=Date.parse('2026-11-13T12:00:00Z');
const escapeHtml=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const safeExternalUrl=v=>/^https?:/.test(v)?v:'#';

test('times read as words, and unknown times say so',()=>{
  assert.equal(relativeTime('2026-11-13T11:59:30Z',now),'just now');
  assert.equal(relativeTime('2026-11-13T11:59:00Z',now),'1 minute ago');
  assert.equal(relativeTime('2026-11-13T11:15:00Z',now),'45 minutes ago');
  assert.equal(relativeTime('2026-11-13T10:00:00Z',now),'2 hours ago');
  assert.equal(relativeTime('2026-11-12T12:00:00Z',now),'1 day ago');
  assert.equal(relativeTime('2026-11-10T12:00:00Z',now),'3 days ago');
  assert.equal(relativeTime('',now),'Time unknown');
  assert.equal(relativeTime('not a date',now),'Time unknown');
  assert.equal(relativeTime(undefined,now),'Time unknown');
});

test('each metric explains itself',()=>{
  const html=newsMetrics({threatIndex:62,threatLevel:'Elevated',signals:120,highPriority:9,sourcesOnline:40,sourcesTotal:42},120,{escapeHtml});
  assert.match(html,/Signal index[\s\S]*62 · Elevated[\s\S]*IntelMap&#39;s overall activity score/);
  assert.match(html,/40\/42/);
  assert.equal((html.match(/class="news-metric-explain"/g)||[]).length,4);
  const empty=newsMetrics(null,0,{escapeHtml});
  assert.match(empty,/—/);
  assert.match(empty,/Live signals[\s\S]*<b>0<\/b>/);
});

test('a news card gives exact time to screen readers and says the link opens a new tab',()=>{
  const html=newsCard({category:'cyber',timestamp:'2026-11-13T10:00:00Z',title:'<b>X</b>',source:'Reuters',url:'https://e.com/a'},{escapeHtml,safeExternalUrl,now});
  assert.match(html,/<time datetime="2026-11-13T10:00:00.000Z">2 hours ago<span class="visually-hidden"> \(/);
  assert.match(html,/Open source<span aria-hidden="true"> ↗<\/span><span class="visually-hidden"> \(opens in a new tab\)<\/span>/);
  assert.match(html,/target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html,/<b>X<\/b>/);
  assert.match(html,/class="ui-badge/);
  assert.match(html,/<article class="news-card" tabindex="-1">/);
  const unknown=newsCard({title:'t'},{escapeHtml,safeExternalUrl,now});
  assert.match(unknown,/Time unknown/);
  assert.doesNotMatch(unknown,/datetime=/);
  assert.doesNotMatch(unknown,/Open source/);
});
