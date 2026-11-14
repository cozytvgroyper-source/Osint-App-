import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readAppSource} from './helpers/app-source.mjs';

// The Evidence page: deletions ask in a real dialog that starts on Cancel, the case picker is named by its visible
// label, findings open in the results panel, and statuses are set with labeled buttons.
const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=readAppSource();

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

test('Export is one menu button with three described items',()=>{
  assert.match(html,/id="exportButton" aria-haspopup="menu" aria-expanded="false" aria-controls="exportItems">Export</);
  assert.equal((html.match(/role="menuitem"/g)||[]).length,3);
  for(const id of ['reportMarkdown','reportHtml','exportEvidence'])assert.match(html,new RegExp(`role="menuitem" tabindex="-1" id="${id}"`));
});

test('the menu works from the keyboard',()=>{
  const fn=app.match(/function setupMenu\(button,menu\)\{[\s\S]*?\n\}/)[0];
  for(const key of ['ArrowDown','ArrowUp','Home','End','Escape','Tab'])assert.match(fn,new RegExp(`'${key}'`),key);
  assert.match(fn,/aria-expanded/);
  assert.match(app,/\$\('#exportButton'\)\.disabled=/);
  assert.match(app,/setupMenu\(\$\('#exportButton'\),\$\('#exportItems'\)\)/);
});

// The old two-column card grid squeezed the status buttons into a narrow column; the new card reads top to bottom.
test('finding cards are a single column with statuses in a row',()=>{
  const ui=read('ui.css');
  assert.match(ui,/\.evidence-list \.evidence-card\{display:block\}/);
  assert.match(ui,/\.status-group\{display:flex;flex-wrap:wrap/);
});

// Final review fixes.
test('an opened finding is shown as saved, with no Save button',()=>{
  assert.match(app,/function showResult\(title,result,\{saved=false\}=\{\}\)\{/);
  assert.match(app,/\$\('#saveEvidence'\)\.hidden=saved;/);
  assert.match(app,/data-open-finding[\s\S]{0,250}showResult\(item\.title,item\.result,\{saved:true\}\)/);
});
test('focus lands somewhere sensible after a confirmed delete',()=>{
  assert.match(html,/<p id="caseSummary" class="subtle" tabindex="-1">/);
  assert.match(app,/Remove this finding\?[\s\S]{0,500}\.then\(\(\)=>\$\('#caseSummary'\)\.focus\(\)\)/);
  assert.match(app,/Delete this case\?[\s\S]{0,500}\$\('#caseSelect'\)\.focus\(\)/);
  assert.match(app,/Remove this key\?[\s\S]{0,400}data-source-edit="\$\{CSS\.escape\(source\.id\)\}"\]'?\)?\??\.focus\(\)|Remove this key\?[\s\S]{0,400}focusSourceCard\(/);
});
test('the status toast names the status in words',()=>{
  assert.match(app,/`Marked as "\$\{option\.dataset\.label\}"`/);
});
