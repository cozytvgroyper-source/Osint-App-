import test from 'node:test';
import assert from 'node:assert/strict';
import {recordToolHealth,serverConnectionLabel,summarizeToolHealth,toolCountLabel} from '../public/tool-health.js';

const server=(id,status,names)=>({id,status,tools:names.map(name=>({name}))});

test('counts working, failing and untested tools from the latest run of each tool',()=>{
  let health={};
  health=recordToolHealth(health,'omega','omega_whois','data','2026-11-10T20:00:00Z');
  health=recordToolHealth(health,'omega','omega_dns','error','2026-11-10T20:00:00Z');
  health=recordToolHealth(health,'omega','omega_dns','empty','2026-11-10T21:00:00Z');
  health=recordToolHealth(health,'omega','omega_cve','error','2026-11-10T21:00:00Z');
  const omega=server('omega','connected',['omega_whois','omega_dns','omega_cve','omega_crtsh']);
  assert.deepEqual(summarizeToolHealth(omega,health),{total:4,working:2,failing:1,untested:1});
});

test('ignores health for other servers and for tools the server no longer lists',()=>{
  let health=recordToolHealth({},'other','omega_whois','data','t');
  health=recordToolHealth(health,'omega','removed_tool','data','t');
  assert.deepEqual(summarizeToolHealth(server('omega','connected',['omega_whois']),health),{total:1,working:0,failing:0,untested:1});
});

test('labels show exact counts and leave out zero failing',()=>{
  const health=recordToolHealth({},'toolbox','whois_lookup','data','t');
  assert.equal(toolCountLabel(server('toolbox','connected',['whois_lookup','exiftool_metadata']),health),'2 tools · 1 working · 1 not yet run');
  const failing=recordToolHealth(health,'toolbox','exiftool_metadata','error','t');
  assert.equal(toolCountLabel(server('toolbox','connected',['whois_lookup','exiftool_metadata']),failing),'2 tools · 1 working · 1 failing');
  assert.equal(toolCountLabel(server('one','connected',['a']),{}),'1 tool · 0 working · 1 not yet run');
});

test('server label counts connected servers out of all saved servers',()=>{
  const servers=[server('a','connected',[]),server('b','connected',[]),server('c','offline',[]),server('d','connecting',[])];
  assert.equal(serverConnectionLabel(servers),'2 of 4 MCP servers connected');
  assert.equal(serverConnectionLabel([server('a','connected',[])]),'1 of 1 MCP server connected');
  assert.equal(serverConnectionLabel([]),'No MCP servers saved');
});

test('rejects unknown outcome kinds',()=>{
  assert.throws(()=>recordToolHealth({},'a','b','maybe','t'));
});
