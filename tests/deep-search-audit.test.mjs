import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {appendDeepSearchAudit,auditEntry} from '../scripts/deep-search-audit.mjs';
test('validates and appends private JSONL audit entries without credentials',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pd-audit-'));const file=join(dir,'audit.jsonl');
  const entry=await appendDeepSearchAudit(file,{target:'example.com',level:2,tools:['omega_ports'],outcome:'completed'},{now:new Date('2026-11-11T12:00:00Z')});
  assert.deepEqual(JSON.parse((await readFile(file,'utf8')).trim()),entry);
  assert.equal((await stat(file)).mode&0o077,0);
});
test('rejects malformed audit entries',()=>assert.throws(()=>auditEntry({target:'',level:9,tools:[],outcome:''}),/Invalid/));
