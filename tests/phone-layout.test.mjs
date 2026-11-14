import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readAppSource} from './helpers/app-source.mjs';

const css=fs.readFileSync(new URL('../public/ui.css',import.meta.url),'utf8');
const app=readAppSource();
const phoneRules=[...css.matchAll(/@media\(max-width:720px\)\{([\s\S]*?\})\}/g)].map(match=>match[1]).join('');

// The Tool library filter and the News search box are both label.filter; on phones they must stay visible.
test('the tool filter and the news search stay visible on phones',()=>{
  assert.doesNotMatch(phoneRules,/(?:^|\})\s*\.filter\{[^}]*display:none/);
});

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
