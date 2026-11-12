import test from 'node:test';
import assert from 'node:assert/strict';
import {rankResults,matchScore} from '../public/search-ranking.js';
const t=(name,serverName='Open OSINT')=>({name,serverName,description:`${name} description`});
const rank=(entries,subject='Rosneft',preferredNames=[])=>rankResults({subject,preferredNames,entries:entries.map(([name,data])=>({tool:t(name),toolLabel:name,data}))});

test('phrase beats all words beats some words beats none',()=>{
  assert.equal(matchScore('sanctions on bank of america today','Bank of America'),3);
  assert.equal(matchScore('america sued the bank','Bank of America'),2);
  assert.equal(matchScore('a bank in ohio','Bank of America'),1);
  assert.equal(matchScore('unrelated headline','Bank of America'),0);
});
test('direct beats context only when match scores tie',()=>{
  const r=rank([['get_news_rss',{articles:[{title:'Rosneft hit by sanctions'}]}],['get_opensanctions',{results:[{name:'Rosneft'},{name:'Other'}]}]],'Rosneft',['get_opensanctions']);
  assert.deepEqual(r.topResults.map(i=>i.toolName),['get_opensanctions','get_news_rss']);
  const r2=rank([['get_news_rss',{articles:[{title:'Rosneft oil'}]}],['get_opensanctions',{results:[{name:'Ros'}]}]],'Rosneft oil',['get_opensanctions']);
  assert.equal(r2.topResults[0].toolName,'get_news_rss');
});
test('top results stop at 10 and leave out non-matching items',()=>{
  const r=rank([['get_news_rss',{articles:[...Array(15)].map((_,i)=>({title:`Rosneft ${i}`})).concat([{title:'Iran'}])}]]);
  assert.equal(r.topResults.length,10);
  assert.equal(r.sections[0].matching.length,15);
  assert.deepEqual(r.sections[0].nonMatching,[{title:'Iran'}]);
});
test('a record with no item list is one single item',()=>{
  const r=rank([['get_whois',{registrar:'Rosneft Registrar',created:'2001'}]]);
  assert.equal(r.sections[0].single,true);
  assert.equal(r.topResults[0].score,3); // no title-like fields, so all top-level strings are checked
});
test('an empty subject keeps the original order and folds nothing',()=>{
  const r=rank([['get_news_rss',{articles:[{title:'b'},{title:'a'}]}]],'');
  assert.deepEqual(r.sections[0].matching.map(i=>i.title),['b','a']);
  assert.equal(r.sections[0].nonMatching.length,0);
});
test('string arrays are not items and stay in facts',()=>{
  const r=rank([['dns',{domains:['rosneft.ru'],records:[{name:'rosneft.ru A'}]}]]);
  assert.deepEqual(r.sections[0].facts,{domains:['rosneft.ru']});
});
test('sections are ordered by their best item',()=>{
  const r=rank([['a',{items:[{title:'Ros'}]}],['b',{items:[{title:'Rosneft'}]}]],'Rosneft');
  assert.deepEqual(r.sections.map(s=>s.toolName),['b','a']);
});
// Review Focus 1–3
test('subjects with regex characters match literally',()=>{
  assert.equal(matchScore('learning c++ today','C++'),3);
  assert.doesNotThrow(()=>matchScore('x','(USA'));
});
test('non-string fields are ignored, not crashed on',()=>{
  const r=rank([['x',{items:[{title:42,name:null,description:{nested:'Rosneft'}},{title:'Rosneft'}]}]]);
  assert.deepEqual(r.sections[0].matching.map(i=>i.title),['Rosneft']);
});
test('a bare string result is one item scored on its text',()=>{
  const r=rank([['omega_intel','Report\nRosneft owns this']]);
  assert.equal(r.sections[0].single,true);
  assert.equal(r.sections[0].matching[0],'Report\nRosneft owns this');
});
test('an empty result list is never a single-record match',()=>{
  const r=rank([['x',{query:'Rosneft',results:[]}]]);
  assert.equal(r.sections[0].single,false);
  assert.deepEqual(r.sections[0].matching,[]);
  assert.deepEqual(r.sections[0].nonMatching,[]);
  assert.deepEqual(r.sections[0].facts,{query:'Rosneft'});
  assert.equal(r.topResults.length,0);
});
