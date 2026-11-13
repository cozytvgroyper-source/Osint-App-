import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const fixture=async name=>JSON.parse(await readFile(new URL(`./fixtures/deep/${name}.json`,import.meta.url),'utf8'));

test('person results show linked facts, grouped accounts, trails, leads and calls',async()=>{
  const {renderPersonResults}=await import('../public/deep-results-view.js');
  const html=renderPersonResults(await fixture('run-person'));
  assert.match(html,/<h2[^>]*>What we know<\/h2>/);
  assert.match(html,/<h2[^>]*>Linked accounts \(1\)<\/h2>/);
  assert.match(html,/<h3[^>]*>Developer<\/h3>/);
  assert.match(html,/<h4[^>]*>GitHub &lt;script&gt;<\/h4>/);
  assert.match(html,/Why linked:/);
  assert.match(html,/omega_gitrecon · Omega MCP/);
  assert.match(html,/<summary>How we found this<\/summary>/);
  assert.match(html,/Found @ownername[\s\S]*Profile shows the email/);
  assert.match(html,/Websites found[\s\S]*data-deep-target="owner-site\.example"/);
  assert.match(html,/More leads we didn&#39;t follow[\s\S]*data-deep-target="owner-alt"/);
  assert.match(html,/<details><summary>Show 1 possible match<\/summary>/);
  assert.match(html,/Same username; nothing else links it/);
  assert.match(html,/<details><summary>Search details<\/summary>[\s\S]*Timed out/);
  assert.match(html,/data-deep-save/);assert.match(html,/data-deep-new/);
  assert.match(html,/Stopped early/);
  assert.doesNotMatch(html,/Run grant/i);
});

test('site results show an overview, ordered problems and other hosts',async()=>{
  const {renderSiteResults}=await import('../public/deep-results-view.js');
  const html=renderSiteResults(await fixture('run-site'));
  assert.match(html,/<h2[^>]*>Overview<\/h2>/);
  assert.match(html,/3 things to fix \(see below\)/);
  assert.match(html,/<details open>[\s\S]*<summary>Subdomains and hosts<\/summary>/);
  assert.match(html,/<details open>[\s\S]*<summary>Related sites<\/summary>/);
  assert.match(html,/Things to fix \(3\)/);
  assert.ok(html.indexOf('Open admin port')<html.indexOf('DMARC is not enforced'));
  assert.ok(html.indexOf('DMARC is not enforced')<html.indexOf('Old header'));
  assert.match(html,/An admin service is public\.[\s\S]*Restrict the service\.[\s\S]*omega_ports · Omega MCP/);
  assert.match(html,/Other hosts found[\s\S]*data-deep-target="api\.owner-site\.example"/);
  assert.match(html,/Example Org &lt;bad&gt;/);
});

test('low-level clean site results explain what higher levels check',async()=>{
  const {renderSiteResults}=await import('../public/deep-results-view.js');
  const run=await fixture('run-site');run.level=1;run.findings=run.findings.filter(item=>item.kind!=='problem');
  assert.match(renderSiteResults(run),/Active and Intrusive levels can check more deeply/);
});

test('both views escape hostile text, label external links, keep possible findings folded and show sources',async()=>{
  const {renderDeepResults}=await import('../public/deep-results-view.js');
  const person=renderDeepResults(await fixture('run-person'));
  const site=renderDeepResults(await fixture('run-site'));
  for(const html of [person,site]){
    assert.doesNotMatch(html,/<(?:bad|script)\b/i);
    assert.doesNotMatch(html,/Run grant/i);
    assert.match(html,/tool|omega|whois|maigret|sherlock/i);
    assert.match(html,/MCP|Toolbox/);
  }
  assert.match(person,/\(opens in a new tab\)/);
  assert.ok(person.indexOf('Same username; nothing else links it')>person.indexOf('<summary>Show 1 possible match</summary>'));
});

test('evidence records exclude raw answers',async()=>{
  const {deepEvidenceRecord}=await import('../public/deep-results-view.js');
  const run=await fixture('run-person');run.raw={secret:'must not be saved'};
  const record=deepEvidenceRecord(run);
  assert.equal(record.server,'Deep Search');
  const saved=JSON.parse(record.result.content[0].text);
  assert.equal(saved.target.value,'owner@example.com');
  assert.equal(saved.raw,undefined);
  assert.ok(saved.findings.every(item=>item.sources?.length));
});
