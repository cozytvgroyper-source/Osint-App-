import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readAppSource} from './helpers/app-source.mjs';

const source=readAppSource();
const handler=source.slice(source.indexOf("$('#executeTool').addEventListener"),source.indexOf('\n',source.indexOf("$('#executeTool').addEventListener")));

// The run window closes before the tool runs, so an error after that must be shown outside it.
test('a Run tool error after the run window closed is shown as a message, not written into the closed window',()=>{
  assert.ok(handler.length>100,'found the Run tool handler');
  const caught=handler.slice(handler.lastIndexOf('catch(error){'));
  assert.match(caught,/\$\('#runDialog'\)\.open\s*\?/,'checks whether the run window is still open');
  assert.match(caught,/toast\([^)]*error\.message/,'shows the error as a message when the window has closed');
});

test('error messages stay on screen longer than ordinary notices',()=>{
  assert.match(source,/function toast\(message,\s*ms\s*=\s*2400\)/);
  assert.match(source,/setTimeout\(\(\)=>el\.classList\.remove\('show'\),ms\)/);
});
