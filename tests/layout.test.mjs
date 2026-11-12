import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const mediaRules=width=>[...css.matchAll(new RegExp(`@media\\(max-width:${width}px\\)\\{([\\s\\S]*?\\})\\}`,'g'))].map(match=>match[1]).join('');

test('short pages start at the top instead of floating in the middle of the window',()=>{
  // In the full-height .shell grid, margin:auto also centres main vertically; only horizontal centring is wanted.
  const mainRule=css.match(/(?:^|\})main\{([^}]*)\}/)[1];
  assert.match(mainRule,/margin:0 auto/);
  assert.doesNotMatch(mainRule,/margin:auto/);
});

test('the collapsed sidebar shows icons only, including for the active section and external links',()=>{
  const collapsed=mediaRules(1050);
  assert.match(collapsed,/\.brand span:last-child,\.nav\{font-size:0\}/,'every nav label is hidden, the active one too');
  assert.match(collapsed,/\.nav-external i\{display:none\}/,'the ↗ arrows are hidden');
});
