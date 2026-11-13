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
