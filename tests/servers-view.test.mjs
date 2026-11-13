import test from 'node:test';
import assert from 'node:assert/strict';
import {serverCard,serverStatusText,SERVER_PURPOSES} from '../public/servers-view.js';

// MCP server cards for non-technical readers: what each bundled server is for, its state in words, plain actions.
test('bundled servers say what they are for',()=>{
  const html=serverCard({id:'osint-local',name:'Open OSINT',endpoint:'http://127.0.0.1:8892/mcp',status:'connected'},{bundled:true,toolCountText:'107 tools'});
  assert.match(html,/Public databases and news feeds; never contacts your target\./);
  assert.match(html,/Connected · 107 tools/);
  assert.match(html,/data-connect="osint-local">Reconnect</);
  assert.match(html,/data-disconnect="osint-local">Disconnect</);
  assert.match(html,/data-remove="osint-local">Disable</);
  assert.match(html,/data-server-card="osint-local"/);
  assert.doesNotMatch(html,/STREAMABLE HTTP/);
  assert.equal(Object.keys(SERVER_PURPOSES).length,4);
});

test('status reads as words',()=>{
  assert.equal(serverStatusText({status:'offline',error:'x'}),'Not running');
  assert.equal(serverStatusText({needsAuth:true}),'Needs sign-in');
  assert.equal(serverStatusText({status:'connecting'}),'Connecting…');
  assert.equal(serverStatusText({status:'offline',disconnected:true}),'Disconnected');
  assert.equal(serverStatusText({status:'offline'}),'Not connected');
  assert.equal(serverStatusText({status:'connected'},'1 tool'),'Connected · 1 tool');
});

test('custom servers are escaped and removable; sign-in shows for Consensus',()=>{
  const html=serverCard({id:'c1',name:'<img src=x>',endpoint:'https://e.com/mcp',status:'offline'},{bundled:false});
  assert.doesNotMatch(html,/<img src=x>/);
  assert.match(html,/data-remove="c1">Remove</);
  assert.match(html,/data-connect="c1">Connect</);
  assert.doesNotMatch(html,/server-purpose/);
  assert.match(serverCard({id:'consensus',name:'Consensus',endpoint:'https://mcp.consensus.app/mcp',needsAuth:true},{bundled:true}),/data-consensus-sign-in[^>]*>Sign in to Consensus</);
});
