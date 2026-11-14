import {extractTarget,searchIntent,searchSubjectFor,argsForSearch} from './search-query.js';
import {isPassiveSearchTool} from './search-planner.js';

// What a passive search is (a target for Deep Search, or a name/company/news search) and which sources it runs.

const TARGET_LABELS={domain:'website',ip:'IP address',username:'username',email:'email address',phone:'phone number',cve:'vulnerability ID',hash:'file hash'};
const COMPANY_INTENTS=new Set(['organization','filings','offshore']);
// Topic intents that are about a person or organisation, not an event. Every other topic intent is an event.
const NOT_EVENT_INTENTS=new Set(['organization','filings','offshore','sanctions','entity']);
const COMPANY_SUFFIX=/\b(?:inc|ltd|llc|plc|ag|gmbh|sa|corp|company)\.?$/i;
const RECORD_TOOLS=new Set(['get_sanctions','get_opensanctions','get_sec_filings','get_offshore_leaks','get_opencorporates']);
const ORGANISATION_CLASSES=new Set(['wd:Q4830453','wd:Q43229','wd:Q783794','wd:Q6881511']);
const TARGET_INTENTS=new Set(['cve','malware','network','email','username','domain','phone']);

export function passiveQuery(query){
  const text=String(query||'').trim();
  const target=extractTarget(text);
  if(target&&TARGET_LABELS[target.type])return{kind:'target',target,label:TARGET_LABELS[target.type]};
  const intentId=searchIntent(text).id;
  let subject=searchSubjectFor(text).trim();
  // When the subject is only a topic word again ("latest news" -> "news", "company news" -> "news"), nobody is named.
  if(subject&&!/\s/.test(subject)&&searchIntent(subject).id!=='entity'&&intentId!=='entity')subject='';
  const company=COMPANY_INTENTS.has(intentId)||COMPANY_SUFFIX.test(subject);
  const event=intentId==='news'||(!NOT_EVENT_INTENTS.has(intentId)&&!TARGET_INTENTS.has(intentId));
  // `query` is the full text, which news and data sources are searched with.
  return{kind:'search',subject,event,company,intentId,query:text};
}

function groupFor(name){
  if(RECORD_TOOLS.has(name))return 'records';
  if(/_news$|_feeds$/.test(name)||name==='get_gdelt'||name==='get_news_rss')return 'news';
  return 'data';
}

function sourceFor(tool,group,info){
  if(tool.name==='get_news_rss')return{tool,group,args:{}};
  const text=group==='identity'||group==='records'?info.subject:(info.query||info.subject);
  return{tool,group,args:argsForSearch(tool,text)};
}

export function passiveSources(info,tools){
  if(!info||info.kind!=='search')return[];
  const connected=new Map();
  for(const tool of tools||[])if(tool?.name&&!connected.has(tool.name)&&isPassiveSearchTool(tool))connected.set(tool.name,tool);
  const hasSubject=Boolean(info.subject);
  const plan=[];
  if(hasSubject){
    plan.push(['identity','get_wikidata']);
  }
  plan.push(['news','get_news_rss'],['news','get_gdelt']);
  if(hasSubject){
    plan.push(['records','get_opensanctions'],['records','get_offshore_leaks']);
    if(info.company)plan.push(['records','get_opencorporates'],['records','get_sec_filings']);
  }
  const intent=searchIntent(info.query||info.subject);
  for(const name of intent.tools){
    // Passive search never uses Hacker News, and with no subject there is nobody to look up.
    if(name==='get_hn_search'||(name==='get_wikidata'&&!hasSubject))continue;
    const group=groupFor(name);
    if((group==='records')&&!hasSubject)continue;
    plan.push([group,name]);
  }
  const seen=new Set();const sources=[];
  for(const [group,name] of plan){
    const tool=connected.get(name);
    if(!tool||seen.has(name))continue;
    seen.add(name);
    sources.push(sourceFor(tool,group,info));
  }
  return sources;
}

function isOrganisation(entity){
  const value=entity?.facts?.instanceOf;
  const list=Array.isArray(value)?value:value==null?[]:[value];
  return list.some(item=>ORGANISATION_CLASSES.has(typeof item==='string'?item:item?.id||item?.qid));
}

// Company registers and filings, added once Wikidata says the subject is an organisation.
export function addCompanySources(info,tools,wikidataEntity){
  if(!info||info.kind!=='search'||!info.subject||!isOrganisation(wikidataEntity))return[];
  const planned=new Set(passiveSources(info,tools).map(source=>source.tool.name));
  return passiveSources({...info,company:true},tools).filter(source=>source.group==='records'&&!planned.has(source.tool.name)&&['get_opencorporates','get_sec_filings'].includes(source.tool.name));
}
