import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readAppSource} from './helpers/app-source.mjs';

const css=fs.readFileSync(new URL('../public/ui.css',import.meta.url),'utf8');
const app=readAppSource();
// That the Tool library filter and the News search box stay visible on a phone is measured in a real browser
// (tests/browser-flows.test.mjs).

// Wide tables (Run history, tool check results) scroll inside their own box on phones instead of being cut off,
// and that box can be reached and scrolled with the keyboard.
test('wide result tables scroll inside a labelled, keyboard-reachable box',()=>{
  assert.match(css,/\.table-scroll\{[^}]*overflow-x:auto/);
  for(const label of ['Run history table','Tool check results table']){
    const pattern=new RegExp(`<div class="table-scroll" role="region" tabindex="0" aria-label="${label}"><table class="deep-history-table">`);
    assert.match(app,pattern,label);
  }
  assert.equal((app.match(/<table class="deep-history-table">/g)||[]).length,(app.match(/<div class="table-scroll"/g)||[]).length);
});
