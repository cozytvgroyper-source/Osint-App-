// Preload for the Open OSINT data service. Keeps process.env in step with work/api-keys.env (the file named by
// PUBLIC_DESK_API_KEYS_FILE), so Connect and Disconnect in Public Desk's Data sources panel apply without a
// restart: Open OSINT's modules read their keys from process.env on every call. Only connected data-source keys
// are set; disconnected or removed ones are deleted. Logs key names, never values.
import { readFileSync, watchFile } from 'node:fs';
import { MANAGED_ENV_NAMES, effectiveEnv, parseKeyFile } from './api-keys.mjs';

const file = process.env.PUBLIC_DESK_API_KEYS_FILE;
let lastNames = null;

function applyKeyFile() {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { /* no file yet: no keys */ }
  const env = effectiveEnv(parseKeyFile(text));
  for (const name of MANAGED_ENV_NAMES) {
    if (env[name]) process.env[name] = env[name];
    else delete process.env[name];
  }
  const names = Object.keys(env).join(', ');
  if (names !== lastNames) {
    if (lastNames !== null || names) console.error(`[public-desk] data-source keys: ${names || 'none'}`);
    lastNames = names;
  }
}

if (file) {
  applyKeyFile();
  // Polling also catches the save-by-rename the panel uses; the watcher does not keep the process alive.
  watchFile(file, { interval: 1000, persistent: false }, applyKeyFile);
}
