// Risk tiers for every connected tool: what running it does to the target. The main search may only run Tier 0, which
// tests/tool-tiers.test.mjs enforces against the planner. Tool Library groups tools by tier and asks for confirmation
// before Tier 2+. Design and open review questions: docs/search-overhaul.md.
import {isPassiveSearchTool} from './search-planner.js';

export const TIERS = Object.freeze([
  {level: 0, key: 'passive', label: 'Passive', targetSees: 'Nothing: it asks public databases and third parties.'},
  {level: 1, key: 'light', label: 'Light touch', targetSees: 'A normal visit or connection, like one browser loading the site.'},
  {level: 2, key: 'active', label: 'Active', targetSees: 'Probing or enumeration that is likely to show in its logs or alerts.'},
  {level: 3, key: 'intrusive', label: 'Intrusive', targetSees: 'Attack-style testing. Only run it on systems you own or have written permission to test.'}
]);

// Flags: 'credits' spends paid AI credits; 'side-effects' sends, stores, schedules or loads something beyond a lookup;
// 'review' marks a call made from a one-line description that the owner has not confirmed yet (docs/search-overhaul.md).
// The owner confirmed every such call on 2026-11-11, so none is flagged now.
const t = (level, ...flags) => ({level, flags});

// OSINT Toolbox: well-known open-source tools, so their behaviour is documented.
const TOOLBOX = {
  sherlock_username_search: t(0), holehe_email_search: t(0), ghunt_google_search: t(0), maigret_username_search: t(0),
  theharvester_domain_search: t(0), blackbird_username_search: t(0), phoneinfoga_scan: t(0), exiftool_metadata: t(0),
  subfinder_subdomain_search: t(0), dnstwist_lookalike_domains: t(0), whois_lookup: t(0), dns_lookup: t(0),
  crtsh_certificate_search: t(0), wayback_snapshots: t(0), osint_toolbox_status: t(0),
  spiderfoot_scan: t(2), // can run active modules against the target
  dnsrecon_domain_scan: t(2) // attempts zone transfers and zone walking against the target's name servers
};

// Omega MCP: tiers from each tool's description, all confirmed by the owner on 2026-11-11.
const OMEGA = {
  // Tier 0: third-party data, public records, or analysis of findings already collected.
  omega_whois: t(0), omega_dns: t(0), omega_ipinfo: t(0), omega_crtsh: t(0), omega_dorks: t(0), omega_wayback: t(0),
  omega_spoofcheck: t(0), omega_asn: t(0), omega_reverseip: t(0), omega_cve: t(0), omega_hunt: t(0), omega_malware: t(0),
  omega_email: t(0), omega_username: t(0), omega_social: t(0), omega_breach: t(0),
  omega_agents_list: t(0), omega_memory_search: t(0), omega_apiosint: t(0), omega_satellite: t(0),
  omega_autocorr: t(0), omega_compare: t(0), omega_briefing: t(0), omega_executive: t(0), omega_cryptoosint: t(0),
  omega_codetrace: t(0), omega_leaked: t(0), omega_cvemap: t(0), omega_cvssrank: t(0), omega_dark: t(0),
  omega_deepweb: t(0), omega_torcheck: t(0), omega_imgosint: t(0), omega_ipdossier: t(0), omega_intel: t(0),
  omega_phoneosint: t(0), omega_finance: t(0), omega_geoint: t(0), omega_gitrecon: t(0), omega_graph: t(0),
  omega_viz: t(0), omega_timeline: t(0), omega_timeline3d: t(0), omega_harvester: t(0), omega_identity: t(0),
  omega_persona: t(0), omega_org: t(0), omega_riskcore: t(0), omega_shodan: t(0), omega_socmint: t(0),
  omega_stix: t(0), omega_supply: t(0), omega_threatfeed: t(0), omega_threatintel: t(0), omega_typosquat: t(0),
  omega_c2: t(0), omega_mldetect: t(0),
  omega_osintdb: t(0, 'side-effects'), omega_dashboard: t(0, 'side-effects'), omega_livedash: t(0, 'side-effects'),
  omega_pdfreport: t(0, 'side-effects'), omega_reportgen: t(0, 'side-effects'), omega_reporthtml: t(0, 'side-effects'),
  omega_pastewatch: t(0, 'side-effects'), omega_notifier: t(0, 'side-effects'),
  // Captured output (2026-11-11) showed it submitting the target to the Wayback Machine's Save Page Now.
  omega_archive: t(0, 'side-effects'),
  omega_ai_analyst: t(0, 'credits'), omega_aiassist: t(0, 'credits'), omega_aisummary: t(0, 'credits'),
  // Tier 1: connects to the target like a visitor (fetches pages, headers, certificates, DNS for its mail policy).
  omega_headers: t(1), omega_ssl: t(1), omega_tech: t(1), omega_cors: t(1), omega_mailsec: t(1), omega_infra: t(1),
  omega_crypto: t(1), omega_screenshot: t(1), omega_certhunt: t(1), omega_ioc: t(1),
  omega_docosint: t(1), omega_phishcheck: t(1), omega_opsec: t(1),
  omega_dossier: t(1), omega_network: t(1), omega_firmware: t(1), omega_mobile: t(1),
  omega_watcher: t(1, 'side-effects'), omega_monitor: t(1, 'side-effects'),
  // Tier 2: probing and enumeration that shows in the target's logs.
  // omega_recon's captured output (2026-11-11) included a port scan, subdomain brute force and HTTP/SSL probes.
  omega_recon: t(2),
  omega_ports: t(2), omega_jscan: t(2), omega_crawl: t(2), omega_spider: t(2), omega_webcrawl: t(2), omega_dnsbrute: t(2),
  omega_buckets: t(2), omega_cloud: t(2), omega_cloud2: t(2), omega_subdomains: t(2), omega_assetmap: t(2),
  omega_attackmap: t(2), omega_wordlist: t(2), omega_secrets: t(2), omega_auto: t(2), omega_deception: t(2),
  omega_creds: t(2),
  // Tier 3: attack-style testing, autonomous attack workflows, or arbitrary code.
  omega_vuln: t(3), omega_fuzzer: t(3), omega_redteam: t(3), omega_pivot: t(3), omega_exfil: t(3),
  omega_proxy: t(3, 'side-effects'), omega_chain: t(3), omega_plugin: t(3, 'side-effects'),
  omega_autopilot: t(3, 'credits'), omega_agent_run: t(3, 'credits')
};

// Whole servers reviewed as Tier 0 (2026-11-11). Open OSINT: all 107 tools read public feeds and databases through
// its data service and never take a target to crawl or probe. Consensus: its 5 tools search published research papers.
const PASSIVE_SERVERS = new Set(['Open OSINT', 'Consensus']);

const UNREVIEWED = {level: 3, flags: []};

export function toolRisk(tool) {
  const entry = TOOLBOX[tool.name] ?? OMEGA[tool.name] ?? (PASSIVE_SERVERS.has(tool.serverName) ? t(0) : null);
  const {level, flags} = entry ?? UNREVIEWED;
  const tier = TIERS[level];
  return {
    level, key: entry ? tier.key : 'unreviewed', label: entry ? tier.label : 'Unreviewed',
    targetSees: entry ? tier.targetSees : 'Unknown: nobody has reviewed this tool yet, so it is treated as intrusive.',
    reviewed: Boolean(entry), flags: flags.filter(flag => flag !== 'review'), needsReview: flags.includes('review')
  };
}

// What Tool Library must ask before running a controlled tool.
export function runRequirements(risk) {
  const credits = risk.flags.includes('credits');
  const sideEffects = risk.flags.includes('side-effects');
  return {
    acknowledgement: risk.level >= 1 || credits || sideEffects,
    authorization: risk.level >= 2,
    typeName: risk.level >= 3,
    credits,
    sideEffects
  };
}

export function groupToolsByTier(tools) {
  const groups = [...TIERS.map(tier => ({tier, tools: []})), {tier: {level: 3, key: 'unreviewed', label: 'Unreviewed', targetSees: 'Unknown'}, tools: []}];
  for (const tool of tools) {
    const risk = toolRisk(tool);
    groups[risk.reviewed ? risk.level : 4].tools.push(tool);
  }
  return groups.filter(group => group.tools.length);
}

// The main search only runs passive tools that the planner allows (no slow or unreviewed ones).
export function toolUsage(tool) {
  return toolRisk(tool).level === 0 && isPassiveSearchTool(tool) ? 'Main search can use it' : 'Tool Library only';
}
