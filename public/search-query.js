// Turns a typed search into an intent (which kind of sources to use) and per-tool arguments.

// A search often names one concrete target (a domain, IP, email, username...) plus words about
// it ("example.com whois"). Tools that look a target up need only the target itself.
const OCTET='(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
const TARGET_PATTERNS=[
  ['email',/(?:^|[\s<(])([a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,63})(?=$|[\s>),;!?]|\.(?:\s|$))/i],
  ['url',/\bhttps?:\/\/([^\s/?#:]+)/i],
  ['cve',/\b(CVE-\d{4}-\d{4,})\b/i],
  ['hash',/\b([a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{32})\b/i],
  ['ip',new RegExp(`(?<![\\d.])((?:${OCTET}\\.){3}${OCTET})(?![\\d]|\\.\\d)`)],
  ['username',/(?:^|\s)@([a-z0-9_](?:[a-z0-9_.-]{0,30}[a-z0-9_])?)(?=$|\s)/i],
  ['username',/\b(?:username|handle)\s*[:=]?\s*@?([a-z0-9_](?:[a-z0-9_.-]{0,30}[a-z0-9_])?)(?=$|\s)/i],
  ['domain',/(?<![@\w.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(?![\w-]|\.[a-z0-9])/i],
  ['phone',/^(\+?[\d\s().-]{8,})$/]
];

function findTarget(query){
  const text=String(query).trim();
  for(const [kind,pattern] of TARGET_PATTERNS){
    const match=text.match(pattern);
    if(!match)continue;
    const raw=match[1];
    if(kind==='phone'&&raw.replace(/\D/g,'').length<7)continue;
    if(kind==='url'){
      const host=raw.toLowerCase();
      return{type:new RegExp(`^(?:${OCTET}\\.){3}${OCTET}$`).test(host)?'ip':'domain',value:host,raw:text.match(/\bhttps?:\/\/\S+/i)[0]};
    }
    const value=kind==='cve'?raw.toUpperCase():kind==='domain'||kind==='email'?raw.toLowerCase():raw.trim();
    return{type:kind,value,raw:match[0].trim()};
  }
  return null;
}

export function extractTarget(query){
  const target=findTarget(query);
  return target?{type:target.type,value:target.value}:null;
}

// The search text with the target removed, so a domain's ".com" is not matched as the word "com".
export function splitTarget(query){
  const target=findTarget(query);
  if(!target)return{text:String(query),target:null};
  return{text:String(query).replace(target.raw,' ').replace(/\s+/g,' ').trim(),target:{type:target.type,value:target.value}};
}

function singularWords(text){
  return text.replace(/[a-z]+/gi,word=>{
    const lower=word.toLowerCase();
    if(lower.length>4&&lower.endsWith('ies'))return `${word.slice(0,-3)}y`;
    if(/(?:ss|sh|ch|x)es$/.test(lower))return word.slice(0,-2);
    if(lower.length>3&&/[^s]s$/.test(lower))return word.slice(0,-1);
    return word;
  });
}

const intent=(id,label,tools)=>({id,label,tools});
export function searchIntent(query){
  const q=query.trim(); const singular=singularWords(q); const has=pattern=>pattern.test(q)||pattern.test(singular);
  const target=extractTarget(q);
  if(/\bCVE-\d{4}-\d+\b/i.test(q))return intent('cve','Vulnerability intelligence',['get_nvd_cves','get_cisa_kev']);
  if(/\b(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})\b/.test(q))return intent('malware','File and malware reputation',['get_malwarebazaar','omega_malware']);
  if(target?.type==='ip')return intent('network','IP and network intelligence',['get_bgp','get_greynoise','get_whois']);
  if(target?.type==='email')return intent('email','Public email-account presence',['holehe_email_search']);
  if(target?.type==='username')return intent('username','Public username presence',['sherlock_username_search','blackbird_username_search']);
  if(target?.type==='domain')return intent('domain','Domain intelligence',['whois_lookup','dnstwist_lookalike_domains']);
  if(target?.type==='phone')return intent('phone','Public phone information',['phoneinfoga_scan']);
  if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(q)||/\b(ip address|asn|bgp|routing)\b/i.test(q))return intent('network','IP and network intelligence',['get_bgp','get_greynoise','get_whois']);
  if(/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/.*)?$/i.test(q)||/\b(domain|website|whois|certificate|dns)\b/i.test(q))return intent('domain','Domain intelligence',['whois_lookup','dnstwist_lookalike_domains']);
  if(/^@?[a-z0-9_.-]{2,32}$/i.test(q)&&(/^@/.test(q)||/\b(username|handle|account)\b/i.test(q)))return intent('username','Public username presence',['sherlock_username_search','blackbird_username_search']);
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q))return intent('email','Public email-account presence',['holehe_email_search']);
  if(/^\+?[\d\s().-]{8,}$/.test(q))return intent('phone','Public phone information',['phoneinfoga_scan']);
  if(has(/\b(sanction|ofac|sdn|pep|embargo)\b/i))return intent('sanctions','Sanctions screening',['get_opensanctions','get_sanctions']);
  if(has(/\b(earthquake|wildfire|hurricane|storm|flood|volcano|disaster|natural hazard)\b/i))return intent('hazard','Natural hazard intelligence',['get_earthquakes','get_natural_events','get_disaster_alerts']);
  if(has(/\b(vessel|ship|maritime|port|chokepoint|piracy)\b/i))return intent('maritime','Maritime intelligence',['get_maritime_news','get_chokepoints','get_ais_vessels']);
  if(has(/\b(aircraft|flight|airport|aviation|notam|airspace)\b/i))return intent('aviation','Aviation intelligence',['get_notams','get_aviation_news','get_aircraft']);
  if(has(/\b(cyber|ransomware|malware|threat actor|ioc|phishing|botnet)\b/i))return intent('cyber','Cyber threat intelligence',['get_cyber_news','get_ransomware','get_threatfox']);
  if(has(/\b(paper|research|study|academic|arxiv|literature)\b/i))return intent('research','Research literature',['get_arxiv']);
  if(has(/\b(crypto|bitcoin|ethereum|stablecoin|blockchain)\b/i))return intent('crypto','Cryptocurrency and market context',['get_crypto','get_fear_greed','get_stablecoins']);
  if(has(/\b(stock|share price|ticker|equity|market quote)\b/i))return intent('markets','Market and company profile',['get_fmp_quote','get_fmp_profile','get_sec_filings']);
  if(has(/\b(gdp|inflation|unemployment|economic|economy|interest rate|exchange rate)\b/i))return intent('economy','Economic indicators',['get_economic_macro','get_bis_rates','get_bis_fx']);
  if(has(/\b(sec filing|10-k|10-q|8-k|edgar)\b/i))return intent('filings','Corporate filings',['get_sec_filings','get_opencorporates']);
  if(has(/\b(github|repository|open source project|developer activity)\b/i))return intent('github','Public development activity',['get_github_activity','get_hn_search']);
  if(has(/\b(satellite|imagery|orbit|spacecraft)\b/i))return intent('satellite','Satellite and imagery context',['get_satellite_snapshot','get_satellites']);
  if(has(/\b(election|vote|polling|ballot)\b/i))return intent('election','Election monitoring',['get_election_monitor','get_news_rss']);
  if(has(/\b(outbreak|disease|health advisory|epidemic|pandemic)\b/i))return intent('health','Health and outbreak intelligence',['get_health_advisories','get_news_rss']);
  if(has(/\b(nuclear|arms control|radiation|iaea)\b/i))return intent('nuclear','Nuclear and arms-control intelligence',['get_nuclear_status','get_radiation_safecast']);
  if(has(/\b(oil|gas|lng|energy|commodity|uranium|mineral)\b/i))return intent('energy','Energy and commodities intelligence',['get_energy_commodities_news','get_critical_minerals']);
  if(has(/\b(offshore|panama papers|paradise papers|pandora papers|shell company)\b/i))return intent('offshore','Offshore entity intelligence',['get_offshore_leaks','get_opencorporates']);
  if(has(/\b(food security|famine|hunger|crop)\b/i))return intent('food','Food-security intelligence',['get_food_security','get_news_rss']);
  if(has(/\b(country|city|location|coordinates|geocode|travel advisory|place)\b/i))return intent('location','Location and country context',['get_geocode','get_country_facts','get_travel_advisories']);
  if(has(/\b(company|corporation|business|filing|organization|hospital|university|nonprofit)\b/i))return intent('organization','Organization intelligence',['get_wikidata','get_opencorporates','get_news_rss']);
  if(has(/\b(latest|recent|news|current|today|event|developments)\b/i))return intent('news','Current-event coverage',['get_gdelt','get_news_velocity','get_news_rss']);
  return intent('entity','Entity and related coverage',['get_wikidata','get_news_rss','get_hn_search']);
}

export function argsForSearch(tool,query){
  const props=tool.inputSchema?.properties||{}; const required=tool.inputSchema?.required||[]; const args={};
  let clean=query.replace(/^(?:https?:\/\/)/i,'').replace(/^@/,'').replace(/\/$/,'').trim();
  clean=clean.replace(/^(?:location|city|country|organization|company|business|domain|website|username|handle|news|current events?|academic|research)\s*(?::|-)?\s+/i,'');
  clean=clean.replace(/^(?:recent|latest|current|today'?s?)\s+/i,'').replace(/\s+(?:news|developments|updates)$/i,'').trim();
  const target=extractTarget(query);
  const countryQuery=target?target.value:['get_country_facts','get_travel_advisories'].includes(tool.name)&&clean.includes(',')?clean.split(',').at(-1).trim():clean;
  const queryKey=['query','target','keyword','username','email','number','identifier','domain','search','q'].find(key=>props[key]);
  if(queryKey)args[queryKey]=countryQuery;
  if(props.limit)args.limit=10;
  if(props.timeout)args.timeout=25;
  if(props.only_used)args.only_used=true;
  if(props.registered_only)args.registered_only=true;
  if(props.output_format)args.output_format='json';
  if(props.format)args.format='json';
  for(const key of required){if(args[key]!==undefined)continue;const schema=props[key]||{};args[key]=schema.type==='number'?10:schema.type==='boolean'?false:countryQuery;}
  return args;
}
