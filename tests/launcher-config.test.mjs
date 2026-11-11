import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('pins the OSINT Toolbox executable dependency', async () => {
  const config = JSON.parse(await readFile(new URL('../config/osint-toolbox-mcp.json', import.meta.url), 'utf8'));
  const server = config.mcpServers?.['osint-toolbox'];

  assert.equal(server?.command, 'uvx');
  assert.deepEqual(server?.args, ['osint-toolbox-mcp==1.1.0']);
});
