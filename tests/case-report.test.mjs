import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildCaseReport} from '../scripts/case-report.mjs';
import {CaseStore,handleCaseRequest} from '../scripts/cases.mjs';

const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const record={
  id:'0123456789abcdef',name:'Acme <phishing> | review',createdAt:'2026-11-10T09:00:00.000Z',updatedAt:'2026-11-12T09:00:00.000Z',
  evidence:[
    {id:'aaaaaaaaaaaa',title:'example.com',result:{ip:'93.184.215.14'},time:'2026-11-11T10:00:00.000Z',server:'Open OSINT',savedAt:'2026-11-11T10:01:00.000Z',sha256:sha({ip:'93.184.215.14'})},
    {id:'bbbbbbbbbbbb',title:'<script>alert(1)</script> ``` trick',result:{note:'contains ``` fences and <b>tags</b>'},time:'2026-11-11T11:00:00.000Z',server:'Omega MCP',savedAt:'2026-11-11T11:01:00.000Z',sha256:sha({note:'contains ``` fences and <b>tags</b>'})}
  ],
  searches:[{title:'example.com',time:'2026-11-11T09:59:00.000Z',server:'Open OSINT'}]
};
const now=new Date('2026-11-12T12:00:00Z');

test('the Markdown report lists every finding with source, times and full fingerprint',()=>{
  const md=buildCaseReport(record,{format:'markdown',now});
  assert.match(md,/^# Case report: Acme <phishing> \\\| review$/m);
  assert.match(md,/Generated 2026-11-12T12:00:00\.000Z/);
  assert.match(md,/2 findings · 1 search/);
  for(const item of record.evidence){
    assert.ok(md.includes(item.sha256),'full fingerprint');
    assert.ok(md.includes(item.time)&&md.includes(item.savedAt));
  }
  assert.match(md,/\| 1 \| example\.com \| Open OSINT \|/);
  assert.match(md,/## Search log/);
  assert.match(md,/## Checking a fingerprint/);
});

test('result text cannot break out of its code block or the summary table',()=>{
  const md=buildCaseReport(record,{format:'markdown',now});
  const block=md.split('### 2.')[1];
  const fence=block.match(/^(`{4,})json$/m)?.[1];
  assert.ok(fence,'a fence longer than any backtick run in the result');
  assert.ok(block.includes(`${fence}\n`)&&block.lastIndexOf(fence)>block.indexOf(fence));
  const row=md.split('\n').find(line=>line.startsWith('| 2 |'));
  assert.equal(row.split(' | ').length,5,'the title cannot add table columns');
});

test('the HTML report escapes everything taken from results and is print-ready',()=>{
  const html=buildCaseReport(record,{format:'html',now});
  assert.match(html,/^<!doctype html>/i);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<b>tags</b>'));
  assert.match(html,/@media print/);
  assert.match(html,/:root\{color-scheme:light\}/,'readable in a browser that is in dark mode');
  assert.match(html,/body\{[^}]*background:#fff/);
  assert.ok(html.includes(record.evidence[0].sha256));
  assert.doesNotMatch(html,/<script\b/i,'the report runs no code');
});

test('very large results are shortened in the report and point to the JSON export',()=>{
  const big={...record,evidence:[{...record.evidence[0],result:'z'.repeat(60_000)}]};
  const md=buildCaseReport(big,{format:'markdown',now});
  assert.ok(md.length<40_000);
  assert.match(md,/shortened: the full result is in Export JSON/);
});

test('the report routes download Markdown and HTML files named after the case',async()=>{
  const store=new CaseStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-report-')),'cases'));
  const {id}=await store.create({name:'Acme review'});
  await store.addEvidence(id,{title:'example.com',result:{ok:true}});
  const md=await handleCaseRequest(store,'GET',`/api/cases/${id}/report.md`,async()=>({}));
  assert.equal(md.status,200);
  assert.equal(md.contentType,'text/markdown; charset=utf-8');
  assert.equal(md.filename,'acme-review-report.md');
  assert.match(md.raw,/# Case report: Acme review/);
  const html=await handleCaseRequest(store,'GET',`/api/cases/${id}/report.html`,async()=>({}));
  assert.equal(html.contentType,'text/html; charset=utf-8');
  assert.equal(html.filename,'acme-review-report.html');
  assert.equal(await handleCaseRequest(store,'POST',`/api/cases/${id}/report.md`,async()=>({})),null);
});
