import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tierChips,toolCard} from '../public/tools-view.js';

// Tool library: tier filters are toggles that explain each tier; tool cards say where a tool is used and spell out
// paid or side-effect flags. Tier names (Passive, Light touch, Active, Intrusive) stay.
test('tier chips are toggles that explain each tier',()=>{
  const html=tierChips([{key:'all',label:'All',count:10,explain:'Every tool from your connected MCP servers.'},{key:'active',label:'Active',count:2,explain:'Probing <x>'}],'active');
  assert.match(html,/data-tier-filter="all" aria-pressed="false"/);
  assert.match(html,/data-tier-filter="active" aria-pressed="true"/);
  assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
  assert.match(html,/Every tool from your connected MCP servers\./);
  assert.match(html,/Probing &lt;x&gt;/);
});

test('tool cards say where a tool is used and write out its flags',()=>{
  const tool={name:'omega_aisummary',serverName:'Omega MCP',serverId:'omega-local',description:'<b>d</b>'};
  const html=toolCard(tool,{risk:{label:'Passive',key:'passive',level:0,flags:['credits','side-effects']},usage:'Tool library only'});
  assert.match(html,/Omega MCP · Tool library only/);
  assert.match(html,/Uses paid AI credits/);
  assert.match(html,/Has side effects: it may send, store, schedule or change data/);
  assert.match(html,/class="ui-badge ui-badge-safe"/);
  assert.doesNotMatch(html,/<b>d<\/b>/);
  assert.match(html,/<p class="tool-desc" title="&lt;b&gt;d&lt;\/b&gt;">/);
  assert.match(html,/data-run="omega-local::omega_aisummary"/);
  assert.match(toolCard({...tool,name:'omega_vuln'},{risk:{label:'Intrusive',key:'intrusive',level:3,flags:[]},usage:'Tool library only'}),/ui-badge-danger[\s\S]*Run intrusive tool/);
});

test('the run dialog labels its settings box and explains the default',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/Tool settings \(JSON\)/);
  assert.match(html,/id="runArgs"[^>]*aria-describedby="runArgs-hint"/);
  assert.match(html,/id="runArgs-hint"[^>]*>Leave as \{\} to use the defaults\.</);
});
