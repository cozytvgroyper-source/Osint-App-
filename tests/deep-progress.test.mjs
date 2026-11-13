import test from 'node:test';
import assert from 'node:assert/strict';
import {deepStatusLine,initialProgress,minutesLeft,reduceProgress,renderProgress} from '../public/deep-progress.js';

test('progress moves through stages, keeps leads with their stage and matches counts',()=>{
  let state=initialProgress({type:'email',value:'owner@example.com'},0,0);
  state=reduceProgress(state,{type:'counts',linked:1,possible:0,done:1,total:4});
  state=reduceProgress(state,{type:'stage',stage:'leads',round:2});
  state=reduceProgress(state,{type:'lead',identifier:{type:'username',value:'ownername'},from:{type:'email',value:'owner@example.com'}});
  state=reduceProgress(state,{type:'stage',stage:'sites',round:3});
  state=reduceProgress(state,{type:'counts',linked:3,possible:1,done:4,total:4});
  assert.equal(state.stage,'sites');assert.equal(state.round,3);
  assert.equal(state.leads[0].stage,'leads');assert.equal(state.leads[0].identifier.value,'ownername');
  assert.deepEqual({linked:state.linked,possible:state.possible,done:state.done,total:state.total},{linked:3,possible:1,done:4,total:4});
});

test('time remaining waits for five tools and rounds up to a whole minute',()=>{
  let state=initialProgress({type:'domain',value:'example.com'},1,0);
  for(let index=0;index<4;index++)state=reduceProgress(state,{type:'tool-end',ms:30_000});
  state={...state,done:4,total:10};assert.equal(minutesLeft(state,120_000),null);
  state=reduceProgress(state,{type:'tool-end',ms:30_000});state={...state,done:5,total:10};
  assert.equal(minutesLeft(state,150_000),3);
  state={...state,done:9,total:10};assert.equal(minutesLeft(state,150_000),1);
});

test('rendered progress names the target, progress and four stages',()=>{
  const state={...initialProgress({type:'email',value:'owner@example.com'},0,0),total:8,done:2};
  const html=renderProgress(state);
  assert.match(html,/<h2 id="deepProgressHeading"[^>]*>owner@example\.com<\/h2>/);
  assert.match(html,/<progress[^>]*aria-label="Deep Search progress"[^>]*max="8"[^>]*value="2"/);
  for(const text of ['Checking what you typed','Following leads','Checking linked websites','Putting the results together'])assert.match(html,new RegExp(text));
  assert.match(html,/You can switch to other pages in the app\. Keep this tab open until it finishes\./);
  assert.match(html,/data-deep-cancel/);
});

test('status lines distinguish people, sites, other supported targets and unsupported text',()=>{
  assert.equal(deepStatusLine('').kind,'empty');
  assert.equal(deepStatusLine('owner@example.com').kind,'person');
  assert.equal(deepStatusLine('example.com').kind,'site');
  assert.equal(deepStatusLine('+1 555 555 0100').kind,'other');
  assert.deepEqual(deepStatusLine('John Smith'),{kind:'unsupported',message:'Deep Search needs an email, username, website or IP. To search a name, use Search.'});
});

test('a phone number without a country code is asked for one',()=>{
  const line=deepStatusLine('555-123-4567');
  assert.equal(line.kind,'unsupported');
  assert.match(line.message,/country code/);
});
