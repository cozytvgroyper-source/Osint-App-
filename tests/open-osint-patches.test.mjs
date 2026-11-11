import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// The launcher applies patches/*.patch to the Open OSINT checkout before starting its data service. These tests
// run scripts/apply-open-osint-patches.zsh against a scratch folder holding the lines the patch changes.
const script=new URL('../scripts/apply-open-osint-patches.zsh',import.meta.url).pathname;
const patches=new URL('../patches',import.meta.url).pathname;
const target='server/server/worldmonitor/cyber/v1/list-cyber-threats.ts';

// The upstream lines around Open OSINT's coordinate filter (list-cyber-threats.ts, commit 0750ba2).
const upstream=`      const combined = dedupeThreats([
        ...feodo.threats,
        ...urlhaus.threats,
        ...c2intel.threats,
        ...otx.threats,
        ...abuseipdb.threats,
      ]);

      const hydrated = await hydrateThreatCoordinates(combined);

      // Filter to only threats with valid coordinates
      let results = hydrated
        .filter((t) => t.lat !== null && t.lon !== null && t.lat >= -90 && t.lat <= 90 && t.lon >= -180 && t.lon <= 180);

      // Apply optional filters BEFORE sorting + slicing (C-2 fix)
      if (req.type && req.type !== 'CYBER_THREAT_TYPE_UNSPECIFIED') {
        const filterType = req.type;
        results = results.filter((t) => THREAT_TYPE_MAP[t.type] === filterType);
      }
`;

// The upstream lines around the data service's call to that feed (api/headless.js, commit 0750ba2).
const headlessTarget='server/api/headless.js';
const headlessUpstream=`    run: async (ctx, params) => {
      const limit = Number(params.limit || 100);
      // Try internal RPC first
      let threats = [];
      try {
        const rpc = await fetchJson(ctx.origin, '/api/cyber/v1/list-cyber-threats', { limit });
        threats = rpc?.threats || [];
      } catch { /* fall through */ }

      // Enrich with direct Feodo tracker (full blocklist, not just recommended)
      if (threats.length < 10) {
`;

function scratch(contents,headless=headlessUpstream){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-osint-'));
  for(const [file,text] of [[target,contents],[headlessTarget,headless]]){
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
    fs.writeFileSync(path.join(root,file),text);
  }
  return root;
}
function apply(root){
  const run=spawnSync('zsh',['-fc',`source ${JSON.stringify(script)}; apply_open_osint_patches ${JSON.stringify(root)} ${JSON.stringify(patches)}`],{encoding:'utf8'});
  return {status:run.status,out:run.stdout+run.stderr,file:fs.readFileSync(path.join(root,target),'utf8')};
}

test('applies the patch: threats without coordinates are kept, invalid coordinates still dropped',()=>{
  const root=scratch(upstream);
  const {status,out,file}=apply(root);
  assert.equal(status,0);
  assert.match(out,/Applied open-osint-keep-unlocated-threats/);
  assert.match(file,/\(t\.lat == null && t\.lon == null\)/);
  assert.match(file,/t\.lat >= -90 && t\.lat <= 90 && t\.lon >= -180 && t\.lon <= 180/);
  fs.rmSync(root,{recursive:true,force:true});
});

// Without page_size the feed's page size was Number("0"), clamped up to 1, so cyber searches got 1 threat per source.
test('the data service asks the threat feed for page_size instead of the ignored limit',()=>{
  const root=scratch(upstream);
  const {out}=apply(root);
  const headless=fs.readFileSync(path.join(root,headlessTarget),'utf8');
  assert.match(out,/Applied open-osint-cyber-threats-page-size/);
  assert.match(headless,/list-cyber-threats', \{ page_size: limit \}\)/);
  assert.doesNotMatch(headless,/list-cyber-threats', \{ limit \}\)/);
  fs.rmSync(root,{recursive:true,force:true});
});

test('the patched filter keeps unplaced threats and drops impossible coordinates',()=>{
  const root=scratch(upstream);
  const {file}=apply(root);
  const expression=file.match(/\.filter\(\(t\) => ([\s\S]*?)\);\n/)[1];
  const keep=new Function('t',`return ${expression};`);
  assert.equal(keep({lat:null,lon:null}),true);
  assert.equal(keep({lat:undefined,lon:undefined}),true);
  assert.equal(keep({lat:48.1,lon:11.6}),true);
  assert.equal(keep({lat:120,lon:11.6}),false);
  assert.equal(keep({lat:48.1,lon:null}),false);
  fs.rmSync(root,{recursive:true,force:true});
});

test('running again changes nothing and says nothing',()=>{
  const root=scratch(upstream);
  const first=apply(root);
  const second=apply(root);
  assert.equal(second.status,0);
  assert.equal(second.out.trim(),'');
  assert.equal(second.file,first.file);
  fs.rmSync(root,{recursive:true,force:true});
});

test('when Open OSINT changed, it warns, leaves the file alone and does not stop the launcher',()=>{
  const changed=upstream.replace('// Filter to only threats with valid coordinates','// Upstream rewrote this part');
  const root=scratch(changed);
  const {status,out,file}=apply(root);
  assert.equal(status,0);
  assert.match(out,/Could not apply open-osint-keep-unlocated-threats/);
  assert.equal(file,changed);
  fs.rmSync(root,{recursive:true,force:true});
});

test('a missing Open OSINT checkout is not an error',()=>{
  const run=spawnSync('zsh',['-fc',`source ${JSON.stringify(script)}; apply_open_osint_patches /nonexistent/osint ${JSON.stringify(patches)}`],{encoding:'utf8'});
  assert.equal(run.status,0);
});
