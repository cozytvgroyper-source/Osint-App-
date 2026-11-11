import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const wrapper = fileURLToPath(new URL('../scripts/run-omega-mcp-captured.py', import.meta.url));

// Loads the wrapper without running it (omega-cli is not installed in CI), wraps a fake module runner,
// and prints what the wrapped runner returns plus anything that still reached the real stdout.
function runCaptured(fakeBody) {
  const script = `
import importlib.util, io, json, sys, contextlib
spec = importlib.util.spec_from_file_location('captured', ${JSON.stringify(wrapper)})
captured = importlib.util.module_from_spec(spec)
spec.loader.exec_module(captured)
def fake(module_path, func_name, *args, **kwargs):
${fakeBody}
leak = io.StringIO()
with contextlib.redirect_stdout(leak):
    result = captured.capture_module_output(fake)('omega_cli.modules.x', 'run', 'example.com')
sys.stdout.write(json.dumps({'result': result, 'leaked': leak.getvalue()}))
`;
  return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
}

test('returns printed module output instead of the bare completed marker', () => {
  const { result, leaked } = runCaptured(`    print('\\x1b[1mIP Geolocation: 8.8.8.8\\x1b[0m   ')
    print('Country: US')
    return {'status': 'ok', 'result': 'completed'}`);
  assert.deepEqual(result, { status: 'ok', result: 'IP Geolocation: 8.8.8.8\nCountry: US' });
  assert.equal(leaked, '', 'module output must never reach the MCP stdio channel');
});

test('keeps structured results and errors unchanged while still silencing prints', () => {
  const structured = runCaptured(`    print('noise')
    return {'status': 'ok', 'result': {'hosts': 3}}`);
  assert.deepEqual(structured.result, { status: 'ok', result: { hosts: 3 } });
  assert.equal(structured.leaked, '');

  const failed = runCaptured(`    print('partial')
    return {'status': 'error', 'error': 'boom'}`);
  assert.deepEqual(failed.result, { status: 'error', error: 'boom' });
  assert.equal(failed.leaked, '');
});

test('keeps the completed marker when the module printed nothing', () => {
  const { result } = runCaptured(`    return {'status': 'ok', 'result': 'completed'}`);
  assert.deepEqual(result, { status: 'ok', result: 'completed' });
});

test('caps very long printed output', () => {
  const { result } = runCaptured(`    print('x' * 50000)
    return {'status': 'ok', 'result': 'completed'}`);
  assert.ok(result.result.length <= 20100);
  assert.match(result.result, /output truncated/);
});

test('starts Omega through the stdout-capturing wrapper with pinned packages', async () => {
  const config = JSON.parse(await readFile(new URL('../config/omega-mcp.json', import.meta.url), 'utf8'));
  const server = config.mcpServers?.omega;
  assert.equal(server?.command, 'uvx');
  assert.ok(server.args.includes('git+https://github.com/Ekoelogan/omega-mcp-server@d52e7dc794b6488fed34ba00102da022b05accdf'));
  assert.ok(server.args.includes('git+https://github.com/Ekoelogan/omega-cli@24767fb8794e0cfe6f608eee3407ba1f40b501cb'));
  assert.deepEqual(server.args.slice(-2), ['python', 'scripts/run-omega-mcp-captured.py']);
});
