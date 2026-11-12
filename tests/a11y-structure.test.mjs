import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Page structure for screen-reader and keyboard users: dialogs announce their title and give focus back, every button
// and form control has a name, and the theme switch says which theme is on.
const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=read('app.js');

test('every dialog is titled by its heading',()=>{
  const dialogs=[...html.matchAll(/<dialog([^>]*)>([\s\S]*?)<\/dialog>/g)];
  assert.ok(dialogs.length>=4);
  for(const m of dialogs){
    const id=(m[1].match(/aria-labelledby="([^"]+)"/)||[])[1];
    assert.ok(id,`dialog without aria-labelledby: ${m[1]}`);
    assert.match(m[2],new RegExp(`<h2 id="${id}"`));
  }
});

test('every icon-only button has a name',()=>{
  for(const m of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)){
    const text=m[2].replace(/<[^>]*aria-hidden="true"[^>]*>[^<]*<\/[^>]+>/g,'').replace(/<[^>]+>/g,'').trim();
    if(!/[\p{L}\p{N}]/u.test(text))assert.match(m[1],/aria-label="[^"]+"/,`unnamed button: ${m[0].slice(0,80)}`);
  }
});

test('every form control has a label',()=>{
  for(const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)){
    const before=html.slice(0,m.index);
    const inLabel=before.lastIndexOf('<label')>before.lastIndexOf('</label>');
    assert.ok(inLabel||/aria-label="[^"]+"/.test(m[2]),`unlabeled ${m[1]}: ${m[0].slice(0,80)}`);
  }
});

test('dialogs open through openDialog, which returns focus',()=>{
  assert.match(app,/function openDialog\(dialog,trigger=document\.activeElement\)/);
  assert.doesNotMatch(app.replace(/function openDialog[\s\S]*?\n\}/,''),/\.showModal\(\)/);
});

test('the theme switch says which theme is on',()=>{
  assert.match(app,/setAttribute\('aria-pressed'/);
  assert.match(html,/id="themeToggle"[^>]*>\s*<span aria-hidden="true">/);
});
