const EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const DOMAIN = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})\.?$/i;

function isIpv4(value) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIpv6(value) {
  if (!value.includes(':') || !/^[0-9a-f:]+$/i.test(value)) return false;
  try { new URL(`http://[${value}]/`); return true; } catch { return false; }
}

// Only exact scalar targets become pivots. Descriptions and sentences stay plain text, which keeps the result view
// from turning every incidental mention into an action.
export function resultPivot(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || /\s/.test(text)) return null;
  if (EMAIL.test(text)) return {type: 'email', target: text.toLowerCase(), label: 'Investigate email'};
  if (isIpv4(text) || isIpv6(text)) return {type: 'IP address', target: text.toLowerCase(), label: 'Investigate IP address'};
  if (DOMAIN.test(text)) return {type: 'domain', target: text.replace(/^\*\./, '').replace(/\.$/, '').toLowerCase(), label: 'Investigate domain'};
  return null;
}
