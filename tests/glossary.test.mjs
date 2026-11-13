import test from 'node:test';
import assert from 'node:assert/strict';
import {GLOSSARY} from '../public/glossary.js';
import {TIERS} from '../public/tool-tiers.js';

// One shared word list, so every page names and explains a concept the same way.
test('the kept terms keep their names and the tiers reuse their tier text',()=>{
  assert.equal(GLOSSARY.mcpServer.label,'MCP server');
  assert.equal(GLOSSARY.toolLibrary.label,'Tool library');
  assert.equal(GLOSSARY.pivot.label,'Pivot');
  for(const tier of TIERS){assert.equal(GLOSSARY[tier.key].label,tier.label);assert.equal(GLOSSARY[tier.key].explain,tier.targetSees);}
  assert.equal(GLOSSARY.unverified.label,'Not checked yet');
  assert.equal(GLOSSARY.fingerprint.explain,"Proves this saved result hasn't changed.");
});

test('"run grant" is never a shown term',()=>{
  assert.ok(!JSON.stringify(GLOSSARY).toLowerCase().includes('run grant'));
});
