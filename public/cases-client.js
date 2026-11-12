// Small, testable helpers for the case picker in app.js. Cases themselves live on this Mac (scripts/cases.mjs).

export function activeCaseId(cases, rememberedId) {
  return cases.some(item => item.id === rememberedId && !item.damaged) ? rememberedId : null;
}

export function newestFirst(evidence) {
  return [...(evidence || [])].reverse();
}

export function shortFingerprint(sha256) {
  return sha256 ? `${String(sha256).slice(0, 12)}…` : '';
}

export function defaultCaseName(title, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const subject = String(title || '').trim().slice(0, 100);
  return `${subject || 'Case'} — ${day}`;
}
