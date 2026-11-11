import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// The launcher reads work/api-keys.env with scripts/load-api-keys.zsh and passes the keys to the Open OSINT data
// service only. These tests run the loader under zsh with fake values and report what it exported.
const loader=new URL('../scripts/load-api-keys.zsh',import.meta.url).pathname;
const names=['AISSTREAM_API_KEY','OTX_API_KEY','ABUSEIPDB_API_KEY','INTELX_API_KEY','GROQ_API_KEY','NOT_A_SOURCE','PATH_LIKE'];

function load(contents,{create=true}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-keys-'));
  const file=path.join(dir,'api-keys.env');
  if(create)fs.writeFileSync(file,contents,{mode:0o644});
  const script=`source ${JSON.stringify(loader)}; load_api_keys ${JSON.stringify(file)} || exit 3
for name in ${names.join(' ')}; do [[ -n "\${(P)name+set}" ]] && print -r -- "$name=\${(P)name}"; done
exit 0`;
  const run=spawnSync('zsh','-fc'.split(' ').concat(script),{encoding:'utf8',env:{HOME:process.env.HOME,PATH:process.env.PATH}});
  const exported=Object.fromEntries(run.stdout.split('\n').filter(line=>/^[A-Z_]+=/.test(line)).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));
  const mode=create?fs.statSync(file).mode&0o777:null;
  fs.rmSync(dir,{recursive:true,force:true});
  return {status:run.status,exported,stdout:run.stdout,stderr:run.stderr,mode};
}

test('exports the data-source keys that have values',()=>{
  const {status,exported}=load('AISSTREAM_API_KEY=ais-test-1\nOTX_API_KEY="otx-test-2"\nABUSEIPDB_API_KEY=\'abuse-test-3\'\nINTELX_API_KEY=\n');
  assert.equal(status,0);
  assert.deepEqual(exported,{AISSTREAM_API_KEY:'ais-test-1',OTX_API_KEY:'otx-test-2',ABUSEIPDB_API_KEY:'abuse-test-3'});
});

test('skips comments, blank lines and empty values',()=>{
  const {exported}=load('# AISStream: https://aisstream.io\n\n   \nAISSTREAM_API_KEY=\n# OTX_API_KEY=commented-out\n');
  assert.deepEqual(exported,{});
});

test('ignores names outside the allowlist, including paid AI keys',()=>{
  const {exported,stdout}=load('GROQ_API_KEY=groq-test\nNOT_A_SOURCE=x\nOTX_API_KEY=otx-test\n');
  assert.deepEqual(exported,{OTX_API_KEY:'otx-test'});
  assert.match(stdout,/Ignoring GROQ_API_KEY/);
});

test('never runs text from the file as a command',()=>{
  const marker=path.join(os.tmpdir(),`public-desk-keys-ran-${process.pid}`);
  fs.rmSync(marker,{force:true});
  const {exported}=load(`OTX_API_KEY=$(touch ${marker})\ntouch ${marker}\nINTELX_API_KEY=\`touch ${marker}\`\n`);
  assert.equal(fs.existsSync(marker),false);
  assert.equal(exported.OTX_API_KEY,`$(touch ${marker})`);
});

test('keeps an equals sign inside a value',()=>{
  assert.equal(load('INTELX_API_KEY=abc=def==\n').exported.INTELX_API_KEY,'abc=def==');
});

test('prints key names, never their values, and makes the file private',()=>{
  const {stdout,mode}=load('AISSTREAM_API_KEY=secret-value-123\n');
  assert.match(stdout,/AISSTREAM_API_KEY/);
  assert.doesNotMatch(stdout,/secret-value-123\n?.*loaded|loaded.*secret-value-123/);
  assert.ok(!stdout.split('\n').some(line=>line.includes('secret-value-123')&&!line.startsWith('AISSTREAM_API_KEY=')));
  assert.equal(mode,0o600);
});

test('a missing key file is not an error',()=>{
  const {status,exported}=load('',{create:false});
  assert.equal(status,0);
  assert.deepEqual(exported,{});
});
