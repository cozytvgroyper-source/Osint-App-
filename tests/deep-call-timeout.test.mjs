import test from 'node:test';
import assert from 'node:assert/strict';
import {deepCallTimeout} from '../scripts/deep-call-timeout.mjs';

test('long timeouts only for listed Deep Search tools, never above 10 minutes',()=>{
  assert.equal(deepCallTimeout({name:'maigret_username_search',serverName:'OSINT Toolbox',deepSearch:true,timeoutMs:600_000},{}),600_000);
  assert.equal(deepCallTimeout({name:'maigret_username_search',serverName:'OSINT Toolbox',deepSearch:true,timeoutMs:9e9},{}),600_000);
  assert.equal(deepCallTimeout({name:'get_wikidata',serverName:'Open OSINT',deepSearch:true,timeoutMs:600_000},{}),45_000);
  assert.equal(deepCallTimeout({name:'whois_lookup',serverName:'OSINT Toolbox',deepSearch:true,timeoutMs:120_000},{}),120_000);
  assert.equal(deepCallTimeout({name:'whois_lookup',serverName:'OSINT Toolbox'},{}),45_000);
  assert.equal(deepCallTimeout({name:'omega_ports',serverName:'Omega MCP'},{grant:{purpose:'deep-search'}}),120_000);
});

test('a reviewed name on an untrusted server cannot request a long timeout',()=>{
  assert.equal(deepCallTimeout({name:'maigret_username_search',serverName:'Custom MCP',deepSearch:true,timeoutMs:600_000},{}),45_000);
});
