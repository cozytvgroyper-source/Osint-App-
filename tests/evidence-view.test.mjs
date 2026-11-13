import test from 'node:test';
import assert from 'node:assert/strict';
import {caseSummary,findingCard,evidenceEmpty,browserOnlyNotice} from '../public/evidence-view.js';

// Evidence for non-technical readers: statuses as labeled toggle buttons (stored values unchanged), a labeled note
// with a character count, Open instead of raw JSON, and empty states that say what to do next.
const escapeHtml=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const item={id:'abcdef123456',title:'<img src=x>"',time:'2026-11-13T10:00:00Z',server:'Open OSINT',status:'ruled out',note:'n'.repeat(4000),sha256:'a'.repeat(64)};

test('the summary counts statuses in plain words',()=>{
  assert.equal(caseSummary({evidence:[{status:'confirmed'},{},{status:'ruled out'},{status:'unverified'}]}),'4 findings: 1 confirmed, 2 not checked yet, 1 ruled out');
  assert.equal(caseSummary({evidence:[{status:'confirmed'}]}),'1 finding: 1 confirmed, 0 not checked yet, 0 ruled out');
  assert.equal(caseSummary(null),'');
});

test('statuses are labeled toggle buttons that keep the stored values',()=>{
  const html=findingCard(item,{escapeHtml});
  assert.match(html,/role="group" aria-label="Status of &lt;img src=x&gt;&quot;"/);
  assert.match(html,/data-set-status="ruled out"[^>]*aria-pressed="true"[^>]*><span aria-hidden="true">✕<\/span>Ruled out/);
  assert.match(html,/data-set-status="unverified"[^>]*aria-pressed="false"[^>]*><span aria-hidden="true">○<\/span>Not checked yet/);
  assert.match(html,/data-set-status="confirmed"[^>]*aria-pressed="false"[^>]*><span aria-hidden="true">✓<\/span>Confirmed/);
  assert.doesNotMatch(html,/<img src=x>/);
  assert.match(findingCard({...item,status:undefined},{escapeHtml}),/data-set-status="unverified"[^>]*aria-pressed="true"/);
});

test('the note has a label, a limit and a live character count',()=>{
  const html=findingCard(item,{escapeHtml});
  assert.match(html,/<label for="note-abcdef123456">Note<\/label>/);
  assert.match(html,/maxlength="4000" aria-describedby="note-count-abcdef123456"/);
  assert.match(html,/id="note-count-abcdef123456" class="note-count">4000 of 4000 characters</);
});

test('findings open in the results panel and explain their fingerprint',()=>{
  const html=findingCard(item,{escapeHtml});
  assert.match(html,/data-open-finding="abcdef123456">Open</);
  assert.match(html,/data-delete-evidence="abcdef123456">Remove</);
  assert.match(html,/Fingerprint \(SHA-256\)<\/b>: Proves this saved result hasn&#39;t changed\./);
  assert.doesNotMatch(html,/<pre>/);
});

test('empty states and the browser-only notice say what to do',()=>{
  assert.match(evidenceEmpty('no-case'),/You don&#39;t have a case yet\.[\s\S]*Save to evidence[\s\S]*data-new-case/);
  assert.match(evidenceEmpty('empty-case'),/This case has no findings yet\./);
  assert.match(browserOnlyNotice(2),/id="importBrowserEvidence"/);
});

test('status buttons carry their plain label for the toast',()=>{
  assert.match(findingCard(item,{escapeHtml}),/data-set-status="unverified"[^>]*data-label="Not checked yet"/);
});
test('the browser-only notice matches its button (a new case)',()=>{
  assert.match(browserOnlyNotice(3),/3 findings are saved only in this browser\. Import them into a new case so they&#39;re kept on this Mac\./);
  assert.match(browserOnlyNotice(1),/1 finding is saved only in this browser\. Import it into a new case so it&#39;s kept on this Mac\./);
});
