// Case reports: a readable record of a case's findings for sharing or hand-off, as Markdown or as a self-contained HTML
// page that prints cleanly (File > Print > Save as PDF). Every value taken from a finding is escaped, so result text
// cannot change the report's structure or run as code. Each finding carries its full SHA-256 fingerprint.
const MAX_RESULT_CHARS = 20_000;
const SHORTENED = 'shortened: the full result is in Export JSON';

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
// Findings saved before statuses existed count as unverified.
const statusOf = item => item.status || 'unverified';
const statusCounts = evidence => ['confirmed', 'unverified', 'ruled out'].map(status => `${evidence.filter(item => statusOf(item) === status).length} ${status}`).join(' · ');
const resultText = result => {
  const full = JSON.stringify(result, null, 2) ?? 'null';
  return full.length > MAX_RESULT_CHARS ? { text: full.slice(0, MAX_RESULT_CHARS), shortened: true } : { text: full, shortened: false };
};
const verifyNote = 'Each fingerprint is the SHA-256 of the saved result serialised with `JSON.stringify(result)` (no spacing). '
  + 'To check one, take the finding\'s `result` from the case\'s Export JSON and run, in Node.js: '
  + '`crypto.createHash("sha256").update(JSON.stringify(result)).digest("hex")`. A matching value shows the result is unchanged since it was saved.';

// Markdown: escape table and heading syntax in one-line values.
const mdLine = value => String(value ?? '').replace(/\s+/g, ' ').replace(/([\\|*_#[\]`])/g, '\\$1').trim();
const mdFence = text => '`'.repeat(Math.max(4, ...[...text.matchAll(/`+/g)].map(run => run[0].length + 1)));

function markdown(record, now) {
  const evidence = record.evidence || [], searches = record.searches || [];
  const lines = [
    `# Case report: ${mdLine(record.name)}`, '',
    `Generated ${now.toISOString()} · case created ${record.createdAt} · last changed ${record.updatedAt}`, '',
    `${plural(evidence.length, 'finding')} · ${plural(searches.length, 'search', 'searches')}`, '', statusCounts(evidence), '',
    'OSINT findings are leads, not proof. Check each one before relying on it.', '',
    '## Findings', '',
    '| # | Finding | Source | Collected | Fingerprint |', '|---|---|---|---|---|',
    ...evidence.map((item, index) => `| ${index + 1} | ${mdLine(item.title)} | ${mdLine(item.server || 'unknown')} | ${mdLine(item.time)} | ${mdLine(String(item.sha256 || '').slice(0, 16))}… |`), ''
  ];
  evidence.forEach((item, index) => {
    const { text, shortened } = resultText(item.result);
    const fence = mdFence(text);
    lines.push(`### ${index + 1}. ${mdLine(item.title)}`, '',
      `- Source: ${mdLine(item.server || 'unknown')}`, `- Collected: ${mdLine(item.time)}`, `- Saved to the case: ${mdLine(item.savedAt)}`,
      `- SHA-256: \`${mdLine(item.sha256)}\``, `- Status: ${statusOf(item)}`, ...(item.note ? [`- Note: ${mdLine(item.note)}`] : []), '', `${fence}json`, text, fence, '');
    if (shortened) lines.push(`_(${SHORTENED})_`, '');
  });
  lines.push('## Search log', '', ...(searches.length ? searches.map(s => `- ${mdLine(s.time)} · ${mdLine(s.title)} · ${mdLine(s.server)}`) : ['No searches logged.']), '',
    '## Checking a fingerprint', '', verifyNote, '');
  return lines.join('\n');
}

const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const STYLE = `:root{color-scheme:light}html{background:#fff}body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#fff;max-width:960px;margin:32px auto;padding:0 20px}
h1{font-size:24px;margin:0 0 6px}h2{font-size:18px;margin:28px 0 10px;border-bottom:1px solid #ccc;padding-bottom:4px}h3{font-size:15px;margin:22px 0 6px}
.meta,.note{color:#555;font-size:12px}table{border-collapse:collapse;width:100%;font-size:12px;table-layout:fixed}th,td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}td{overflow-wrap:anywhere}
code{font:11px ui-monospace,Menlo,monospace;word-break:break-all}pre{font:11px/1.45 ui-monospace,Menlo,monospace;background:#f4f4f4;border:1px solid #ddd;padding:10px;white-space:pre-wrap;word-break:break-word}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;font-size:12px;margin:0 0 8px}dt{color:#555}dd{margin:0}
@media print{body{margin:0;max-width:none}section.finding{break-inside:avoid-page}pre{max-height:none}}`;

function html(record, now) {
  const evidence = record.evidence || [], searches = record.searches || [];
  const rows = evidence.map((item, index) => `<tr><td>${index + 1}</td><td>${esc(item.title)}</td><td>${esc(item.server || 'unknown')}</td><td>${esc(item.time)}</td><td><code>${esc(String(item.sha256 || '').slice(0, 16))}…</code></td></tr>`).join('');
  const findings = evidence.map((item, index) => {
    const { text, shortened } = resultText(item.result);
    return `<section class="finding"><h3>${index + 1}. ${esc(item.title)}</h3><dl><dt>Source</dt><dd>${esc(item.server || 'unknown')}</dd><dt>Collected</dt><dd>${esc(item.time)}</dd><dt>Saved to the case</dt><dd>${esc(item.savedAt)}</dd><dt>SHA-256</dt><dd><code>${esc(item.sha256)}</code></dd><dt>Status</dt><dd>${esc(statusOf(item))}</dd>${item.note ? `<dt>Note</dt><dd>${esc(item.note)}</dd>` : ''}</dl><pre>${esc(text)}</pre>${shortened ? `<p class="note">(${SHORTENED})</p>` : ''}</section>`;
  }).join('');
  const log = searches.length ? `<ul>${searches.map(s => `<li>${esc(s.time)} · ${esc(s.title)} · ${esc(s.server)}</li>`).join('')}</ul>` : '<p>No searches logged.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Case report: ${esc(record.name)}</title><style>${STYLE}</style></head><body>
<h1>Case report: ${esc(record.name)}</h1><p class="meta">Generated ${esc(now.toISOString())} · case created ${esc(record.createdAt)} · last changed ${esc(record.updatedAt)}<br>${esc(plural(evidence.length, 'finding'))} · ${esc(plural(searches.length, 'search', 'searches'))}<br>${esc(statusCounts(evidence))}</p>
<p class="note">OSINT findings are leads, not proof. Check each one before relying on it.</p>
<h2>Findings</h2><table><colgroup><col style="width:7%"><col style="width:33%"><col style="width:18%"><col style="width:24%"><col style="width:18%"></colgroup><thead><tr><th>#</th><th>Finding</th><th>Source</th><th>Collected</th><th>Fingerprint</th></tr></thead><tbody>${rows}</tbody></table>${findings}
<h2>Search log</h2>${log}<h2>Checking a fingerprint</h2><p class="note">${esc(verifyNote).replace(/`([^`]+)`/g, '<code>$1</code>')}</p></body></html>`;
}

export function buildCaseReport(record, { format = 'markdown', now = new Date() } = {}) {
  return format === 'html' ? html(record, now) : markdown(record, now);
}

export function reportFilename(name, extension) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'case';
  return `${slug}-report.${extension}`;
}
