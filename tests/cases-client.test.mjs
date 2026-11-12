import test from 'node:test';
import assert from 'node:assert/strict';
import {activeCaseId,newestFirst,shortFingerprint,defaultCaseName} from '../public/cases-client.js';

const cases=[{id:'aaaaaaaaaaaaaaaa',name:'A'},{id:'bbbbbbbbbbbbbbbb',name:'B'},{id:'cccccccccccccccc',name:'Broken',damaged:true}];

test('keeps the remembered case when it still exists, otherwise picks none',()=>{
  assert.equal(activeCaseId(cases,'bbbbbbbbbbbbbbbb'),'bbbbbbbbbbbbbbbb');
  assert.equal(activeCaseId(cases,'dddddddddddddddd'),null,'a deleted case is not reselected');
  assert.equal(activeCaseId(cases,'cccccccccccccccc'),null,'a damaged case cannot be opened');
  assert.equal(activeCaseId(cases,null),null);
});

test('shows findings newest first without changing the saved order',()=>{
  const evidence=[{id:'1'},{id:'2'},{id:'3'}];
  assert.deepEqual(newestFirst(evidence).map(e=>e.id),['3','2','1']);
  assert.deepEqual(evidence.map(e=>e.id),['1','2','3']);
  assert.deepEqual(newestFirst(undefined),[]);
});

test('shortens a fingerprint for display',()=>{
  assert.equal(shortFingerprint('0123456789abcdef'.repeat(4)),'0123456789ab…');
  assert.equal(shortFingerprint(''),'');
});

test('suggests a case name from what is being saved',()=>{
  assert.equal(defaultCaseName('example.com',new Date('2026-11-12T10:00:00Z')),'example.com — 2026-11-12');
  assert.equal(defaultCaseName('x'.repeat(200),new Date('2026-11-12T10:00:00Z')).length<=120,true);
  assert.equal(defaultCaseName('',new Date('2026-11-12T10:00:00Z')),'Case — 2026-11-12');
});
