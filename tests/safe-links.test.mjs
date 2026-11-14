import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {safeHttpUrl} from '../public/ui.js';
import {renderPersonResults} from '../public/deep-results-view.js';
import {readAppSource} from './helpers/app-source.mjs';

// Tool answers are untrusted: a link they contain may only ever become a web (http/https) address.
const DANGEROUS=['javascript:alert(1)','JavaScript:alert(1)',' javascript:alert(1)','\tjava\nscript:alert(1)','data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)','file:///etc/passwd','ftp://files.example/x','//evil.example/x','not a url',''];

test('only web addresses survive the link check',()=>{
  for(const value of DANGEROUS)assert.equal(safeHttpUrl(value),'',JSON.stringify(value));
  assert.equal(safeHttpUrl('https://example.com/a?b=1'),'https://example.com/a?b=1');
  assert.equal(safeHttpUrl('HTTP://Example.com'),'http://example.com/');
});

test('a dangerous link in a Deep Search result is shown as text, never as a link',()=>{
  for(const url of DANGEROUS.filter(Boolean)){
    const html=renderPersonResults({id:'p',target:{type:'username',value:'ownername'},level:0,outcome:'completed',rounds:1,calls:[],leadsNotFollowed:[],findings:[{
      id:'a',kind:'account',status:'linked',reason:'Registered with owner@example.com.',level:3,confirmedBy:['a'],reasons:[{rule:'a',text:'Registered with owner@example.com.'}],
      subject:{type:'username',value:'ownername'},account:{site:'Example',url,category:'other',presence:'found',details:{names:[],usernames:[],emails:[],phones:[],ips:[],websites:[url],places:[]}},
      evidence:{names:[],emails:[],usernames:[],phones:[],urls:[],places:[]},sources:[{name:'maigret',serverName:'T'}],trail:[]}]});
    const hrefs=[...html.matchAll(/href="([^"]*)"/g)].map(match=>match[1]);
    assert.ok(hrefs.every(href=>/^(?:https?:\/\/|#)/.test(href)),`${JSON.stringify(url)} → ${hrefs.join(' ')}`);
  }
});

test('the app links news sources only through the shared link check',()=>{
  const app=readAppSource();
  assert.match(app,/const safeExternalUrl=value=>safeHttpUrl\(value\)\|\|'#';/);
  assert.doesNotMatch(app,/function safeExternalUrl/);
});
