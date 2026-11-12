import {appendFile,chmod,mkdir,open,rename,stat,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomBytes} from 'node:crypto';

export const MAX_AUDIT_BYTES = 1_000_000;
const auditQueues = new Map();

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
  const maxBytes=options.maxBytes??MAX_AUDIT_BYTES;
  const run=async()=>{
    await mkdir(dirname(file),{recursive:true,mode:0o700});
    await appendFile(file,`${JSON.stringify(entry)}\n`,{encoding:'utf8',mode:0o600});
    await chmod(file,0o600);
    if((await stat(file)).size>maxBytes){
      const raw=await readAuditTail(file,maxBytes);
      const temporary=`${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      await writeFile(temporary,raw,{encoding:'utf8',mode:0o600});
      await chmod(temporary,0o600);
      await rename(temporary,file);
    }
    return entry;
  };
  const previous=auditQueues.get(file)||Promise.resolve();
  const current=previous.then(run,run);
  auditQueues.set(file,current);
  try{return await current;}finally{if(auditQueues.get(file)===current)auditQueues.delete(file);}
}

async function readAuditTail(file,maxBytes){
  const info=await stat(file);
  const start=Math.max(0,info.size-maxBytes);
  const length=info.size-start;
  const buffer=Buffer.alloc(length);
  const handle=await open(file,'r');
  try{await handle.read(buffer,0,length,start);}finally{await handle.close();}
  if(!start)return buffer.toString('utf8');
  const newline=buffer.indexOf(0x0a);
  return newline===-1?'':buffer.subarray(newline+1).toString('utf8');
}

// Reads the audit log for the Deep Search run history: newest first, at most `limit` entries. A damaged line is
// skipped and counted rather than hiding the rest of the log; a missing log reads as empty.
export async function readDeepSearchAudit(file, {limit = 200, maxBytes = MAX_AUDIT_BYTES} = {}) {
  let raw = '';
  try { raw = await readAuditTail(file,maxBytes); } catch (error) { if (error.code === 'ENOENT') return {entries: [], total: 0, skipped: 0}; throw error; }
  const entries = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { skipped++; }
  }
  entries.reverse();
  return {entries: entries.slice(0, limit), total: entries.length, skipped};
}
