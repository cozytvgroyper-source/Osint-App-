import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// MCP servers page wiring: cards come from servers-view.js, and focus is never lost when a card changes or goes.
const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=read('app.js');

test('server cards come from the view module, and focus follows card changes',()=>{
  assert.match(app,/from '\.\/servers-view\.js\?v=\d+'/);
  assert.match(app,/function focusServerCard\(id[^)]*\)\{[\s\S]{0,400}data-server-card[\s\S]{0,400}serverFocusTarget\(card\)\?\.focus\(\)/);
  assert.match(app,/data-disconnect[\s\S]{0,200}focusServerCard\(/);
  assert.match(app,/data-remove[\s\S]{0,400}\$\('#addServer'\)\.focus\(\)/);
});

test('the add-server fields have visible hints and their own error slots',()=>{
  assert.match(html,/id="serverName"[^>]*aria-describedby="serverName-hint serverName-error"/);
  assert.match(html,/id="serverEndpoint"[^>]*aria-describedby="serverEndpoint-hint serverEndpoint-error"/);
  assert.match(html,/id="serverEndpoint-hint"[^>]*>Must start with https:\/\/</);
  assert.match(html,/id="serverToken"[^>]*aria-describedby="serverToken-hint"/);
  assert.match(html,/id="serverToken-hint"[^>]*>Kept only until you close this tab\.</);
  // The error is read through the field: its text is set before focus moves there (no role="alert", which read it twice).
  assert.match(html,/<p id="serverEndpoint-error" class="field-error"><\/p>/);
  assert.match(app,/-error`\)\.textContent=problem\.message;[^;]*;if\(document\.activeElement===field\)announceServerProblem\(problem\.message\);else field\.focus\(\)/);
  assert.match(app,/validateServerForm\(/);
  assert.match(app,/setAttribute\('aria-invalid','true'\)/);
});

test('data source cards lead with what the key improves',()=>{
  const fn=app.match(/function renderDataSources\(\)\{[\s\S]*?\n\}/)[0];
  assert.ok(fn.indexOf('source-improves')<fn.indexOf('SOURCE_STATUS'),'improvement before status');
  assert.doesNotMatch(fn,/API KEY/);
  assert.match(fn,/\(opens in a new tab\)/);
});
test('self-check results are words with an icon, and tables have column headers',()=>{
  assert.match(app,/'✓','Working'|✓ Working/);
  assert.match(app,/'✕','Failing'|✕ Failing/);
  assert.doesNotMatch(app,/<th>/,'every th has scope="col"');
  assert.match(html,/Tool self-check: test that each search tool still works/);
});

test('connecting keeps focus on the card and never snatches it back from elsewhere',()=>{
  assert.match(app,/function focusServerCard\(id,\{onlyIfStranded=false\}=\{\}\)\{/);
  assert.match(app,/serverFocusTarget\(/);
  assert.match(app,/onlyIfStranded&&!\(document\.activeElement===document\.body\|\|!document\.activeElement\|\|card\.contains\(document\.activeElement\)\)/);
  assert.match(app,/connect\(server\)\.then\(\(\)=>focusServerCard\(server\.id,\{onlyIfStranded:true\}\)\)/);
  assert.match(app,/saveServer[\s\S]{0,700}normalizeEndpoint\(/);
});

// Pressing Enter inside the field that has the mistake submits the form while focus is already there, so moving focus
// cannot read the error; a status line in the dialog says it instead (only in that case, so it is never read twice).
test('a mistake is read even when focus is already on the field',()=>{
  assert.match(html,/<p id="serverFormStatus" class="visually-hidden" role="status"><\/p>/);
  assert.match(app,/if\(document\.activeElement===field\)announceServerProblem\(problem\.message\);else field\.focus\(\);/);
});
