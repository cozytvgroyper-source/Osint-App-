import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// MCP servers page wiring: cards come from servers-view.js, and focus is never lost when a card changes or goes.
const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=read('app.js');

test('server cards come from the view module, and focus follows card changes',()=>{
  assert.match(app,/from '\.\/servers-view\.js\?v=\d+'/);
  assert.match(app,/function focusServerCard\(id\)\{[^\n]*data-server-card[^\n]*\.focus\(\)/);
  assert.match(app,/data-disconnect[\s\S]{0,200}focusServerCard\(/);
  assert.match(app,/data-remove[\s\S]{0,400}\$\('#addServer'\)\.focus\(\)/);
});

test('the add-server fields have visible hints and their own error slots',()=>{
  assert.match(html,/id="serverName"[^>]*aria-describedby="serverName-hint serverName-error"/);
  assert.match(html,/id="serverEndpoint"[^>]*aria-describedby="serverEndpoint-hint serverEndpoint-error"/);
  assert.match(html,/id="serverEndpoint-hint"[^>]*>Must start with https:\/\/</);
  assert.match(html,/id="serverToken"[^>]*aria-describedby="serverToken-hint"/);
  assert.match(html,/id="serverToken-hint"[^>]*>Kept only until you close this tab\.</);
  assert.match(html,/id="serverEndpoint-error"[^>]*role="alert"/);
  assert.match(app,/validateServerForm\(/);
  assert.match(app,/setAttribute\('aria-invalid','true'\)/);
});
