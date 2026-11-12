import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('pins the OSINT Toolbox executable dependency', async () => {
  const config = JSON.parse(await readFile(new URL('../config/osint-toolbox-mcp.json', import.meta.url), 'utf8'));
  const server = config.mcpServers?.['osint-toolbox'];

  assert.equal(server?.command, 'uvx');
  assert.deepEqual(server?.args, ['osint-toolbox-mcp==1.1.0']);
});

test('pins the managed Open OSINT checkout and protects every local service with one launch token',async()=>{
  const launcher=await readFile(new URL('../Start Public Desk.command',import.meta.url),'utf8');
  const dependency=await readFile(new URL('../config/open-osint.env',import.meta.url),'utf8');
  assert.match(dependency,/OPEN_OSINT_REVISION=[0-9a-f]{40}/);
  assert.match(launcher,/public-desk-token/);
  assert.match(launcher,/Authorization: Bearer \$PUBLIC_DESK_TOKEN/);
  assert.match(launcher,/OSINT_MCP_API_KEY="\$PUBLIC_DESK_TOKEN"/);
  assert.match(launcher,/cohort_is_running=false/);
  assert.match(launcher,/process_belongs_to_service/);
  assert.match(launcher,/require-loopback-token\.mjs/);
  assert.match(launcher,/run-osint-mcp-guarded\.py/);
  assert.match(launcher,/run-fastmcp-bridge-authenticated\.py/);
  assert.match(launcher,/#access=\$PUBLIC_DESK_TOKEN/);
});
