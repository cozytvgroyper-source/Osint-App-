// Cases: investigations saved on this Mac under work/cases/, one JSON file per case, so saved findings survive a change
// of browser or cleared site data. Files are owner-only, writes are atomic (temporary file, then rename), and changes to
// one case run one at a time so quick successive saves cannot overwrite each other.
import {createHash,randomBytes} from 'node:crypto';
import {chmod,mkdir,readFile,readdir,rename,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildCaseReport,reportFilename} from './case-report.mjs';

export const MAX_EVIDENCE_BYTES=5_000_000;
export const MAX_CASE_BYTES=50_000_000;
const MAX_SEARCHES=200;
const CASE_ID=/^[0-9a-f]{16}$/;
const ITEM_ID=/^[0-9a-f]{12}$/;
// How far a finding has been checked. OSINT results are leads, so every finding starts unverified.
export const EVIDENCE_STATUSES=['unverified','confirmed','ruled out'];
const MAX_NOTE_CHARS=4000;

const fail=(code,message)=>Object.assign(new Error(message),{code});
const text=(value,max)=>String(value??'').trim().slice(0,max);
const bytes=value=>Buffer.byteLength(JSON.stringify(value));

function caseName(value){
  const name=String(value?.name??'').trim();
  if(!name||name.length>120)throw fail('CASE_INPUT','A case name must be 1 to 120 characters.');
  return name;
}
function caseId(id){
  if(!CASE_ID.test(String(id)))throw fail('CASE_INPUT','Unknown case id.');
  return id;
}

export class CaseStore{
  constructor(dir,{maxCaseBytes=MAX_CASE_BYTES}={}){
    this.dir=dir;
    this.maxCaseBytes=maxCaseBytes;
    this.queues=new Map();
  }

  file(id){return join(this.dir,`${caseId(id)}.json`);}

  async ensureDir(){
    await mkdir(this.dir,{recursive:true,mode:0o700});
    await chmod(this.dir,0o700);
  }

  async write(record){
    const size=bytes(record);
    if(size>this.maxCaseBytes)throw fail('CASE_TOO_LARGE',`A case may hold at most ${Math.round(this.maxCaseBytes/1_000_000)} MB.`);
    await this.ensureDir();
    const temporary=join(this.dir,`.${record.id}.${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(temporary,JSON.stringify(record),{mode:0o600});
    await chmod(temporary,0o600);
    await rename(temporary,this.file(record.id));
    return record;
  }

  async read(id){
    let raw;
    try{raw=await readFile(this.file(id),'utf8');}
    catch(error){if(error.code==='ENOENT')throw fail('CASE_NOT_FOUND','This case no longer exists.');throw error;}
    try{return JSON.parse(raw);}
    catch{throw fail('CASE_DAMAGED','This case file is damaged and could not be read.');}
  }

  // Runs changes to one case one after another. Deleting runs in the same line, so a change waiting behind a delete
  // finds the case gone (CASE_NOT_FOUND) instead of writing it back.
  async change(id,update,{remove=false}={}){
    caseId(id);
    const previous=this.queues.get(id)||Promise.resolve();
    const next=previous.catch(()=>{}).then(async()=>{
      const record=await this.read(id);const result=await update(record);
      if(remove)await unlink(this.file(id));else await this.write({...record,updatedAt:new Date().toISOString()});
      return result;
    });
    this.queues.set(id,next);
    return next.finally(()=>{if(this.queues.get(id)===next)this.queues.delete(id);});
  }

  async list(){
    let names=[];
    try{names=await readdir(this.dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const cases=[];
    for(const name of names.filter(name=>/^[0-9a-f]{16}\.json$/.test(name))){
      const id=name.slice(0,16);
      try{
        const record=await this.read(id);
        cases.push({id,name:record.name,createdAt:record.createdAt,updatedAt:record.updatedAt,evidenceCount:record.evidence?.length||0,searchCount:record.searches?.length||0});
      }catch(error){
        if(error.code!=='CASE_DAMAGED')throw error;
        cases.push({id,name:'Damaged case file',damaged:true});
      }
    }
    return cases.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  }

  async create(value,{now=new Date()}={}){
    const time=now.toISOString();
    return this.write({version:1,id:randomBytes(8).toString('hex'),name:caseName(value),createdAt:time,updatedAt:time,evidence:[],searches:[]});
  }

  async get(id){return this.read(caseId(id));}

  async rename(id,value){
    const name=caseName(value);
    return this.change(id,record=>{record.name=name;return record;}).then(()=>this.get(id));
  }

  async remove(id){
    await this.change(id,()=>null,{remove:true});
  }

  async addEvidence(id,value,{now=new Date()}={}){
    const title=text(value?.title,300);
    if(!title||!('result' in Object(value)))throw fail('CASE_INPUT','Evidence needs a title and a result.');
    const item={
      id:randomBytes(6).toString('hex'),title,result:value.result,time:text(value.time,40)||now.toISOString(),
      server:text(value.server,200),savedAt:now.toISOString(),sha256:createHash('sha256').update(JSON.stringify(value.result)).digest('hex'),
      status:'unverified',note:''
    };
    if(bytes(item)>MAX_EVIDENCE_BYTES)throw fail('CASE_TOO_LARGE',`One finding may be at most ${MAX_EVIDENCE_BYTES/1_000_000} MB.`);
    return this.change(id,record=>{record.evidence=[...(record.evidence||[]),item];return item;});
  }

  async removeEvidence(id,itemId){
    if(!ITEM_ID.test(String(itemId)))throw fail('CASE_INPUT','Unknown evidence id.');
    return this.change(id,record=>{
      const kept=(record.evidence||[]).filter(item=>item.id!==itemId);
      if(kept.length===(record.evidence||[]).length)throw fail('CASE_NOT_FOUND','That finding is no longer in this case.');
      record.evidence=kept;
    });
  }

  async updateEvidence(id,itemId,value){
    if(!ITEM_ID.test(String(itemId)))throw fail('CASE_INPUT','Unknown evidence id.');
    const changes={};
    if(value&&'status' in value){
      if(!EVIDENCE_STATUSES.includes(value.status))throw fail('CASE_INPUT',`Status must be one of: ${EVIDENCE_STATUSES.join(', ')}.`);
      changes.status=value.status;
    }
    if(value&&'note' in value){
      const note=String(value.note??'').trim();
      if(note.length>MAX_NOTE_CHARS)throw fail('CASE_INPUT',`A note may be at most ${MAX_NOTE_CHARS} characters.`);
      changes.note=note;
    }
    return this.change(id,record=>{
      const item=(record.evidence||[]).find(entry=>entry.id===itemId);
      if(!item)throw fail('CASE_NOT_FOUND','That finding is no longer in this case.');
      Object.assign(item,changes);
      return {...item};
    });
  }

  async addSearch(id,value){
    const search={title:text(value?.title,300),time:text(value?.time,40)||new Date().toISOString(),server:text(value?.server,200)};
    if(!search.title)throw fail('CASE_INPUT','A search needs a title.');
    return this.change(id,record=>{record.searches=[search,...(record.searches||[])].slice(0,MAX_SEARCHES);return search;});
  }
}

// The /api/cases routes. Returns {status, body}, or null for a path or method that is not a case route. All routes are
// same-origin only (server.mjs's request guard); every write is a POST, like the rest of Public Desk's API.
const CASE_ROUTE=/^\/api\/cases(?:\/([0-9a-f]{16})(?:\/(rename|delete|evidence|searches|report\.md|report\.html)(?:\/([0-9a-f]{12})\/(delete|update))?)?)?$/;
export async function handleCaseRequest(store,method,pathname,readBody){
  const match=pathname.match(CASE_ROUTE);
  if(!match)return null;
  const [,id,action,itemId,itemAction]=match;
  const ok=body=>({status:200,body});
  if(!id){
    if(method==='GET')return ok({cases:await store.list()});
    if(method==='POST')return ok(await store.create(await readBody()));
    return null;
  }
  if(!action)return method==='GET'?ok(await store.get(id)):null;
  if(action.startsWith('report.')){
    if(method!=='GET'||itemId)return null;
    const record=await store.get(id),markdown=action==='report.md';
    return {status:200,raw:buildCaseReport(record,{format:markdown?'markdown':'html'}),contentType:markdown?'text/markdown; charset=utf-8':'text/html; charset=utf-8',filename:reportFilename(record.name,markdown?'md':'html')};
  }
  if(method!=='POST')return null;
  if(action==='rename')return ok(await store.rename(id,await readBody()));
  if(action==='delete'){await store.remove(id);return ok({deleted:true});}
  if(action==='searches')return ok(await store.addSearch(id,await readBody()));
  if(action==='evidence'&&itemAction==='delete'){await store.removeEvidence(id,itemId);return ok({removed:true});}
  if(action==='evidence'&&itemAction==='update')return ok(await store.updateEvidence(id,itemId,await readBody()));
  if(action==='evidence'&&!itemId)return ok(await store.addEvidence(id,await readBody()));
  return null;
}
