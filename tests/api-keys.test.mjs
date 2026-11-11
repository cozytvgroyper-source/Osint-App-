import test from 'node:test';
import assert from 'node:assert/strict';
import {DATA_SOURCES,parseKeyFile,updateKeyFile,sourceStatuses,effectiveEnv,validateKeyValue} from '../scripts/api-keys.mjs';

// work/api-keys.env holds the user's data-source keys as KEY=value lines, plus PUBLIC_DESK_DISABLED for sources the
// user disconnected. The file is only ever parsed as text: nothing in it runs. These tests use fake values.

test('reads allowlisted keys with values, stripping one pair of quotes and keeping "=" inside values',()=>{
  const {values}=parseKeyFile('AISSTREAM_API_KEY=ais-test-1\nOTX_API_KEY="otx-test-2"\nABUSEIPDB_API_KEY=\'abuse-test-3\'\nINTELX_API_KEY=abc=def==\nURLHAUS_AUTH_KEY=\n');
  assert.deepEqual(Object.fromEntries(values),{AISSTREAM_API_KEY:'ais-test-1',OTX_API_KEY:'otx-test-2',ABUSEIPDB_API_KEY:'abuse-test-3',INTELX_API_KEY:'abc=def=='});
});

test('skips comments, blank lines, unknown names and paid AI keys',()=>{
  const {values}=parseKeyFile('# OTX_API_KEY=commented-out\n\n   \nGROQ_API_KEY=groq-test\nNOT_A_SOURCE=x\nOTX_API_KEY=otx-test\n');
  assert.deepEqual(Object.fromEntries(values),{OTX_API_KEY:'otx-test'});
});

test('never treats file text as a command; values stay literal',()=>{
  const {values}=parseKeyFile('OTX_API_KEY=$(touch /tmp/x)\ntouch /tmp/x\nINTELX_API_KEY=`id`\n');
  assert.equal(values.get('OTX_API_KEY'),'$(touch /tmp/x)');
  assert.equal(values.get('INTELX_API_KEY'),'`id`');
});

test('lists every keyed source with the tools it feeds and where to get a key',()=>{
  assert.ok(DATA_SOURCES.length>=14);
  for(const source of DATA_SOURCES){
    assert.ok(source.id&&source.name&&source.signup.startsWith('https://')&&source.fields.length,source.id);
    assert.ok(Array.isArray(source.feeds),source.id);
  }
  assert.deepEqual(DATA_SOURCES.find(s=>s.id==='acled').fields.map(f=>f.env),['ACLED_ACCESS_TOKEN','ACLED_EMAIL']);
});

test('a source is connected when all its fields are saved and it is not disconnected',()=>{
  const text='OTX_API_KEY=otx-test\nABUSEIPDB_API_KEY=abuse-test\nACLED_ACCESS_TOKEN=acled-token\nPUBLIC_DESK_DISABLED=abuseipdb\n';
  const status=Object.fromEntries(sourceStatuses(parseKeyFile(text)).map(s=>[s.id,s.status]));
  assert.equal(status.otx,'connected');
  assert.equal(status.abuseipdb,'disconnected');
  assert.equal(status.acled,'not_configured','ACLED needs both the token and the email');
  assert.equal(status.intelx,'not_configured');
});

test('statuses never include key values',()=>{
  const statuses=sourceStatuses(parseKeyFile('OTX_API_KEY=secret-value-123\n'));
  assert.doesNotMatch(JSON.stringify(statuses),/secret-value-123/);
});

test('only connected sources reach the data service',()=>{
  const env=effectiveEnv(parseKeyFile('OTX_API_KEY=otx-test\nABUSEIPDB_API_KEY=abuse-test\nINTELX_API_ORIGIN=https://2.intelx.io\nPUBLIC_DESK_DISABLED=abuseipdb\n'));
  assert.deepEqual(env,{OTX_API_KEY:'otx-test',INTELX_API_ORIGIN:'https://2.intelx.io'});
});

test('connect saves a key in place and keeps the rest of the file',()=>{
  const before='# OTX: https://otx.alienvault.com\nOTX_API_KEY=\n\n# AbuseIPDB\nABUSEIPDB_API_KEY=abuse-test\n';
  const after=updateKeyFile(before,{set:{OTX_API_KEY:'otx-new'}});
  assert.equal(after,'# OTX: https://otx.alienvault.com\nOTX_API_KEY=otx-new\n\n# AbuseIPDB\nABUSEIPDB_API_KEY=abuse-test\n');
  assert.equal(updateKeyFile('',{set:{GREYNOISE_API_KEY:'gn-test'}}),'GREYNOISE_API_KEY=gn-test\n','appends a missing name');
});

test('disconnect keeps the key; connect without a new key turns it back on; remove deletes it',()=>{
  let text='OTX_API_KEY=otx-test\n';
  text=updateKeyFile(text,{disabled:['otx']});
  assert.equal(parseKeyFile(text).values.get('OTX_API_KEY'),'otx-test');
  assert.equal(sourceStatuses(parseKeyFile(text)).find(s=>s.id==='otx').status,'disconnected');
  text=updateKeyFile(text,{disabled:[]});
  assert.equal(sourceStatuses(parseKeyFile(text)).find(s=>s.id==='otx').status,'connected');
  text=updateKeyFile(text,{unset:['OTX_API_KEY']});
  assert.equal(parseKeyFile(text).values.has('OTX_API_KEY'),false);
  assert.match(text,/^OTX_API_KEY=$/m,'keeps the empty line so the template stays readable');
});

test('rejects key values that could break the file',()=>{
  for(const bad of ['','   ','two words','line\nbreak','tab\there','"quoted"',"it's",'x'.repeat(501),'\u0000'])assert.throws(()=>validateKeyValue(bad),JSON.stringify(bad));
  assert.equal(validateKeyValue('  otx-1234_ABCD.efg=  '),'otx-1234_ABCD.efg=');
  assert.equal(validateKeyValue('name@example.org'),'name@example.org');
});
