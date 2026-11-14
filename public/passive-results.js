// Ranks and groups the answers of a passive search: who/what it is, news, related data, records.
// Pure functions only. Each result appears once, and the exact name outranks a mere mention.

const TEXT_FIELDS=['label','name','title','headline','aliases','description','summary','snippet','text','company','place'];
const TITLE_FIELDS=['title','label','name','place'];
const DATE_FIELDS=['pubDate','date','seendate','publishedAt','published'];
const LINK_FIELDS=['wikiUrl','url','link','searchUrl','opencorporates_url'];
const ARRAY_KEYS=['entities','items','articles','filings','results','data'];

const flat=value=>String(value??'').toLowerCase().replace(/\./g,'').replace(/\s+/g,' ').trim();
const squash=value=>flat(value).replace(/ /g,'');
const asList=value=>Array.isArray(value)?value:value==null||value===''?[]:[value];
const textOf=(item,fields)=>fields.flatMap(field=>asList(item?.[field]).map(v=>typeof v==='object'?'':String(v))).filter(Boolean).join(' ');

// Lower-case word tokens. Initials written with dots ("J. D.", "J.D.") become one token ("jd"); a lone letter without a dot stays a word.
const TOKEN=/(?:(?<![\p{L}\p{N}])\p{L}\.\s*)+|[\p{L}\p{N}]+/gu;
const tokens=text=>(String(text??'').toLowerCase().match(TOKEN)||[]).map(t=>t.replace(/[^\p{L}\p{N}]/gu,''));
const wordForm=text=>` ${tokens(text).join(' ')} `;

export function passiveTier(item,subject){
  const wanted=flat(subject);
  if(!wanted)return 3;
  const exact=squash(subject);
  const names=['label','name','title'].flatMap(f=>asList(item?.[f])).concat(asList(item?.aliases));
  if(names.some(n=>typeof n==='string'&&squash(n)===exact))return 5;
  const needle=wordForm(subject).trim();
  if(wordForm(textOf(item,TITLE_FIELDS)).includes(` ${needle} `))return 4;
  if(wordForm(textOf(item,TEXT_FIELDS)).includes(` ${needle} `))return 3;
  const subjectWords=tokens(subject).filter(w=>[...w].length>=2);
  if(!subjectWords.length)return 3;
  const present=new Set(tokens(textOf(item,TEXT_FIELDS)));
  const found=subjectWords.filter(w=>present.has(w)).length;
  return found===subjectWords.length?2:found>0?1:0;
}

function parseDate(value){
  if(value==null||value==='')return null;
  const text=String(value).trim();
  const compact=text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  const ms=compact?Date.UTC(+compact[1],+compact[2]-1,+compact[3],+compact[4],+compact[5],+compact[6]):Date.parse(text);
  return Number.isNaN(ms)?null:new Date(ms).toISOString();
}

function dateOf(item){
  for(const field of DATE_FIELDS){const parsed=parseDate(item?.[field]);if(parsed)return parsed;}
  return null;
}

function hostOf(link){
  try{return new URL(link).hostname.replace(/^www\./,'');}catch{return '';}
}

// classifyToolResult already returns the inner payload; unwrap a leftover envelope only when it holds no list of its own.
function payloadOf(outcome){
  const data=outcome?.data;
  if(data&&typeof data==='object'&&!Array.isArray(data)&&data.data&&typeof data.data==='object'&&!Object.entries(data).some(([k,v])=>k!=='data'&&hasList(v)))return data.data;
  return data;
}

const isRecordList=list=>Array.isArray(list)&&list.length>0&&list.every(x=>x&&typeof x==='object'&&!Array.isArray(x));
const hasList=value=>isRecordList(value)||(value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).some(isRecordList));

// The first array of objects in the payload, looking one level down when needed.
function firstItems(payload){
  if(isRecordList(payload))return payload;
  if(!payload||typeof payload!=='object')return[];
  for(const key of ARRAY_KEYS)if(isRecordList(payload[key]))return payload[key];
  for(const value of Object.values(payload))if(isRecordList(value))return value;
  for(const value of Object.values(payload))if(value&&typeof value==='object'&&!Array.isArray(value)){
    for(const inner of Object.values(value))if(isRecordList(inner))return inner;
  }
  return[];
}

function listFor(payload,key){
  return isRecordList(payload?.[key])?payload[key]:firstItems(payload);
}

const firstOf=(item,fields)=>{for(const f of fields){const v=item?.[f];if(typeof v==='string'&&v.trim())return v.trim();}return '';};
const keyFor=(group,tool,index)=>`${group}:${tool.name}:${index}`;
const labelFor=tool=>tool.name;

function newsItem(item,tool,index){
  const title=firstOf(item,['title','headline','name']);
  if(!title)return null;
  const link=firstOf(item,['link','url']);
  return{
    key:keyFor('news',tool,index),title,link,date:dateOf(item),
    source:firstOf(item,['source','domain'])||hostOf(link),
    snippet:firstOf(item,['snippet','description','summary']),
    tier:0,tool:tool.name,item,
  };
}

// OpenCorporates wraps each result as {company:{...}}; read both that and a flat record.
const flatRecord=item=>item?.company&&typeof item.company==='object'?{...item,...item.company}:item;

function recordItem(rawItem,tool,index){
  const name=tool.name;
  const item=flatRecord(rawItem);
  let title=firstOf(item,['name','entity','title','company','label']);
  let detail='';
  if(name==='get_opensanctions'||name==='get_sanctions'){
    if(item.dataset)detail=`Appears in ${item.dataset} — check before relying on it`;
  }else if(name==='get_sec_filings'){
    title=firstOf(item,['company'])||title;
    detail=[item.form,item.date].filter(Boolean).join(' · ');
  }else if(name==='get_offshore_leaks'){
    detail='Offshore Leaks';
  }else if(name==='get_opencorporates'){
    detail=[item.jurisdiction||item.jurisdiction_code,item.status||item.current_status].filter(Boolean).join(' · ');
  }
  if(!detail)detail=firstOf(item,['description','summary']);
  if(!title)return null;
  return{key:keyFor('records',tool,index),title,detail,link:firstOf(item,LINK_FIELDS),tier:0,tool:name,item:rawItem};
}

// One copy per link or title; the copy with the higher tier wins, the first one on a tie.
const dedupeNews=list=>{
  const byLink=new Map(),byTitle=new Map(),out=[];
  for(const n of list){
    const title=flat(n.title);
    const at=(n.link?byLink.get(n.link):undefined)??byTitle.get(title);
    if(at!==undefined){
      if(n.tier>out[at].tier){out[at]=n;if(n.link)byLink.set(n.link,at);byTitle.set(title,at);}
      continue;
    }
    out.push(n);
    if(n.link)byLink.set(n.link,out.length-1);
    byTitle.set(title,out.length-1);
  }
  return out;
};

function describeFailure(entry){
  return entry.status==='rejected'?String(entry.reason?.message||entry.reason||'The source failed.'):entry.value?.outcome?.error||'The source failed.';
}

export function buildPassiveResults({query,subject,event,sources,outcomes}){
  const result={query,subject,event,identity:{best:null,others:[]},news:[],data:[],records:[],hidden:{news:[],records:[]},sources:[],failed:[],pending:[]};
  const entities=[],news=[],records=[];
  (sources||[]).forEach((source,index)=>{
    const entry=outcomes?.[index];
    const tool=source.tool;
    const entryOut={label:labelFor(tool),tool:tool.name,state:'pending'};
    result.sources.push(entryOut);
    const mark=found=>{entryOut.state=found?'ok':'empty';};
    if(entry===undefined){result.pending.push(labelFor(tool));return;}
    if(entry.status==='rejected'){entryOut.state='failed';entryOut.error=describeFailure(entry);result.failed.push({label:labelFor(tool),error:entryOut.error});return;}
    const outcome=entry.value?.outcome;
    if(outcome?.kind==='error'){entryOut.state='failed';entryOut.error=describeFailure(entry);result.failed.push({label:labelFor(tool),error:entryOut.error});return;}
    if(outcome?.kind!=='data'){entryOut.state=outcome?.kind==='empty'?'empty':'failed';entryOut.error='Returned nothing.';result.failed.push({label:labelFor(tool),error:'Returned nothing.'});return;}
    const payload=payloadOf(outcome);
    if(source.group==='identity'){
      const list=listFor(payload,'entities');mark(list.length);
      list.forEach((entity,i)=>entities.push({...entity,key:keyFor('identity',tool,i),tier:passiveTier(entity,subject)}));
    }else if(source.group==='news'){
      let count=0;
      listFor(payload,'items').forEach((item,i)=>{
        if(item.error&&!firstOf(item,['title','headline','name']))return;
        const n=newsItem(item,tool,i);
        if(n){n.tier=passiveTier(item,subject);news.push(n);count++;}
      });
      mark(count);
    }else if(source.group==='records'){
      let count=0;
      listFor(payload,'entities').forEach((item,i)=>{
        const r=recordItem(item,tool,i);
        if(r){r.tier=passiveTier(flatRecord(item),subject);records.push(r);count++;}
      });
      mark(count);
    }else{
      let items=firstItems(payload);
      if(!items.length&&payload&&typeof payload==='object'&&!Array.isArray(payload))items=[payload];
      if(!items.length){mark(false);return;}
      mark(true);
      const ranked=items.map((item,i)=>({key:keyFor('data',tool,i),tier:passiveTier(item,subject),item}));
      const shown=ranked.filter(x=>x.tier>0).sort((a,b)=>b.tier-a.tier);
      const hidden=ranked.filter(x=>x.tier===0);
      result.data.push({key:`group:${keyFor('data',tool,index)}`,tool:tool.name,label:labelFor(tool),items:shown,hidden,hiddenCount:hidden.length});
    }
  });
  entities.sort((a,b)=>b.tier-a.tier);
  const best=entities.find(e=>e.tier>=4)||null;
  result.identity={best,others:entities.filter(e=>e!==best&&e.tier>=2)};
  const allNews=dedupeNews(news),allRecords=records.sort((a,b)=>b.tier-a.tier);
  result.news=allNews.filter(n=>n.tier>0);
  result.hidden.news=allNews.filter(n=>n.tier===0);
  result.records=allRecords.filter(r=>r.tier>0);
  result.hidden.records=allRecords.filter(r=>r.tier===0);
  return result;
}

const timeOf=n=>n.date?Date.parse(n.date):null;

export function sortNews(news,order='newest'){
  const list=[...(news||[])];
  const byDate=(a,b)=>{
    const x=timeOf(a),y=timeOf(b);
    if(x===null&&y===null)return 0;
    if(x===null)return 1;
    if(y===null)return -1;
    return y-x;
  };
  return list.sort(order==='relevant'?(a,b)=>(b.tier-a.tier)||byDate(a,b):byDate);
}
