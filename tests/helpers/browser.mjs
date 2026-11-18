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
// Chrome can briefly recreate profile files after its main process exits, especially on Node 22 macOS runners. Retry
// that expected race; if Chrome outlasts the retries, leave the throwaway folder for macOS instead of stranding the
// test server and hanging the entire suite.
const removeTemporaryTree=async root=>{
  for(let attempt=0;attempt<30;attempt++){
    try{fs.rmSync(root,{recursive:true,force:true});return;}
    catch(error){
      if(!['EBUSY','ENOTEMPTY','EPERM'].includes(error?.code))throw error;
      await wait(100);
    }
  }
};

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
  const openCodes=path.join(work,'open-code');
  const child=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env:{...process.env,PORT:String(port),PUBLIC_DESK_TOKEN:token,PUBLIC_DESK_WORK_DIR:work,PUBLIC_DESK_OPEN_CODE_FILE:openCodes},stdio:'ignore'});
  const base=`http://127.0.0.1:${port}`;
  for(let attempt=0;;attempt++){
    try{if((await fetch(`${base}/`)).ok)break;}catch{}
    if(attempt>100)throw new Error('The test server did not start');
    await wait(50);
  }
  return {url:`${base}/#access=${token}`,base,work,token,
    // A link like the launcher opens in a browser: a fresh open code (as public-desk-control.zsh writes it), not the token.
    openLink({ageSeconds=0}={}){
      const code=randomBytes(32).toString('base64url');
      fs.appendFileSync(openCodes,`${code} ${Math.floor(Date.now()/1000)-ageSeconds}\n`,{mode:0o600});
      return `${base}/#open=${code}`;
    },
    async stop(){if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}fs.rmSync(work,{recursive:true,force:true});}};
}

// What the page shows, in one line, for a timed-out wait.
const PAGE_SNAPSHOT=`const text=element=>(element?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,200);
  const active=document.activeElement;
  return JSON.stringify({
    view:document.querySelector('[data-view][aria-current="page"]')?.dataset.view||'',
    dialogs:[...document.querySelectorAll('dialog[open]')].map(dialog=>dialog.id+': '+text(dialog)),
    toast:text(document.getElementById('toast')),
    announced:[...document.querySelectorAll('[role="status"],[aria-live]')].map(text).filter(Boolean).slice(0,6),
    focus:active?(active.id?'#'+active.id:active.tagName.toLowerCase())+(text(active)?' "'+text(active).slice(0,40)+'"':''):''
  });`;

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
  // The page's recent console errors and warnings, reported when a wait times out.
  const consoleLines=[];
  listeners.push(message=>{
    if(message.sessionId===sessionId&&message.method==='Runtime.exceptionThrown'){
      const details=message.params.exceptionDetails;errors.push(details.exception?.description||details.text);
    }
    if(message.sessionId===sessionId&&message.method==='Runtime.consoleAPICalled'&&['error','warning','warn'].includes(message.params.type)){
      consoleLines.push(`${message.params.type}: ${message.params.args.map(arg=>arg.value??arg.description??'').join(' ')}`.slice(0,300));
      if(consoleLines.length>10)consoleLines.shift();
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
    // On a timeout the error also describes the page, so a failure on CI says what the page showed instead of
    // only what never appeared: open dialogs, the latest message, live announcements, focus and console errors.
    async waitFor(condition,{timeout=8000,label=condition}={}){
      const end=Date.now()+timeout;
      while(Date.now()<end){if(await evaluate(condition).catch(()=>false))return;await wait(80);}
      const snapshot=await evaluate(PAGE_SNAPSHOT).catch(error=>`(could not read the page: ${error.message})`);
      throw new Error(`Timed out waiting for: ${label}\n  Page: ${snapshot}${consoleLines.length?`\n  Console: ${consoleLines.join(' | ')}`:''}${errors.length?`\n  Page errors: ${errors.join(' | ')}`:''}`);
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
      const exited=()=>chrome.exitCode===null?new Promise(resolve=>chrome.once('exit',resolve)):Promise.resolve();
      if(chrome.exitCode===null)await Promise.race([exited(),wait(3000)]);
      if(chrome.exitCode===null){chrome.kill('SIGKILL');await Promise.race([exited(),wait(3000)]);}
      await removeTemporaryTree(profile);
    }
  };
}

// A stand-in MCP server inside the page: answers the app's /api/mcp calls for the OSINT Toolbox endpoint and for a few
// Open OSINT tools, so tool lists, tool runs, failures and slow answers can be tested without any real tool server.
// Open OSINT answers come from window.__mcp.answers[tool] (stand-in data set by each test; {items:[]} when unset), after
// window.__mcp.delays[tool] milliseconds (100 when unset). Every other request passes on.
export const STUB_MCP=`
  const realFetch=window.fetch;
  window.__mcp={slowMs:300,fail:'',calls:[],answers:{},delays:{}};
  const schema=name=>({type:'object',properties:{[name]:{type:'string'}},required:[name]});
  const tools=[{name:'holehe_email_search',description:'Email account check',inputSchema:schema('email')},
    {name:'whois_lookup',description:'Domain registration',inputSchema:schema('query')}];
  const osint=[['get_wikidata','Wikidata entity lookup'],['get_news_rss','News headlines from RSS feeds'],['get_gdelt','GDELT news articles'],
    ['get_opensanctions','Sanctions lists'],['get_offshore_leaks','Offshore Leaks records'],['get_opencorporates','Company registers'],
    ['get_sec_filings','SEC filings']].map(([name,description])=>({name,description,inputSchema:name==='get_news_rss'?{type:'object',properties:{}}:schema('query')}));
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  window.fetch=async(url,options={})=>{
    if(!String(url).endsWith('/api/mcp'))return realFetch(url,options);
    const body=JSON.parse(options.body||'{}');window.__mcp.calls.push(body.method+':'+(body.params?.name||''));
    if(body.endpoint==='http://127.0.0.1:8892/mcp'){
      if(body.method==='tools/list')return reply(200,{jsonrpc:'2.0',id:body.id,result:{tools:osint}});
      if(body.method==='tools/call'){
        const name=body.params.name;
        await new Promise(resolve=>setTimeout(resolve,window.__mcp.delays[name]??100));
        const text=JSON.stringify(window.__mcp.answers[name]??{items:[]});
        return reply(200,{jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text}],isError:false}});
      }
      return reply(200,{jsonrpc:'2.0',id:body.id,result:{}});
    }
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
