import {appendFile,chmod,mkdir,readFile} from 'node:fs/promises';
import {dirname} from 'node:path';

export function auditEntry(value, now = new Date()) {
  const target=String(value?.target||'').trim().slice(0,500);
  const level=Number(value?.level);
  const tools=Array.isArray(value?.tools)?value.tools.map(item=>String(item).slice(0,160)).filter(Boolean).slice(0,25):[];
  const outcome=String(value?.outcome||'').trim().slice(0,80);
  if(!target||!Number.isInteger(level)||level<0||level>3||!tools.length||!outcome)throw Object.assign(new Error('Invalid Deep Search audit entry'),{code:'AUDIT_INPUT'});
  return {time:now.toISOString(),target,level,tools,outcome};
}

export async function appendDeepSearchAudit(file, value, options={}) {
  const entry=auditEntry(value,options.now);
  await mkdir(dirname(file),{recursive:true,mode:0o700});
  await appendFile(file,`${JSON.stringify(entry)}\n`,{encoding:'utf8',mode:0o600});
  await chmod(file,0o600);
  return entry;
}

// Reads the audit log for the Deep Search run history: newest first, at most `limit` entries. A damaged line is
// skipped and counted rather than hiding the rest of the log; a missing log reads as empty.
export async function readDeepSearchAudit(file, {limit = 200} = {}) {
  let raw = '';
  try { raw = await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return {entries: [], total: 0, skipped: 0}; throw error; }
  const entries = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { skipped++; }
  }
  entries.reverse();
  return {entries: entries.slice(0, limit), total: entries.length, skipped};
}
