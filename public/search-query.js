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

// A map area typed as four comma-separated numbers ("24,54,26,56"), normalised without spaces. The order is
// passed through unchanged, because tools differ (get_aircraft documents south,west,north,east).
const NUMBER='-?\\d{1,3}(?:\\.\\d+)?';
const MAP_AREA=new RegExp(`(?<![\\d.])(${NUMBER})\\s*,\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*,\\s*(${NUMBER})(?![\\d.])`);
export function extractMapArea(query){
  const match=String(query).match(MAP_AREA);
  return match?match.slice(1,5).join(','):null;
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

// Intents chosen from topic words when the search names no target, checked in order.
// Each entry: id, label, preferred tools, and the topic-word pattern.
const TOPIC_INTENTS=[
  ['sanctions','Sanctions screening',['get_opensanctions','get_sanctions'],/\b(sanction|ofac|sdn|pep|embargo)\b/i],
  ['hazard','Natural hazard intelligence',['get_earthquakes','get_natural_events','get_disaster_alerts'],/\b(earthquake|wildfire|hurricane|storm|flood|volcano|disaster|natural hazard)\b/i],
  ['maritime','Maritime intelligence',['get_maritime_news','get_chokepoints','get_ais_vessels'],/\b(vessel|ship|maritime|port|chokepoint|piracy)\b/i],
  ['aviation','Aviation intelligence',['get_notams','get_aviation_news','get_aircraft'],/\b(aircraft|flight|airport|aviation|notam|airspace)\b/i],
  ['cyber','Cyber threat intelligence',['get_cyber_news','get_ransomware','get_threatfox'],/\b(cyber|ransomware|malware|threat actor|ioc|phishing|botnet)\b/i],
  ['research','Research literature',['get_arxiv'],/\b(paper|research|study|academic|arxiv|literature)\b/i],
  ['crypto','Cryptocurrency and market context',['get_crypto','get_fear_greed','get_stablecoins'],/\b(crypto|bitcoin|ethereum|stablecoin|blockchain)\b/i],
  ['markets','Market and company profile',['get_fmp_quote','get_fmp_profile','get_sec_filings'],/\b(stock|share price|ticker|equity|market quote)\b/i],
  ['economy','Economic indicators',['get_economic_macro','get_bis_rates','get_bis_fx'],/\b(gdp|inflation|unemployment|economic|economy|interest rate|exchange rate)\b/i],
  ['filings','Corporate filings',['get_sec_filings','get_opencorporates'],/\b(sec filing|10-k|10-q|8-k|edgar)\b/i],
  ['github','Public development activity',['get_github_activity','get_hn_search'],/\b(github|repository|open source project|developer activity)\b/i],
  ['satellite','Satellite and imagery context',['get_satellite_snapshot','get_satellites'],/\b(satellite|imagery|orbit|spacecraft)\b/i],
  ['election','Election monitoring',['get_election_monitor','get_news_rss'],/\b(election|vote|polling|ballot)\b/i],
  ['health','Health and outbreak intelligence',['get_health_advisories','get_news_rss'],/\b(outbreak|disease|health advisory|epidemic|pandemic)\b/i],
  ['nuclear','Nuclear and arms-control intelligence',['get_nuclear_status','get_radiation_safecast'],/\b(nuclear|arms control|radiation|iaea)\b/i],
  ['energy','Energy and commodities intelligence',['get_energy_commodities_news','get_critical_minerals'],/\b(oil|gas|lng|energy|commodity|uranium|mineral)\b/i],
  ['offshore','Offshore entity intelligence',['get_offshore_leaks','get_opencorporates'],/\b(offshore|panama papers|paradise papers|pandora papers|shell company)\b/i],
  ['food','Food-security intelligence',['get_food_security','get_news_rss'],/\b(food security|famine|hunger|crop)\b/i],
  ['location','Location and country context',['get_geocode','get_country_facts','get_travel_advisories'],/\b(country|city|location|coordinates|geocode|travel advisory|place)\b/i],
  ['organization','Organization intelligence',['get_wikidata','get_opencorporates','get_news_rss'],/\b(company|corporation|business|filing|organization|hospital|university|nonprofit)\b/i],
  ['news','Current-event coverage',['get_gdelt','get_news_velocity','get_news_rss'],/\b(latest|recent|news|current|today|event|developments)\b/i],
];

const intent=(id,label,tools)=>({id,label,tools});
export function searchIntent(query){
  const q=query.trim(); const singular=singularWords(q); const has=pattern=>pattern.test(q)||pattern.test(singular);
  const target=extractTarget(q);
  if(/\bCVE-\d{4}-\d+\b/i.test(q))return intent('cve','Vulnerability intelligence',['get_nvd_cves','get_cisa_kev','omega_cvssrank']);
  if(/\b(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})\b/.test(q))return intent('malware','File and malware reputation',['get_malwarebazaar','omega_malware']);
  if(target?.type==='ip')return intent('network','IP and network intelligence',['get_bgp','get_greynoise','get_whois','omega_ipdossier','omega_intel']);
  if(target?.type==='email')return intent('email','Public email-account presence',['holehe_email_search','omega_email']);
  if(target?.type==='username')return intent('username','Public username presence',['sherlock_username_search','blackbird_username_search','omega_gitrecon']);
  if(target?.type==='domain')return intent('domain','Domain intelligence',['whois_lookup','dnstwist_lookalike_domains','omega_intel']);
  if(target?.type==='phone')return intent('phone','Public phone information',['phoneinfoga_scan']);
  if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(q)||/\b(ip address|asn|bgp|routing)\b/i.test(q))return intent('network','IP and network intelligence',['get_bgp','get_greynoise','get_whois']);
  if(/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/.*)?$/i.test(q)||/\b(domain|website|whois|certificate|dns)\b/i.test(q))return intent('domain','Domain intelligence',['whois_lookup','dnstwist_lookalike_domains']);
  if(/^@?[a-z0-9_.-]{2,32}$/i.test(q)&&(/^@/.test(q)||/\b(username|handle|account)\b/i.test(q)))return intent('username','Public username presence',['sherlock_username_search','blackbird_username_search']);
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q))return intent('email','Public email-account presence',['holehe_email_search']);
  if(/^\+?[\d\s().-]{8,}$/.test(q))return intent('phone','Public phone information',['phoneinfoga_scan']);
  const topic=TOPIC_INTENTS.find(([,,,pattern])=>has(pattern));
  if(topic)return intent(...topic);
  return intent('entity','Entity and related coverage',['get_wikidata','get_news_rss','get_hn_search']);
}

// Words that frame a search rather than name its subject. They are trimmed only from the ends,
// so a name such as "Bank of America" keeps its inner words.
const FRAMING_WORDS=new Set(['a','an','the','in','on','near','of','for','about','against','around','at','by','from','to','with','and',
  'latest','recent','current','today','news','developments','updates','update','reports','report','info','information','data',
  'price','prices','threat','threats','activity','alerts','leaks']);

function trimFraming(text){
  const words=text.split(/\s+/).filter(Boolean);
  while(words.length&&FRAMING_WORDS.has(words[0].toLowerCase()))words.shift();
  while(words.length&&FRAMING_WORDS.has(words.at(-1).toLowerCase()))words.pop();
  return words.join(' ');
}

// What a search without a target is about: the phrase without the matched intent's topic words
// ("OFAC sanctions on Rosneft" -> "Rosneft"). When the topic word is the subject ("bitcoin price"),
// only the framing words go; when nothing would remain, the phrase is kept.
function searchSubject(text,intentId){
  const pattern=TOPIC_INTENTS.find(([id])=>id===intentId)?.[3];
  const withoutTopic=pattern?text.replace(new RegExp(pattern.source,'gi'),' ').split(/\s+/)
    .filter(word=>!pattern.test(singularWords(word))).join(' '):text;
  return trimFraming(withoutTopic)||trimFraming(text)||text;
}

// Arguments that keep a tool within the 45-second request limit in automatic searches. Tool Library runs
// build their own arguments and are unaffected. theHarvester queries every source by default (223 s for
// example.com); these keyless certificate and DNS sources took 11-20 s.
const AUTO_SEARCH_ARGS={theharvester_domain_search:{sources:'crtsh,hackertarget,rapiddns,otx'}};

function supportedFormat(schema,preferred='json'){
  const allowed=Array.isArray(schema?.enum)?schema.enum:[];
  if(!allowed.length||allowed.includes(preferred))return preferred;
  if(schema.default!==undefined&&allowed.includes(schema.default))return schema.default;
  return allowed[0];
}

export function argsForSearch(tool,query){
  const props=tool.inputSchema?.properties||{}; const required=tool.inputSchema?.required||[]; const args={};
  let clean=query.replace(/^(?:https?:\/\/)/i,'').replace(/^@/,'').replace(/\/$/,'').trim();
  clean=clean.replace(/^(?:location|city|country|organization|company|business|domain|website|username|handle|news|current events?|academic|research)\s*(?::|-)?\s+/i,'');
  clean=clean.replace(/^(?:recent|latest|current|today'?s?)\s+/i,'').replace(/\s+(?:news|developments|updates)$/i,'').trim();
  const target=extractTarget(query);
  // Coordinates are for map-area tools only; as another tool's text filter they would match nothing.
  if(!target)clean=searchSubject(clean.replace(MAP_AREA,' ').replace(/\s+/g,' ').trim(),searchIntent(query).id);
  const countryQuery=target?target.value:['get_country_facts','get_travel_advisories'].includes(tool.name)&&clean.includes(',')?clean.split(',').at(-1).trim():clean;
  const queryKey=['query','target','keyword','username','email','number','identifier','domain','search','q'].find(key=>props[key]);
  const mapArea=required.includes('bbox')?extractMapArea(query):null;
  if(mapArea)args.bbox=mapArea;
  else if(queryKey)args[queryKey]=countryQuery;
  if(props.limit)args.limit=10;
  if(props.timeout)args.timeout=25;
  if(props.only_used)args.only_used=true;
  if(props.registered_only)args.registered_only=true;
  if(props.output_format)args.output_format=supportedFormat(props.output_format);
  if(props.format)args.format=supportedFormat(props.format);
  for(const key of required){if(args[key]!==undefined)continue;const schema=props[key]||{};args[key]=schema.type==='number'?10:schema.type==='boolean'?false:countryQuery;}
  Object.assign(args,AUTO_SEARCH_ARGS[tool.name]);
  return args;
}
