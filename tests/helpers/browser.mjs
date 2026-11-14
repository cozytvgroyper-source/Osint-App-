// Real-browser tests without dependencies: starts a throwaway Public Desk server (stand-in data, temporary work folder)
// and the Google Chrome already installed, then drives Chrome through its built-in DevTools protocol over a WebSocket.
// Nothing is downloaded. If Chrome isn't installed, findChrome() returns '' and the browser tests skip themselves.
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../..',import.meta.url));
const FIXTURES=fileURLToPath(new URL('../fixtures/deep/',import.meta.url));

export function findChrome(){
  const candidates=[process.env.PUBLIC_DESK_CHROME,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean);
  for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
    const found=spawnSync('/bin/sh',['-c',`command -v ${name}`],{encoding:'utf8'}).stdout.trim();
    if(found)candidates.push(found);
  }
  return candidates.find(candidate=>fs.existsSync(candidate))||'';
}

async function freePort(){
  const server=net.createServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const {port}=server.address();
  await new Promise(resolve=>server.close(resolve));
  return port;
}

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// A Public Desk server on a free port, with its own temporary work folder holding two stand-in Deep Search runs.
export async function startServer(){
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-browser-'));
  const runs=path.join(work,'deep-search-runs');fs.mkdirSync(runs,{recursive:true});
  const audit=[];
  for(const [file,time] of [['run-person.json','2026-11-13T10:00:00.000Z'],['run-site.json','2026-11-13T11:00:00.000Z']]){
    const run=JSON.parse(fs.readFileSync(path.join(FIXTURES,file),'utf8'));
    fs.writeFileSync(path.join(runs,`${run.id}.json`),JSON.stringify(run));
    audit.push(JSON.stringify({time,target:run.target.value,level:run.level,tools:['stand_in_tool'],toolCount:1,outcome:run.outcome,runId:run.id}));
  }
  fs.writeFileSync(path.join(work,'deep-search-audit.jsonl'),audit.join('\n')+'\n');
  const port=await freePort();const token=randomBytes(24).toString('hex');
  const child=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env:{...process.env,PORT:String(port),PUBLIC_DESK_TOKEN:token,PUBLIC_DESK_WORK_DIR:work},stdio:'ignore'});
  const base=`http://127.0.0.1:${port}`;
  for(let attempt=0;;attempt++){
    try{if((await fetch(`${base}/`)).ok)break;}catch{}
    if(attempt>100)throw new Error('The test server did not start');
    await wait(50);
  }
  return {url:`${base}/#access=${token}`,base,work,
    async stop(){if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}fs.rmSync(work,{recursive:true,force:true});}};
}

// One headless Chrome with a fresh, temporary profile, and one page in it.
export async function startBrowser(){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-chrome-'));
  const chrome=spawn(findChrome(),['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run',
    '--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions',
    '--mute-audio','--window-size=1280,900','about:blank'],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{
    let text='';const timer=setTimeout(()=>reject(new Error('Chrome did not start')),15000);
    chrome.stderr.on('data',chunk=>{text+=chunk;const match=text.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    chrome.once('exit',code=>{clearTimeout(timer);reject(new Error(`Chrome exited (${code})`));});
  });
  const socket=new WebSocket(endpoint);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=()=>reject(new Error('Could not reach Chrome'));});
  let nextId=0;const pending=new Map();const listeners=[];
  socket.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.id&&pending.has(message.id)){const {resolve,reject}=pending.get(message.id);pending.delete(message.id);
      message.error?reject(new Error(message.error.message)):resolve(message.result);return;}
    for(const listener of listeners)listener(message);
  };
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const page=(method,params)=>send(method,params,sessionId);
  // Uncaught errors and unhandled promise rejections in the page are collected; a test fails on any of them.
  const errors=[];
  listeners.push(message=>{
    if(message.sessionId===sessionId&&message.method==='Runtime.exceptionThrown'){
      const details=message.params.exceptionDetails;errors.push(details.exception?.description||details.text);
    }
  });
  await page('Page.enable');await page('Runtime.enable');
  const evaluate=async(expression)=>{
    const {result,exceptionDetails}=await page('Runtime.evaluate',{expression:`(async()=>{${expression}})()`,awaitPromise:true,returnByValue:true});
    if(exceptionDetails)throw new Error(`In the page: ${exceptionDetails.exception?.description||exceptionDetails.text}`);
    return result.value;
  };
  return {
    errors,evaluate,
    // Runs before the page's own scripts on every load (for example, to block browser storage).
    beforeLoad:source=>page('Page.addScriptToEvaluateOnNewDocument',{source}),
    async open(url){
      await page('Page.navigate',{url});
      await this.waitFor("return document.readyState==='complete'&&!!document.querySelector('[data-view]')");
      await wait(400);
    },
    async waitFor(condition,{timeout=8000,label=condition}={}){
      const end=Date.now()+timeout;
      while(Date.now()<end){if(await evaluate(condition).catch(()=>false))return;await wait(80);}
      throw new Error(`Timed out waiting for: ${label}`);
    },
    setSize:(width,height)=>page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768}),
    // A real key press, so focus moves exactly as it does for a person using the keyboard.
    async press(key){
      const code={Tab:'Tab',Enter:'Enter',Escape:'Escape'}[key]||key;const keyCode={Tab:9,Enter:13,Escape:27}[key]||0;
      await page('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode});
      await page('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode});
    },
    async close(){
      try{await send('Browser.close');}catch{}
      socket.close();
      if(chrome.exitCode===null)await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),wait(3000).then(()=>chrome.kill('SIGKILL'))]);
      fs.rmSync(profile,{recursive:true,force:true});
    }
  };
}

// A stand-in MCP server inside the page: answers the app's /api/mcp calls for the OSINT Toolbox endpoint only, so tool
// lists, tool runs, failures and slow answers can be tested without any real tool server. Every other request passes on.
export const STUB_MCP=`
  const realFetch=window.fetch;
  window.__mcp={slowMs:300,fail:'',calls:[]};
  const schema=name=>({type:'object',properties:{[name]:{type:'string'}},required:[name]});
  const tools=[{name:'holehe_email_search',description:'Email account check',inputSchema:schema('email')},
    {name:'whois_lookup',description:'Domain registration',inputSchema:schema('query')}];
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  window.fetch=async(url,options={})=>{
    if(!String(url).endsWith('/api/mcp'))return realFetch(url,options);
    const body=JSON.parse(options.body||'{}');window.__mcp.calls.push(body.method+':'+(body.params?.name||''));
    if(body.endpoint!=='http://127.0.0.1:8893/mcp')return reply(502,{error:'Not running'});
    if(body.method==='tools/list')return reply(200,{jsonrpc:'2.0',id:body.id,result:{tools}});
    if(body.method==='tools/call'){
      if(window.__mcp.fail)return reply(502,{error:window.__mcp.fail});
      await new Promise(resolve=>setTimeout(resolve,window.__mcp.slowMs));
      const text=body.params.name==='holehe_email_search'?'[+] github.com':'Domain: example.com';
      return reply(200,{jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text}],isError:false}});
    }
    return reply(200,{jsonrpc:'2.0',id:body.id,result:{}});
  };`;
