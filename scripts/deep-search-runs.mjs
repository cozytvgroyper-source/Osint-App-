import {randomBytes} from 'node:crypto';
import {chmod,lstat,mkdir,readFile,readdir,rename,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const MAX_DEEP_RUN_BYTES=25_000_000;
const RUN_ID=/^[a-z0-9-]{8,64}$/;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const bytes=value=>Buffer.byteLength(JSON.stringify(value));

// Every change to one results folder (save, delete, delete all) runs one at a time, in the order asked, whichever store
// object asked. Delete all from another tab used to remove a save's temporary file mid-write, so the save failed and
// that search's results were lost; now the save finishes first and Delete all then removes it.
const folderQueues=new Map();
async function queued(dir,work){
  const previous=folderQueues.get(dir)||Promise.resolve();
  const current=previous.then(work,work);
  folderQueues.set(dir,current);
  try{return await current;}finally{if(folderQueues.get(dir)===current)folderQueues.delete(dir);}
}

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
    return queued(this.dir,async()=>{
      await this.ensureDir();
      const temporary=join(this.dir,`.${id}.${randomBytes(6).toString('hex')}.tmp`);
      try{
        await writeFile(temporary,JSON.stringify(run),{mode:0o600});
        await chmod(temporary,0o600);
        await rename(temporary,this.file(id));
      }catch(error){
        // A temporary file holds a full copy of the results; never leave one behind.
        await unlink(temporary).catch(()=>{});
        throw error;
      }
      return{id};
    });
  }
  async read(id){
    let raw;
    try{raw=await readFile(this.file(id),'utf8');}
    catch(error){if(error.code==='ENOENT')throw fail('DEEP_RUN_NOT_FOUND','These Deep Search results no longer exist.');throw error;}
    try{return JSON.parse(raw);}catch{throw fail('DEEP_RUN_DAMAGED','This Deep Search result file is damaged.');}
  }
  // Deletes one run's results. Returns false when there was nothing to delete (older runs may have no file).
  async remove(id){
    const file=this.file(id);
    return queued(this.dir,async()=>{
      try{await unlink(file);return true;}
      catch(error){if(error.code==='ENOENT')return false;throw error;}
    });
  }
  // Deletes the results files whose run listedIds() does not name, and temporary copies left by a crash. listedIds runs
  // inside this folder's queue, after every save asked for before it, so a run saved just now is already listed.
  // Nothing is deleted when it gives null (nothing known about which runs are listed). Returns how many were removed.
  async removeUnlisted(listedIds){
    return queued(this.dir,async()=>{
      const listed=await listedIds();
      if(!listed)return 0;
      let names;
      try{names=await readdir(this.dir);}catch(error){if(error.code==='ENOENT')return 0;throw error;}
      let removed=0;
      for(const name of names){
        const result=name.match(/^([a-z0-9-]{8,64})\.json$/);
        if(!(result&&!listed.has(result[1]))&&!/^\..*\.tmp$/.test(name))continue;
        const path=join(this.dir,name);
        try{
          if(!(await lstat(path)).isFile())continue;
          await unlink(path);removed++;
        }catch(error){if(error.code!=='ENOENT')throw error;}
      }
      return removed;
    });
  }
  // Deletes every saved, temporary or orphaned results file. Returns how many files were removed.
  async removeAll(){return queued(this.dir,()=>this.removeAllNow());}
  async removeAllNow(){
    let names;
    try{names=await readdir(this.dir);}catch(error){if(error.code==='ENOENT')return 0;throw error;}
    let removed=0;
    for(const name of names){
      if(!/\.(?:json|tmp)$/.test(name))continue;
      const path=join(this.dir,name);
      // A file can vanish between readdir and here (removed by hand, or by another copy of the server):
      // that is "already gone", not a failure.
      try{
        if(!(await lstat(path)).isFile())continue;
        await unlink(path);removed++;
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return removed;
  }
}
