import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {upstreamFromPatch} from './helpers/patch-fixtures.mjs';

// Open OSINT's get_ais_vessels called api.aisstream.io, which does not exist; AISStream only streams over WebSocket.
// patches/open-osint-ais-websocket.patch rewrites the module to subscribe, listen briefly and close. These tests apply
// the patch to the upstream lines and run the result against a fake WebSocket, so nothing leaves this machine.
const patch=new URL('../patches/open-osint-ais-websocket.patch',import.meta.url);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-ais-'));
const {target,text}=upstreamFromPatch(patch);
fs.mkdirSync(path.dirname(path.join(root,target)),{recursive:true});
fs.writeFileSync(path.join(root,target),text);
const applied=spawnSync('git',['apply',patch.pathname],{cwd:root,encoding:'utf8',env:{...process.env,GIT_CEILING_DIRECTORIES:path.dirname(root)}});
const modulePath=path.join(root,target);
let loads=0;
const load=()=>import(`${modulePath}?load=${++loads}`);
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

// A stand-in for AISStream: records what the module sends and replays scripted frames after the subscription.
class FakeSocket{
  static frames=[];
  constructor(url){FakeSocket.last=this;this.url=url;this.sent=[];this.listeners={};this.closed=false;setTimeout(()=>this.emit('open',{}),0);}
  addEventListener(type,listener){(this.listeners[type]??=[]).push(listener);}
  send(data){this.sent.push(JSON.parse(data));for(const frame of FakeSocket.frames)setTimeout(()=>this.emit('message',{data:frame}),0);}
  close(){this.closed=true;}
  emit(type,event){for(const listener of this.listeners[type]??[])listener(event);}
}
const binary=message=>new TextEncoder().encode(JSON.stringify(message)).buffer;
const report=(mmsi,name,lat,lon,heading=90)=>({MessageType:'PositionReport',MetaData:{MMSI:mmsi,ShipName:`${name}   `,latitude:lat,longitude:lon,time_utc:'2026-11-11 15:00:00 +0000 UTC'},Message:{PositionReport:{Latitude:lat,Longitude:lon,Sog:7.5,Cog:180,TrueHeading:heading,NavigationalStatus:0,UserID:mmsi}}});

test('the patch applies to the upstream module',()=>{
  assert.equal(applied.status,0,applied.stderr);
  assert.doesNotMatch(fs.readFileSync(modulePath,'utf8'),/fetch\(searchUrl/,'the old HTTP request is gone');
});

test('subscribes to position reports in the box and returns one entry per ship, latest position first seen',async()=>{
  globalThis.WebSocket=FakeSocket;process.env.AISSTREAM_API_KEY='ais-test-key';
  FakeSocket.frames=[binary({MessageType:'SubscriptionConfirmation',Message:{}}),binary(report(111,'FLEUR',51.88,4.27)),binary(report(111,'FLEUR',51.89,4.28,511)),JSON.stringify(report(222,'SWIFT',51.9,4.3))];
  const {run}=await load();
  const result=await run({},{bbox:'51.8,3.8,52.1,4.4',limit:2});
  assert.deepEqual(FakeSocket.last.url,'wss://stream.aisstream.io/v0/stream');
  assert.deepEqual(FakeSocket.last.sent,[{APIKey:'ais-test-key',BoundingBoxes:[[[51.8,3.8],[52.1,4.4]]],FilterMessageTypes:['PositionReport']}]);
  assert.equal(result.count,2);
  assert.deepEqual(result.vessels.map(v=>[v.mmsi,v.name,v.latitude,v.heading]),[['111','FLEUR',51.89,null],['222','SWIFT',51.9,90]],'latest position kept; heading 511 means unknown');
  assert.equal(FakeSocket.last.closed,true,'stops listening once it has enough ships');
});

test("reports AISStream's own error, such as a rejected key",async()=>{
  globalThis.WebSocket=FakeSocket;process.env.AISSTREAM_API_KEY='bad-key';
  FakeSocket.frames=[JSON.stringify({error:'Api Key Is Not Valid'})];
  const {run}=await load();
  const result=await run({},{bbox:'50,-2,51.3,2',limit:10});
  assert.equal(result.error,'AISStream: Api Key Is Not Valid');
  assert.deepEqual(result.vessels,[]);
});

test('a quiet area returns no ships with an explanation instead of an error',async()=>{
  globalThis.WebSocket=FakeSocket;process.env.AISSTREAM_API_KEY='ais-test-key';
  FakeSocket.frames=[binary({MessageType:'SubscriptionConfirmation',Message:{}})];
  const {run}=await load();
  const result=await run({},{bbox:'24,54,26,56',limit:10,seconds:2});
  assert.equal(result.count,0);
  assert.equal(result.error,undefined);
  assert.match(result.note,/coverage is thin/);
});

test('says plainly when Node has no built-in WebSocket',async()=>{
  const saved=globalThis.WebSocket;delete globalThis.WebSocket;process.env.AISSTREAM_API_KEY='ais-test-key';
  try{
    const {run}=await load();
    assert.match((await run({},{bbox:'1,2,3,4'})).error,/Node 22 or later/);
  }finally{globalThis.WebSocket=saved;}
});
