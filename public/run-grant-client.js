const TARGET_KEYS = ['target','domain','host','hostname','ip','email','url','query','search','username','phone','cve','hash'];

function scalar(value) {
  return ['string','number','boolean'].includes(typeof value) && String(value).trim() ? String(value).trim() : '';
}

// Give the confirmation a human-readable target. The server also binds the grant to the complete argument object.
export function grantTarget(args = {}, fallback = 'this tool') {
  for (const key of TARGET_KEYS) {
    const value = scalar(args?.[key]);
    if (value) return value;
  }
  for (const value of Object.values(args || {})) {
    const found = scalar(value);
    if (found) return found;
  }
  return String(fallback || 'this tool');
}

export function buildRunGrantRequest({tool, server, args, confirmation}) {
  const target = grantTarget(args, tool.name);
  return {
    purpose: 'tool-library',
    target,
    level: tool.risk.level,
    tools: [{endpoint: server.endpoint, name: tool.name, arguments: args}],
    confirmation
  };
}
