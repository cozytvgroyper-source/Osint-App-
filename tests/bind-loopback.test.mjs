import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

// Starts a server the way the bundled data service does, listen(port) with no address, with and
// without the preload, and reports the address it actually bound to.
const probe=`import http from 'node:http';
const server=http.createServer((q,s)=>s.end('ok'));
const style=process.argv[1];
const done=()=>{process.stdout.write(JSON.stringify(server.address()));server.close();};
if(style==='port')server.listen(0,done);
else if(style==='options')server.listen({port:0},done);
else if(style==='explicit')server.listen(0,'0.0.0.0',done);
else if(style==='empty-host')server.listen(0,'',done);
else if(style==='null-port')server.listen(null,done);
else if(style==='options-empty-host')server.listen({port:0,host:''},done);
else if(style==='options-null-host')server.listen({port:0,host:null},done);`;

function boundAddress(style,preload){
  return new Promise((resolve,reject)=>{
    const args=[...(preload?['--import',new URL('../scripts/bind-loopback.mjs',import.meta.url).href]:[]),'--input-type=module','-e',probe,style];
    const child=spawn(process.execPath,args);let out='';let err='';
    child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
    child.on('close',code=>code===0?resolve(JSON.parse(out).address):reject(new Error(err)));
  });
}

test('without the preload, listen(port) binds to every network interface',async()=>{
  assert.match(await boundAddress('port',false),/^(::|0\.0\.0\.0)$/);
});

test('with the preload, a server that names no address binds to this Mac only',async()=>{
  assert.equal(await boundAddress('port',true),'127.0.0.1');
  assert.equal(await boundAddress('options',true),'127.0.0.1');
});

test('an address the program chose on purpose is left alone',async()=>{
  assert.equal(await boundAddress('explicit',true),'0.0.0.0');
});

test('an empty or null address counts as no address',async()=>{
  for(const style of ['empty-host','null-port','options-empty-host','options-null-host'])assert.equal(await boundAddress(style,true),'127.0.0.1',style);
});
