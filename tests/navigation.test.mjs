import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The sidebar lists the app's own sections in task order, then tools and services, then outside sites. Icons are
// decoration, so screen readers hear only the labels; the current page is announced.
const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=read('app.js');
const nav=html.match(/<nav[\s\S]*?<\/nav>/)[0];

test('navigation lists the app sections in task order, then tools, then outside sites',()=>{
  const order=[...nav.matchAll(/data-view="(\w+)"/g)].map(m=>m[1]);
  assert.deepEqual(order,['workspace','evidence','news','servers','library','deep']);
  assert.ok(nav.indexOf('Tools and services')<nav.indexOf('data-view="servers"'));
  assert.ok(nav.indexOf('Outside sites')<nav.indexOf('intelmap.watch'));
  assert.match(nav,/data-view="workspace"[^>]*>[\s\S]*?Search</);
});

test('nav icons are hidden from screen readers and outside links say they open a new tab',()=>{
  for(const m of nav.matchAll(/<(?:button|a) class="nav[^"]*"[\s\S]*?<\/(?:button|a)>/g)){
    for(const icon of m[0].matchAll(/<(span|img|i)\b[^>]*>/g))assert.match(icon[0],/aria-hidden="true"/,`decorative ${icon[1]} exposed in: ${m[0].slice(0,70)}`);
  }
  assert.match(nav,/aria-label="Open IntelMap \(opens in a new tab\)"/);
  assert.match(nav,/aria-label="Open Situation Room \(opens in a new tab\)"/);
});

test('the current page is announced',()=>{
  assert.match(app,/setAttribute\('aria-current','page'\)/);
  assert.match(app,/removeAttribute\('aria-current'\)/);
  assert.match(nav,/data-view="workspace"[^>]*aria-current="page"/,'Search is current on load');
});

// The collapsed sidebar (≤1050 px) shows icons only; the larger label size must not bring the labels back there.
test('the collapsed sidebar keeps hiding nav labels',()=>{
  const ui=read('ui.css');
  const collapsed=[...ui.matchAll(/@media\(max-width:1050px\)\{([\s\S]*?\})\}/g)].map(m=>m[1]).join('');
  assert.match(collapsed,/\.rail \.nav\{font-size:0\}/);
});
