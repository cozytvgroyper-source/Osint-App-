import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Deep Search as three numbered steps. The safety steps (authorization checkbox, typed target at Intrusive, Cancel)
// must all still be there; only the layout and the level explanation are new.
const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=read('app.js');
const deep=html.match(/<section id="deep"[\s\S]*?<div class="deep-history"/)[0];

test('Deep Search reads as three numbered steps',()=>{
  for(const [n,title] of [[1,'1\\. Choose a target and level'],[2,'2\\. Review the plan'],[3,'3\\. Confirm and run']])
    assert.match(deep,new RegExp(`aria-labelledby="deep-step-${n}"[\\s\\S]*?<h2 id="deep-step-${n}">${title}</h2>`));
});

test('the safety steps are still all there',()=>{
  for(const id of ['deepAuthorize','deepTypedWrap','deepTypedTarget','runDeepSearch','cancelDeepRun','deepTarget','deepLevel','buildDeepPlan','deepPlan'])assert.match(deep,new RegExp(`id="${id}"`),id);
  assert.match(app,/\$\('#deepTypedWrap'\)\.hidden=Number\(\$\('#deepLevel'\)\.value\)!==3/);
});

test('the chosen level is explained',()=>{
  assert.match(deep,/id="deepLevelExplain"[^>]*aria-live="polite"/);
  assert.match(app,/#deepLevelExplain[\s\S]{0,120}TIERS\[/);
});

// Step 3 is empty until a plan exists; it must say what to do instead of showing a blank card.
test('step 3 explains itself before there is a plan',()=>{
  assert.match(deep,/<p id="deepConfirmHint" class="field-hint">Build a plan in step 1 first\. Then confirm here and run it\.<\/p>/);
  assert.match(app,/\$\('#deepConfirmHint'\)\.hidden=Boolean\(plan\.length\)/);
});
