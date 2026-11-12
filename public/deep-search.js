import {argsForSearch,extractTarget} from './search-query.js';
import {toolRisk} from './tool-tiers.js';

// Deep Search candidates per target type, in plan order: passive sources first, then each higher tier. One source per
// capability (no Toolbox/Omega duplicate pairs), only tools the source review kept (docs/omega-tool-review.md), and only
// tools that suit the target type. tests/deep-search.test.mjs checks every name against the real tool list.
export const DEEP_SEARCH_TOOLS = {
  domain: ['whois_lookup','dns_lookup','crtsh_certificate_search','omega_intel','wayback_snapshots','omega_spoofcheck',
    'dnstwist_lookalike_domains','theharvester_domain_search',
    'omega_headers','omega_ssl','omega_tech','omega_cors','omega_mailsec',
    'omega_ports','omega_crawl','omega_dnsbrute','omega_subdomains','omega_vuln','omega_fuzzer'],
  ip: ['get_bgp','get_greynoise','get_whois','omega_ipinfo','omega_ipdossier','omega_intel','omega_asn','omega_reverseip',
    'omega_headers','omega_ssl','omega_ports','omega_vuln'],
  email: ['holehe_email_search','omega_email','omega_breach'],
  username: ['sherlock_username_search','blackbird_username_search','maigret_username_search','omega_gitrecon'],
  cve: ['get_nvd_cves','get_cisa_kev','get_epss','omega_cvssrank','omega_cve'],
  hash: ['get_malwarebazaar','omega_malware'],
  phone: ['phoneinfoga_scan']
};

export function deepSearchPlan(tools, target, level, maxTools = 18) {
  const typed = String(target || '').trim();
  const targetType = extractTarget(typed)?.type || 'domain';
  const order = DEEP_SEARCH_TOOLS[targetType] || DEEP_SEARCH_TOOLS.domain;
  const rank = new Map(order.map((name,index)=>[name,index]));
  // Flagged tools (credits, side effects) and tools a server annotates as writing never enter a plan, whatever the list says.
  const plannable = tool => { const risk = toolRisk(tool); return risk.level <= level && !risk.flags.length
    && tool.annotations?.readOnlyHint !== false && tool.annotations?.destructiveHint !== true; };
  return tools.filter(tool=>plannable(tool)&&rank.has(tool.name))
    .sort((a,b)=>rank.get(a.name)-rank.get(b.name))
    .slice(0,maxTools)
    .map(tool=>({tool,args:argsForSearch(tool,typed),risk:toolRisk(tool),selected:true}));
}

export function deepRunBlocked({target,level,authorization,typedTarget,selectedCount}) {
  if(!String(target||'').trim())return 'Type the target explicitly.';
  if(!selectedCount)return 'Select at least one tool.';
  if(!authorization)return 'Confirm that you own this target or have written permission to test it.';
  if(Number(level)===3&&String(typedTarget||'').trim()!==String(target).trim())return `Type ${String(target).trim()} exactly to confirm.`;
  return '';
}
