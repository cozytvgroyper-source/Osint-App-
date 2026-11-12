import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {upstreamFromPatch} from './helpers/patch-fixtures.mjs';

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

// The upstream lines around the AbuseIPDB blacklist fetch (server/worldmonitor/cyber/v1/_shared.ts, commit 0750ba2).
const sharedTarget='server/server/worldmonitor/cyber/v1/_shared.ts';
const sharedUpstream=`// ========================================================================
// Source 5: AbuseIPDB
// ========================================================================

export async function fetchAbuseIpDbSource(limit: number): Promise<SourceResult> {
  const apiKey = cleanString(process.env.ABUSEIPDB_API_KEY || '', 200);
  if (!apiKey) return { ok: false, threats: [] };

  try {
    const url = \`\${ABUSEIPDB_BLACKLIST_URL}?confidenceMinimum=90&limit=\${Math.min(limit, 500)}\`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json', Key: apiKey, 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, threats: [] };

    const payload = await response.json();
    const records: any[] = Array.isArray(payload?.data) ? payload.data : [];

    const parsed: RawThreat[] = [];
    for (const record of records) {
      const ip = cleanString(record?.ipAddress || record?.ip || '', 80).toLowerCase();
      if (!isIpAddress(ip)) continue;
`;

function scratch(contents,headless=headlessUpstream){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-desk-osint-'));
  const ais=upstreamFromPatch(new URL('../patches/open-osint-ais-websocket.patch',import.meta.url));
  const greynoise=upstreamFromPatch(new URL('../patches/open-osint-greynoise-not-observed.patch',import.meta.url));
  const mcpPatch=new URL('../patches/open-osint-mcp-event-loop.patch',import.meta.url).pathname;
  const mcpClient={target:'mcp/src/osint_mcp/client.py',text:fs.readFileSync(new URL('./fixtures/open-osint-client.py',import.meta.url),'utf8')};
  for(const [file,text] of [[target,contents],[headlessTarget,headless],[sharedTarget,sharedUpstream],[ais.target,ais.text],[greynoise.target,greynoise.text],[mcpClient.target,mcpClient.text]]){
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
    fs.writeFileSync(path.join(root,file),text);
  }
  const mcpApply=spawnSync('git',['apply',mcpPatch],{cwd:root,encoding:'utf8'});
  assert.equal(mcpApply.status,0,mcpApply.stderr);
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

test('the MCP client sends the private launch token to the protected data service',()=>{
  const root=scratch(upstream);
  const {status}=apply(root);
  const client=fs.readFileSync(path.join(root,'mcp/src/osint_mcp/client.py'),'utf8');
  assert.equal(status,0);
  assert.match(client,/os\.environ\.get\("PUBLIC_DESK_TOKEN"/);
  assert.match(client,/headers = \{"Authorization": f"Bearer \{token\}"\}/);
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

// AbuseIPDB's free plan allows 5 blacklist requests a day; every cyber search used one. The patch caches the list.
test('the AbuseIPDB patch applies and fetches the full list through a cache',()=>{
  const root=scratch(upstream);
  const {out}=apply(root);
  const shared=fs.readFileSync(path.join(root,sharedTarget),'utf8');
  assert.match(out,/Applied open-osint-abuseipdb-cache/);
  assert.match(shared,/const records = await abuseIpDbRecords\(apiKey\);/);
  assert.match(shared,/confidenceMinimum=90&limit=500/);
  fs.rmSync(root,{recursive:true,force:true});
});

// Runs the patched cache code itself (TypeScript, so it needs Node's type stripping: Node 22.6 or later).
const [major,minor]=process.versions.node.split('.').map(Number);
test('the AbuseIPDB cache serves one fetch for six hours and keeps the list when a refresh fails',{skip:major<22||(major===22&&minor<6)?'needs Node 22.6+ type stripping':false},()=>{
  const root=scratch(upstream);
  apply(root);
  const shared=fs.readFileSync(path.join(root,sharedTarget),'utf8');
  const helper=shared.slice(shared.indexOf('// Public Desk: AbuseIPDB cache (start)'),shared.indexOf('// Public Desk: AbuseIPDB cache (end)'));
  const module=path.join(root,'cache.ts');
  fs.writeFileSync(module,`const ABUSEIPDB_BLACKLIST_URL='https://api.abuseipdb.com/api/v2/blacklist';const CHROME_UA='test';const UPSTREAM_TIMEOUT_MS=1000;\n${helper}\nexport {abuseIpDbRecords};\n`);
  const driver=`import {abuseIpDbRecords} from ${JSON.stringify(module)};
let now=1_000_000_000_000;Date.now=()=>now;const hour=3_600_000;
let calls=0;let next=200;
globalThis.fetch=async url=>{calls++;if(next!==200)return new Response('{}',{status:next});return new Response(JSON.stringify({data:[{ipAddress:'192.0.2.'+calls}]}),{status:200});};
const ip=r=>r?r[0].ipAddress:null;const log=[];
log.push(['first',ip(await abuseIpDbRecords('k')),calls]);
now+=5*hour;log.push(['5h later, cached',ip(await abuseIpDbRecords('k')),calls]);
now+=2*hour;log.push(['7h, refreshed',ip(await abuseIpDbRecords('k')),calls]);
now+=7*hour;next=429;log.push(['429 keeps last list',ip(await abuseIpDbRecords('k')),calls]);
now+=0.5*hour;log.push(['30 min later, no retry',ip(await abuseIpDbRecords('k')),calls]);
now+=0.6*hour;next=200;log.push(['after the hour, retried',ip(await abuseIpDbRecords('k')),calls]);
process.stdout.write(JSON.stringify(log));`;
  const run=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings','--input-type=module','-e',driver],{encoding:'utf8'});
  fs.rmSync(root,{recursive:true,force:true});
  assert.equal(run.status,0,run.stderr);
  assert.deepEqual(JSON.parse(run.stdout),[
    ['first','192.0.2.1',1],
    ['5h later, cached','192.0.2.1',1],
    ['7h, refreshed','192.0.2.2',2],
    ['429 keeps last list','192.0.2.2',3],
    ['30 min later, no retry','192.0.2.2',3],
    ['after the hour, retried','192.0.2.4',4]
  ]);
});

test('with no saved list, a refused refresh means no AbuseIPDB data rather than an error',{skip:major<22||(major===22&&minor<6)?'needs Node 22.6+ type stripping':false},()=>{
  const root=scratch(upstream);
  apply(root);
  const shared=fs.readFileSync(path.join(root,sharedTarget),'utf8');
  const helper=shared.slice(shared.indexOf('// Public Desk: AbuseIPDB cache (start)'),shared.indexOf('// Public Desk: AbuseIPDB cache (end)'));
  const module=path.join(root,'cache.ts');
  fs.writeFileSync(module,`const ABUSEIPDB_BLACKLIST_URL='u';const CHROME_UA='t';const UPSTREAM_TIMEOUT_MS=1000;\n${helper}\nexport {abuseIpDbRecords};\n`);
  const run=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings','--input-type=module','-e',`import {abuseIpDbRecords} from ${JSON.stringify(module)};globalThis.fetch=async()=>new Response('{}',{status:429});process.stdout.write(JSON.stringify(await abuseIpDbRecords('k')));`],{encoding:'utf8'});
  fs.rmSync(root,{recursive:true,force:true});
  assert.equal(run.status,0,run.stderr);
  assert.equal(run.stdout,'null');
});

test('the GreyNoise patch reads a community-API 404 as "not observed" instead of an error',()=>{
  const root=scratch(upstream);
  const run=apply(root);
  assert.equal(run.status,0);
  assert.match(run.out,/Applied open-osint-greynoise-not-observed to Open OSINT\./);
  const patched=fs.readFileSync(path.join(root,'server/api/modules/greynoise.mjs'),'utf8');
  assert.match(patched,/if \(resp\.ok \|\| resp\.status === 404\)/);
  assert.match(patched,/classification: data\.classification \|\| \(resp\.status === 404 \? 'not observed' : ''\)/);
  assert.equal(apply(root).out,'','applying again changes nothing and says nothing');
});
