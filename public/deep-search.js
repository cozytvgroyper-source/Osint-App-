import {argsForSearch,extractTarget} from './search-query.js';
import {toolRisk} from './tool-tiers.js';

const PREFERRED = {
  domain: ['whois_lookup','dns_lookup','crtsh_certificate_search','omega_whois','omega_dns','omega_crtsh','omega_headers','omega_ssl','omega_tech','omega_cors','omega_mailsec','omega_ports','omega_crawl','omega_dnsbrute','omega_subdomains','omega_vuln','omega_fuzzer'],
  ip: ['get_bgp','get_greynoise','get_whois','omega_ipinfo','omega_asn','omega_reverseip','omega_headers','omega_ssl','omega_ports','omega_vuln'],
  email: ['holehe_email_search','omega_email','omega_breach','omega_social'],
  username: ['sherlock_username_search','blackbird_username_search','maigret_username_search','omega_username','omega_social'],
  cve: ['get_nvd_cves','get_cisa_kev','omega_cve','omega_cvemap','omega_cvssrank','omega_vuln'],
  hash: ['get_malwarebazaar','omega_malware','omega_ioc'],
  phone: ['phoneinfoga_scan','omega_phoneosint']
};

export function deepSearchPlan(tools, target, level, maxTools = 18) {
  const typed = String(target || '').trim();
  const targetType = extractTarget(typed)?.type || 'domain';
  const order = PREFERRED[targetType] || PREFERRED.domain;
  const rank = new Map(order.map((name,index)=>[name,index]));
  return tools.filter(tool=>toolRisk(tool).level<=level&&rank.has(tool.name))
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
