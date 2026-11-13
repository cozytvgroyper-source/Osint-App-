import {randomUUID} from 'node:crypto';
import {chmod,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {classifyToolResult} from '../public/result-classifier.js';
import {deepArgs,deepToolsFor,detectDeepTarget} from '../public/deep-search.js';

const APP_ORIGIN='http://127.0.0.1:4173';
const TOKEN_FILE=fileURLToPath(new URL('../work/runtime/public-desk-token',import.meta.url));
const FIXTURE_DIR=fileURLToPath(new URL('../tests/fixtures/deep/',import.meta.url));
const RAW_DIR=fileURLToPath(new URL('../tests/fixtures/deep/raw/',import.meta.url));
const ENDPOINTS=Object.freeze([
  {serverName:'Open OSINT',endpoint:'http://127.0.0.1:8892/mcp',sessionKey:'deep-recorder-open'},
  {serverName:'OSINT Toolbox',endpoint:'http://127.0.0.1:8893/mcp',sessionKey:'deep-recorder-toolbox'},
  {serverName:'Omega MCP',endpoint:'http://127.0.0.1:8894/mcp',sessionKey:'deep-recorder-omega'}
]);
const STAND_INS=Object.freeze({
  email:'owner@example.com',username:'ownername',phone:'+15555550100',domain:'owner-site.example',ip:'192.0.2.10'
});

function usage(message=''){
  if(message)console.error(message);
  console.error('Usage: node scripts/record-deep-fixtures.mjs --email E --username U [--phone P] --domain D --ip I --level 3 [--domain-level 0]');
  process.exitCode=2;
}

function parseArgs(argv){
  const out={};
  for(let index=0;index<argv.length;index+=1){
    const key=argv[index];
    if(!key.startsWith('--')||index+1>=argv.length)throw new Error(`Invalid argument ${key}`);
    out[key.slice(2)]=argv[index+=1];
  }
  return out;
}

function requireIdentifier(type,value){
  const found=detectDeepTarget(value);
  if(!found||found.type!==type)throw new Error(`${type} must be one exact Deep Search identifier`);
  return found;
}

function escapePattern(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

function sanitizersFor(identifiers){
  const replacements=[];
  for(const identifier of identifiers){
    const standIn=STAND_INS[identifier.type];
    if(!standIn)continue;
    replacements.push([identifier.value,standIn]);
    if(identifier.type==='username')replacements.push([`@${identifier.value}`,`@${standIn}`]);
    if(identifier.type==='phone'){
      const digits=identifier.value.replace(/\D/g,'');
      replacements.push([digits,standIn.replace(/\D/g,'')]);
    }
  }
  return replacements.sort((a,b)=>b[0].length-a[0].length)
    .map(([from,to])=>[new RegExp(escapePattern(from),'gi'),to]);
}

const PERSON_TYPES=new Set(['email','username','phone']);

function sanitizePersonObject(value){
  if(Array.isArray(value))return value.map(sanitizePersonObject);
  if(!value||typeof value!=='object')return value;
  const out={};
  for(const [key,child] of Object.entries(value)){
    if(typeof child==='string'){
      if(/^(?:full_?name|display_?name|real_?name|first_?name|last_?name)$/i.test(key)){out[key]='Owner Example';continue;}
      if(/^(?:bio|about|description)$/i.test(key)){out[key]='Example profile biography.';continue;}
      if(/^(?:location|address|city)$/i.test(key)){out[key]='Example City';continue;}
      if(/^(?:uid|user_?id|account_?id)$/i.test(key)){out[key]='example-id';continue;}
      if(/^(?:image|image_bg|avatar|profile_?image|banner)$/i.test(key)){out[key]='https://example.com/avatar.jpg';continue;}
      if(/^(?:links?|website)$/i.test(key)){out[key]='https://example.com/linked-profile';continue;}
      if(key==='text'){
        try{
          const nested=JSON.parse(child);
          out[key]=JSON.stringify(sanitizePersonObject(nested),null,2);
          continue;
        }catch{}
      }
    }
    out[key]=sanitizePersonObject(child);
  }
  return out;
}

function sanitizedCopy(value,replacements,emailAliases=new Map()){
  const text=JSON.stringify(value);
  const placeholders=replacements.map(([,replacement],index)=>[`__DEEP_PRIVATE_${index}__`,replacement]);
  let clean=text;
  replacements.forEach(([pattern],index)=>{clean=clean.replace(pattern,placeholders[index][0]);});
  placeholders.forEach(([placeholder,replacement])=>{clean=clean.replaceAll(placeholder,replacement);});
  clean=clean.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,email=>{
    if(email.toLowerCase()==='owner@example.com')return'owner@example.com';
    const key=email.toLowerCase();
    if(!emailAliases.has(key))emailAliases.set(key,`lead${emailAliases.size+1}@example.net`);
    return emailAliases.get(key);
  });
  const parsed=JSON.parse(clean);
  return PERSON_TYPES.has(parsed?.identifier?.type)?sanitizePersonObject(parsed):parsed;
}

function slug(value){return String(value).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}

async function post(path,payload,token){
  const response=await fetch(`${APP_ORIGIN}${path}`,{
    method:'POST',
    headers:{'content-type':'application/json','x-public-desk-token':token,origin:APP_ORIGIN},
    body:JSON.stringify(payload)
  });
  const data=await response.json().catch(()=>({error:`Public Desk returned ${response.status}`}));
  if(!response.ok)throw new Error(data.error||`Public Desk returned ${response.status}`);
  return data;
}

async function connectedTools(token){
  const groups=await Promise.all(ENDPOINTS.map(async server=>{
    const response=await post('/api/mcp',{
      endpoint:server.endpoint,sessionKey:server.sessionKey,method:'tools/list',params:{},initialize:true
    },token);
    if(response.error)throw new Error(`${server.serverName}: ${response.error.message||'could not list tools'}`);
    return (response.result?.tools||[]).map(tool=>({...tool,serverName:server.serverName,endpoint:server.endpoint,sessionKey:server.sessionKey}));
  }));
  return groups.flat();
}

async function grantFor(item,identifier,args,runId,token){
  if(item.risk.level===0)return null;
  return post('/api/run-grants',{
    purpose:'deep-search',target:identifier.value,level:item.risk.level,runId,ttlMs:30*60_000,
    tools:[{endpoint:item.tool.endpoint,name:item.tool.name,arguments:args}],
    confirmation:{acknowledged:true,authorization:true,typedTarget:identifier.value}
  },token);
}

async function callOne(item,identifier,args,grant,token){
  const started=Date.now();
  try{
    const response=await post('/api/mcp',{
      endpoint:item.tool.endpoint,sessionKey:item.tool.sessionKey,method:'tools/call',
      params:{name:item.tool.name,arguments:args},runGrant:grant?.token||'',runTarget:grant?identifier.value:'',
      deepSearch:true,timeoutMs:item.timeoutMs
    },token);
    const result=response.error?{isError:true,content:[{type:'text',text:response.error.message||'Tool call failed'}]}:response.result;
    return {result,ms:Date.now()-started,outcome:classifyToolResult(result).kind};
  }catch(error){
    const result={isError:true,content:[{type:'text',text:String(error?.message||error)}]};
    return {result,ms:Date.now()-started,outcome:'error'};
  }
}

async function writePrivate(path,value){
  await writeFile(path,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});
  await chmod(path,0o600);
}

async function main(){
  let options;
  try{options=parseArgs(process.argv.slice(2));}catch(error){usage(error.message);return;}
  for(const key of ['email','username','domain','ip'])if(!options[key]){usage(`Missing --${key}`);return;}
  const level=Number(options.level??3);
  const domainLevel=Number(options['domain-level']??level);
  if(!Number.isInteger(level)||level<0||level>3||!Number.isInteger(domainLevel)||domainLevel<0||domainLevel>3){usage('Levels must be 0, 1, 2, or 3');return;}

  let identifiers;
  try{
    identifiers=[requireIdentifier('email',options.email),requireIdentifier('username',options.username)];
    if(options.phone)identifiers.push(requireIdentifier('phone',options.phone));
    identifiers.push(requireIdentifier('domain',options.domain),requireIdentifier('ip',options.ip));
  }catch(error){usage(error.message);return;}

  const token=(await readFile(TOKEN_FILE,'utf8')).trim();
  if(!token)throw new Error('The Public Desk access token is missing. Start Public Desk first.');
  await mkdir(FIXTURE_DIR,{recursive:true,mode:0o700});
  await mkdir(RAW_DIR,{recursive:true,mode:0o700});
  await chmod(RAW_DIR,0o700);

  const replacements=sanitizersFor(identifiers);
  const emailAliases=new Map();
  if(options['sanitize-existing']==='yes'){
    const rawFiles=(await readdir(RAW_DIR)).filter(file=>file.endsWith('.json'));
    for(const file of rawFiles){
      const fixture=JSON.parse(await readFile(`${RAW_DIR}/${file}`,'utf8'));
      await writePrivate(`${FIXTURE_DIR}/${file}`,sanitizedCopy(fixture,replacements,emailAliases));
    }
    console.log(`Re-sanitized ${rawFiles.length} existing fixture${rawFiles.length===1?'':'s'}.`);
    return;
  }
  const tools=await connectedTools(token);
  const runId=`fixture-${randomUUID()}`;
  const summary=[];
  try{
    for(const identifier of identifiers){
      const requestedLevel=identifier.type==='domain'?domainLevel:level;
      const selected=deepToolsFor(tools,{type:identifier.type,level:requestedLevel})
        .filter(item=>!options.only||item.tool.name===options.only);
      for(const item of selected){
        const args=deepArgs(item.tool,identifier);
        const grant=await grantFor(item,identifier,args,runId,token);
        const answer=await callOne(item,identifier,args,grant,token);
        const fixture={tool:item.tool.name,serverName:item.tool.serverName,identifier,args,ms:answer.ms,result:answer.result};
        const file=`${slug(item.tool.serverName)}--${slug(item.tool.name)}--${identifier.type}.json`;
        await writePrivate(`${RAW_DIR}/${file}`,fixture);
        const clean=sanitizedCopy(fixture,replacements,emailAliases);
        await writePrivate(`${FIXTURE_DIR}/${file}`,clean);
        summary.push({tool:item.tool.name,server:item.tool.serverName,type:identifier.type,ms:answer.ms,bytes:Buffer.byteLength(JSON.stringify(answer.result)),outcome:answer.outcome});
      }
    }
  }finally{
    await post('/api/run-grants/release',{runId},token).catch(()=>{});
  }
  console.table(summary);
  console.log(`Recorded ${summary.length} sanitized fixture${summary.length===1?'':'s'}.`);
}

main().catch(error=>{console.error(error.message||error);process.exitCode=1;});
