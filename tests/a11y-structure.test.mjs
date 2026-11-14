import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readAppSource} from './helpers/app-source.mjs';

// Page structure for screen-reader and keyboard users: dialogs announce their title and give focus back, every button
// and form control has a name, and the theme switch says which theme is on.
const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=readAppSource();

test('every dialog is titled by its heading',()=>{
  const dialogs=[...html.matchAll(/<dialog([^>]*)>([\s\S]*?)<\/dialog>/g)];
  assert.ok(dialogs.length>=4);
  for(const m of dialogs){
    const id=(m[1].match(/aria-labelledby="([^"]+)"/)||[])[1];
    assert.ok(id,`dialog without aria-labelledby: ${m[1]}`);
    assert.match(m[2],new RegExp(`<h2 id="${id}"`));
  }
});

// The text a screen reader would read from a button's markup: text outside any aria-hidden element. Walks the tags
// and text pieces instead of deleting tags with a regex, which reads the same and is not a sanitizer.
function spokenText(markup){
  let hidden=0,text='';
  for(const [piece] of markup.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)){
    if(!piece.startsWith('<')){if(!hidden)text+=piece;continue;}
    const closing=piece.startsWith('</'),selfClosing=/\/>$|^<(?:img|br|input)\b/i.test(piece);
    if(closing){if(hidden)hidden--;}else if(hidden)hidden+=selfClosing?0:1;else if(/aria-hidden="true"/.test(piece)&&!selfClosing)hidden=1;
  }
  return text.trim();
}

test('every icon-only button has a name',()=>{
  assert.equal(spokenText('<span aria-hidden="true">⌫</span>'),'');
  assert.equal(spokenText('<span aria-hidden="true">⌕</span>Search'),'Search');
  for(const m of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)){
    if(!/[\p{L}\p{N}]/u.test(spokenText(m[2])))assert.match(m[1],/aria-label="[^"]+"/,`unnamed button: ${m[0].slice(0,80)}`);
  }
});

test('every form control has a label',()=>{
  for(const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)){
    const before=html.slice(0,m.index);
    const inLabel=before.lastIndexOf('<label')>before.lastIndexOf('</label>');
    const id=(m[2].match(/\bid="([^"]+)"/)||[])[1];
    const labelFor=id&&html.includes(`<label for="${id}"`);
    assert.ok(inLabel||labelFor||/aria-label="[^"]+"/.test(m[2]),`unlabeled ${m[1]}: ${m[0].slice(0,80)}`);
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

test('labelled containers have a role that allows a label',()=>{
  for(const m of html.matchAll(/<div\b([^>]*\baria-label="[^"]*"[^>]*)>/g))assert.match(m[1],/\brole="[^"]+"/,`div with aria-label but no role: ${m[0].slice(0,80)}`);
});

// After closing a dialog, focus goes back to its opener only if nothing else took it: a Pivot closes the results and
// focuses the search box, and must keep it there.
test('closing a dialog never steals focus that already moved on',()=>{
  const body=app.match(/function openDialog[\s\S]*?\n\}/)[0];
  assert.match(body,/document\.activeElement===document\.body\|\|dialog\.contains\(document\.activeElement\)/);
});

// The theme switch shows its name next to the icon (it was icon-only), and the name matches its accessible name.
test('the theme switch has a visible label',()=>{
  assert.match(html,/id="themeToggle"[\s\S]{0,200}<span class="theme-label">Dark theme<\/span>/);
  assert.doesNotMatch(app,/toggle\.title=/,'no changing tooltip; aria-pressed says whether it is on');
});

// A click on the dialog's own padding hits the <dialog> element too, so only a click outside its box cancels; and a
// second confirmation while one is open is refused instead of rewiring the open one.
test('only a click outside the dialog box cancels a confirmation, and a second ask while one is open is refused',()=>{
  const fn=app.match(/function confirmAction\(\{title,message,confirmLabel\}\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn,/getBoundingClientRect\(\)/);
  assert.match(fn,/if\(dialog\.open\)return Promise\.resolve\(false\)/);
});

// The error is in the field's aria-describedby, so it is read when focus moves to the field; role="alert" read it twice.
test('field errors are read once, through the field',()=>{
  assert.doesNotMatch(html,/id="server(?:Name|Endpoint)-error"[^>]*role="alert"/);
});

// Card titles are h3; each list of cards has an h2 above it (for screen readers; the page shows the cards' own layout).
test('every card list has a section heading so headings never skip a level',()=>{
  assert.match(html,/<h2 class="visually-hidden">Your MCP servers<\/h2>\s*<div id="serverList"/);
  assert.match(html,/<h2 class="visually-hidden">Stories<\/h2>\s*<div id="intelNewsList"/);
  assert.match(html,/<h2 class="visually-hidden">Findings<\/h2>\s*<div id="evidenceList"/);
});

// Label in name (WCAG 2.5.3): the Pivot button's accessible name starts with the word it shows, so "click Pivot" works
// for voice control; the rest says what it looks up.
test('the Pivot button is named by the word it shows',()=>{
  const fn=app.match(/function pivotButton\(value\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn,/>Pivot →<\/button>/);
  assert.match(fn,/aria-label="\$\{escapeHtml\(`Pivot: \$\{pivot\.label\[0\]\.toLowerCase\(\)\}\$\{pivot\.label\.slice\(1\)\} \$\{pivot\.target\}`\)\}"/);
});

// Review follow-ups: the theme switch stays readable on hover and keeps a tooltip when it shows only its icon; the
// self-check is its own section, not part of the server list.
test('the theme switch is readable on hover and has a tooltip',()=>{
  assert.match(html,/id="themeToggle" title="Dark theme"/);
  assert.match(read('ui.css'),/#themeToggle:hover\{background:rgba\(255,255,255,\.11\);color:#fff\}/);
});
test('the tool self-check has its own section heading',()=>{
  assert.match(html,/<h2>Tool self-check: test that each search tool still works<\/h2>/);
});
test('the collapsed sidebar keeps the status dot and theme icon on one line',()=>{
  assert.match(read('ui.css'),/@media\(max-width:1050px\)\{#themeToggle\{[^}]*\}#themeToggle \.theme-label\{display:none\}\.rail-foot\{gap:0;flex-wrap:nowrap\}\}/);
});

test('Deep Search status changes are announced only when the words change',()=>{
  assert.match(app,/deepStatus\.textContent!==status\.message/);
});
