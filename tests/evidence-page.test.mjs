import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The Evidence page: deletions ask in a real dialog that starts on Cancel, the case picker is named by its visible
// label, findings open in the results panel, and statuses are set with labeled buttons.
const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=read('app.js');

test('destructive actions ask in a real dialog, starting on Cancel',()=>{
  assert.match(html,/<dialog id="confirmDialog" aria-labelledby="confirmTitle" aria-describedby="confirmMessage">/);
  const fn=app.match(/function confirmAction\(\{title,message,confirmLabel\}\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn,/\.textContent=/);
  assert.doesNotMatch(fn,/innerHTML/);
  assert.match(fn,/data-confirm="no"[\s\S]*\.focus\(\)/);
  assert.doesNotMatch(app,/\bconfirm\(['`"](?:Delete|Remove)/,'no native confirm() for deletes');
  assert.match(app,/Delete this case\?/);
  assert.match(app,/Remove this finding\?/);
});

test('the case picker is named by its visible label',()=>{
  assert.doesNotMatch(html,/id="caseSelect" aria-label=/);
  assert.match(html,/<label>Case<select id="caseSelect"/);
  assert.match(html,/id="deleteCase">Delete</);
});

test('Evidence uses the view module and opens findings in the results panel',()=>{
  assert.match(app,/from '\.\/evidence-view\.js\?v=\d+'/);
  assert.match(app,/data-open-finding[\s\S]{0,200}showResult\(/);
  assert.match(app,/data-set-status[\s\S]{0,300}updateFinding\(/);
  assert.match(app,/note-count-/);
});
