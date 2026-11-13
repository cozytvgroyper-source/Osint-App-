import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeHtml,pageHeader,navItem,button,field,card,badge,emptyState,term} from '../public/ui.js';

// Shared building blocks return HTML strings. Every value they interpolate is escaped, and each one carries the
// accessibility its use needs, so pages built from them get it for free.
const hostile='<img src=x onerror=alert(1)>"\'';

test('escapes every interpolated value',()=>{
  assert.equal(escapeHtml(hostile),'&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
  for(const html of [pageHeader({title:hostile,intro:hostile}),button({label:hostile}),card({title:hostile}),badge({text:hostile}),emptyState({title:hostile,text:hostile}),
    navItem({view:hostile,icon:hostile,label:hostile}),field({id:'q',label:hostile,hint:hostile,error:hostile,control:{tag:'input',attrs:{value:hostile}}})])
    assert.doesNotMatch(html,/<img/);
});

test('one h1 per page header, with its intro',()=>{
  const html=pageHeader({title:'Search',intro:'Look up'});
  assert.equal((html.match(/<h1/g)||[]).length,1);
  assert.match(html,/<p class="page-intro">Look up<\/p>/);
});

test('nav items hide their icon from screen readers and mark the current page',()=>{
  const html=navItem({view:'evidence',icon:'◇',label:'Evidence',current:true});
  assert.match(html,/<span aria-hidden="true">◇<\/span>/);
  assert.match(html,/aria-current="page"/);
  assert.match(html,/data-view="evidence"/);
  assert.doesNotMatch(navItem({view:'news',icon:'x',label:'News'}),/aria-current/);
});

test('icon-only buttons get their label as an accessible name, and a label is required',()=>{
  assert.match(button({label:'Clear history',icon:'⌫',iconOnly:true}),/aria-label="Clear history"/);
  assert.match(button({label:'Clear history',icon:'⌫',iconOnly:true}),/<span aria-hidden="true">⌫<\/span>/);
  assert.match(button({label:'Go'}),/type="button"/);
  assert.match(button({label:'Go',kind:'primary'}),/class="btn btn-primary"/);
  assert.match(button({label:'Save',attrs:{type:'submit'}}),/type="submit"/);
  assert.throws(()=>button({label:''}),/button needs a label/);
});

test('fields link their label, hint and error',()=>{
  const html=field({id:'endpoint',label:'Endpoint',hint:'Must start with https://',error:'Not a URL',control:{tag:'input',attrs:{type:'url'}}});
  assert.match(html,/<label for="endpoint">/);
  assert.match(html,/aria-describedby="endpoint-hint endpoint-error"/);
  assert.match(html,/aria-invalid="true"/);
  assert.match(html,/id="endpoint-error"/);
  const plain=field({id:'case',label:'Case',control:{tag:'select',attrs:{},options:[{value:'a',label:'Alpha'}]}});
  assert.doesNotMatch(plain,/aria-describedby|aria-invalid/);
  assert.match(plain,/<select id="case"[^>]*><option value="a">Alpha<\/option><\/select>/);
});

test('badges always carry text',()=>{
  assert.match(badge({text:'Passive',tone:'safe'}),/Passive/);
  assert.match(badge({text:'Passive',tone:'safe',icon:'✓'}),/<span aria-hidden="true">✓<\/span>/);
});

test('cards and empty states keep their heading and next action',()=>{
  assert.match(card({title:'Rosneft',body:'<p>b</p>',actions:'<button>x</button>',headingLevel:2}),/<h2[^>]*>Rosneft<\/h2>[\s\S]*<p>b<\/p>[\s\S]*<button>x<\/button>/);
  assert.match(emptyState({title:'No case yet',text:'Create one.',action:'<button>New case</button>'}),/No case yet[\s\S]*Create one\.[\s\S]*New case/);
});

test('glossary terms carry their explanation for screen readers',()=>{
  assert.match(term('pivot'),/Pivot/);
  assert.match(term('pivot'),/visually-hidden">: Search this value next\./);
  assert.throws(()=>term('nope'),/Unknown glossary term: nope/);
});

// Older stylesheets load after ui.css and style .badge/.empty-state, so the building blocks use names of their own.
test('building blocks use class names no older stylesheet defines',()=>{
  assert.match(badge({text:'Passive',tone:'safe'}),/class="ui-badge ui-badge-safe"/);
  assert.match(emptyState({title:'t',text:'x'}),/class="ui-empty"/);
  assert.match(emptyState({title:'t',text:'x'}),/class="ui-empty-title"/);
});

// Where a term is being explained (not just mentioned), sighted readers need the meaning too.
test('a term can show its explanation visibly',()=>{
  assert.equal(term('pivot',{visible:true}),'<span class="term-explained"><b>Pivot</b>: Search this value next.</span>');
  assert.doesNotMatch(term('pivot',{visible:true}),/visually-hidden/);
});

// A field error is read through the field's aria-describedby; role="alert" on top of that read it twice.
test('field errors carry no alert role',()=>{
  assert.doesNotMatch(field({id:'e',label:'E',error:'Bad',control:{tag:'input',attrs:{}}}),/role="alert"/);
});
