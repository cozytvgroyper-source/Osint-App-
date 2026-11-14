import test from 'node:test';
import assert from 'node:assert/strict';
import {readAppSource} from './helpers/app-source.mjs';

const source=readAppSource();
// That a failing tool's error is shown as a message is tested in a real browser (tests/browser-flows.test.mjs).

test('error messages stay on screen longer than ordinary notices',()=>{
  assert.match(source,/function toast\(message,\s*ms\s*=\s*2400\)/);
  assert.match(source,/setTimeout\(\(\)=>el\.classList\.remove\('show'\),ms\)/);
});
