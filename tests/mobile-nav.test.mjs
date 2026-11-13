import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// On phones the sidebar becomes a bottom tab bar. It holds six app sections and two external links, more than fit at
// 375 px, so it must scroll and must list the app's own sections (Evidence included) before the external sites.
const css=fs.readFileSync(new URL('../public/ui.css',import.meta.url),'utf8');
const phoneRules=[...css.matchAll(/@media\(max-width:720px\)\{([\s\S]*?\})\}/g)].map(match=>match[1]).join('');

test('the phone tab bar scrolls instead of hiding sections off-screen',()=>{
  assert.match(phoneRules,/\.rail nav\{[^}]*overflow-x:auto/);
  assert.match(phoneRules,/\.rail nav \.nav\{[^}]*flex:0 0 auto/);
});

test('the phone tab bar lists app sections before the external sites',()=>{
  assert.match(phoneRules,/\.rail nav \.nav-external\{[^}]*order:1/);
});
