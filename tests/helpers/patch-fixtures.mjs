import fs from 'node:fs';

// Rebuilds the upstream lines a patch expects from the patch itself (its context and removed lines), so tests can
// apply Public Desk's patches to a scratch checkout without keeping copies of Open OSINT's files in this repo.
export function upstreamFromPatch(patchUrl) {
  const lines = fs.readFileSync(patchUrl, 'utf8').split('\n');
  const target = lines.find(line => line.startsWith('--- a/')).slice('--- a/'.length);
  const original = [];
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith('@@')) { inHunk = true; continue; }
    if (!inHunk || line.startsWith('\\')) continue;
    if (line.startsWith(' ')) original.push(line.slice(1));
    else if (line.startsWith('-')) original.push(line.slice(1));
    else if (line === '') original.push('');
  }
  while (original.length && original.at(-1) === '') original.pop();
  return { target, text: `${original.join('\n')}\n` };
}
