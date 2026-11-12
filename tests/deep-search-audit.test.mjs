import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {appendDeepSearchAudit,auditEntry} from '../scripts/deep-search-audit.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('validates and appends private JSONL audit entries without credentials',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pd-audit-'));const file=join(dir,'audit.jsonl');
  const entry=await appendDeepSearchAudit(file,{target:'example.com',level:2,tools:['omega_ports'],outcome:'completed'},{now:new Date('2026-11-11T12:00:00Z')});
  assert.deepEqual(JSON.parse((await readFile(file,'utf8')).trim()),entry);
  assert.equal((await stat(file)).mode&0o077,0);
});
test('rejects malformed audit entries',()=>assert.throws(()=>auditEntry({target:'',level:9,tools:[],outcome:''}),/Invalid/));

test('reads the audit log newest first, skipping and counting damaged lines',async()=>{
  const {readDeepSearchAudit}=await import('../scripts/deep-search-audit.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-audit-read-'));
  const file=path.join(dir,'audit.jsonl');
  await appendDeepSearchAudit(file,{target:'example.com',level:0,tools:['whois_lookup'],outcome:'completed'},{now:new Date('2026-11-12T01:00:00Z')});
  fs.appendFileSync(file,'{not json\n');
  await appendDeepSearchAudit(file,{target:'8.8.8.8',level:1,tools:['get_bgp','omega_headers'],outcome:'cancelled'},{now:new Date('2026-11-12T02:00:00Z')});
  const read=await readDeepSearchAudit(file);
  assert.deepEqual(read.entries.map(e=>[e.target,e.outcome]),[['8.8.8.8','cancelled'],['example.com','completed']]);
  assert.equal(read.skipped,1);
  assert.equal(read.total,2);
  const limited=await readDeepSearchAudit(file,{limit:1});
  assert.deepEqual([limited.entries.length,limited.total],[1,2]);
});

test('a missing audit log reads as empty, not as an error',async()=>{
  const {readDeepSearchAudit}=await import('../scripts/deep-search-audit.mjs');
  assert.deepEqual(await readDeepSearchAudit(path.join(os.tmpdir(),'public-desk-no-such-audit.jsonl')),{entries:[],total:0,skipped:0});
});
