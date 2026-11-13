import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The stylesheets keep only rules for classes something still produces; classes built at runtime keep theirs.
const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const exists=file=>fs.existsSync(new URL(`../public/${file}`,import.meta.url));
const sheets=()=>['styles.css','results.css','theme.css','ui.css'].filter(exists).map(read).join('\n');
const DEAD=['hero-copy','status-pill','workflow-grid','workflow-icon','history-empty','connection-name','source-strip','source-pill','deep-hero','tool-flags','case-exports','evidence-review','status-confirmed','status-ruled-out','recommended-badge','result-summary','result-stats','server-workflow'];

test('no stylesheet keeps rules for classes nothing produces',()=>{
  const css=sheets();
  for(const name of DEAD)assert.doesNotMatch(css,new RegExp(`\\.${name}\\b`),name);
  assert.doesNotMatch(css,/\.tier-chip\.active/);
});

test('classes built at runtime keep their rules',()=>{
  const css=sheets();
  for(const name of ['tier-passive','tier-light','tier-active','tier-unreviewed','run-risk-','self-check-','source-outcome-'])assert.match(css,new RegExp(`\\.${name}`),name);
});
