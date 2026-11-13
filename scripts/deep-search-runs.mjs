import {randomBytes} from 'node:crypto';
import {chmod,lstat,mkdir,readFile,readdir,rename,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const MAX_DEEP_RUN_BYTES=25_000_000;
const RUN_ID=/^[a-z0-9-]{8,64}$/;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const bytes=value=>Buffer.byteLength(JSON.stringify(value));

function validId(value){
  const id=String(value||'');
  if(!RUN_ID.test(id))throw fail('DEEP_RUN_INPUT','Deep Search run id is invalid.');
  return id;
}

export class DeepRunStore{
  constructor(dir,{maxBytes=MAX_DEEP_RUN_BYTES}={}){this.dir=dir;this.maxBytes=maxBytes;}
  file(id){return join(this.dir,`${validId(id)}.json`);}
  async ensureDir(){await mkdir(this.dir,{recursive:true,mode:0o700});await chmod(this.dir,0o700);}
  async save(run){
    const id=validId(run?.id);
    if(bytes(run)>this.maxBytes)throw fail('DEEP_RUN_TOO_LARGE','Deep Search result is too large to keep.');
    await this.ensureDir();
    const temporary=join(this.dir,`.${id}.${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(temporary,JSON.stringify(run),{mode:0o600});
    await chmod(temporary,0o600);
    await rename(temporary,this.file(id));
    return{id};
  }
  async read(id){
    let raw;
    try{raw=await readFile(this.file(id),'utf8');}
    catch(error){if(error.code==='ENOENT')throw fail('DEEP_RUN_NOT_FOUND','These Deep Search results no longer exist.');throw error;}
    try{return JSON.parse(raw);}catch{throw fail('DEEP_RUN_DAMAGED','This Deep Search result file is damaged.');}
  }
  // Deletes one run's results. Returns false when there was nothing to delete (older runs may have no file).
  async remove(id){
    try{await unlink(this.file(id));return true;}
    catch(error){if(error.code==='ENOENT')return false;throw error;}
  }
  // Deletes every saved, temporary or orphaned results file. Returns how many files were removed.
  async removeAll(){
    let names;
    try{names=await readdir(this.dir);}catch(error){if(error.code==='ENOENT')return 0;throw error;}
    let removed=0;
    for(const name of names){
      if(!/\.(?:json|tmp)$/.test(name))continue;
      const path=join(this.dir,name);
      // A file can vanish between readdir and here (another Delete all, or a save renaming its temp file):
      // that is "already gone", not a failure.
      try{
        if(!(await lstat(path)).isFile())continue;
        await unlink(path);removed++;
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return removed;
  }
}
