// Ranks and groups the answers of a passive search: who/what it is, news, related data, records.
// Pure functions only. Each result appears once, and the exact name outranks a mere mention.

const TEXT_FIELDS=['label','name','title','headline','aliases','description','summary','snippet','text','company','dataset','place'];
const TITLE_FIELDS=['title','label','name','place'];
const DATE_FIELDS=['pubDate','date','seendate','publishedAt','published'];
const LINK_FIELDS=['wikiUrl','url','link','searchUrl','opencorporates_url'];
const ARRAY_KEYS=['entities','items','articles','filings','results','data'];

const flat=value=>String(value??'').toLowerCase().replace(/\./g,'').replace(/\s+/g,' ').trim();
const squash=value=>flat(value).replace(/ /g,'');
const wordsOf=text=>String(text??'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
const asList=value=>Array.isArray(value)?value:value==null||value===''?[]:[value];
const textOf=(item,fields)=>fields.flatMap(field=>asList(item?.[field]).map(v=>typeof v==='object'?'':String(v))).filter(Boolean).join(' ');

export function passiveTier(item,subject){
  const wanted=flat(subject);
  if(!wanted)return 3;
  const exact=squash(subject);
  const names=['label','name','title'].flatMap(f=>asList(item?.[f])).concat(asList(item?.aliases));
  if(names.some(n=>typeof n==='string'&&squash(n)===exact))return 5;
  if(flat(textOf(item,TITLE_FIELDS)).includes(wanted))return 4;
  const all=flat(textOf(item,TEXT_FIELDS));
  if(all.includes(wanted))return 3;
  const subjectWords=wordsOf(flat(subject)).filter(w=>[...w].length>=2);
  if(!subjectWords.length)return 3;
  const present=new Set(wordsOf(all));
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

function payloadOf(outcome){
  const data=outcome?.data;
  if(data&&typeof data==='object'&&!Array.isArray(data)&&data.data&&typeof data.data==='object'&&!ARRAY_KEYS.slice(0,5).some(k=>Array.isArray(data[k])))return data.data;
  return data;
}

const isRecordList=list=>Array.isArray(list)&&list.length>0&&list.every(x=>x&&typeof x==='object'&&!Array.isArray(x));

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

function recordItem(item,tool,index){
  const name=tool.name;
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
    detail=[item.jurisdiction,item.status].filter(Boolean).join(' · ');
  }
  if(!detail)detail=firstOf(item,['description','summary']);
  if(!title)return null;
  return{key:keyFor('records',tool,index),title,detail,link:firstOf(item,LINK_FIELDS),tier:0,tool:name,item};
}

const dedupeNews=list=>{
  const links=new Set(),titles=new Set(),out=[];
  for(const n of list){
    const title=flat(n.title);
    if((n.link&&links.has(n.link))||titles.has(title))continue;
    if(n.link)links.add(n.link);
    titles.add(title);out.push(n);
  }
  return out;
};

function describeFailure(entry){
  return entry.status==='rejected'?String(entry.reason?.message||entry.reason||'The source failed.'):entry.value?.outcome?.error||'The source failed.';
}

export function buildPassiveResults({query,subject,event,sources,outcomes}){
  const result={query,subject,event,identity:{best:null,others:[]},news:[],data:[],records:[],failed:[],pending:[]};
  const entities=[],news=[],records=[];
  (sources||[]).forEach((source,index)=>{
    const entry=outcomes?.[index];
    const tool=source.tool;
    if(entry===undefined){result.pending.push(labelFor(tool));return;}
    if(entry.status==='rejected'){result.failed.push({label:labelFor(tool),error:describeFailure(entry)});return;}
    const outcome=entry.value?.outcome;
    if(outcome?.kind==='error'){result.failed.push({label:labelFor(tool),error:describeFailure(entry)});return;}
    if(outcome?.kind!=='data'){result.failed.push({label:labelFor(tool),error:'Returned nothing.'});return;}
    const payload=payloadOf(outcome);
    if(source.group==='identity'){
      listFor(payload,'entities').forEach((entity,i)=>entities.push({...entity,key:keyFor('identity',tool,i),tier:passiveTier(entity,subject)}));
    }else if(source.group==='news'){
      listFor(payload,'items').forEach((item,i)=>{
        if(item.error&&!firstOf(item,['title','headline','name']))return;
        const n=newsItem(item,tool,i);
        if(n){n.tier=passiveTier(item,subject);news.push(n);}
      });
    }else if(source.group==='records'){
      listFor(payload,'entities').forEach((item,i)=>{
        const r=recordItem(item,tool,i);
        if(r){r.tier=passiveTier(item,subject);records.push(r);}
      });
    }else{
      let items=firstItems(payload);
      if(!items.length&&payload&&typeof payload==='object'&&!Array.isArray(payload))items=[payload];
      if(!items.length)return;
      const ranked=items.map(item=>({item,tier:passiveTier(item,subject)}));
      const shown=ranked.filter(x=>x.tier>0).sort((a,b)=>b.tier-a.tier).map(x=>x.item);
      const hidden=ranked.filter(x=>x.tier===0).map(x=>x.item);
      result.data.push({key:keyFor('data',tool,index),tool:tool.name,label:labelFor(tool),items:shown,hidden,hiddenCount:hidden.length});
    }
  });
  entities.sort((a,b)=>b.tier-a.tier);
  const best=entities.find(e=>e.tier>=4)||null;
  result.identity={best,others:entities.filter(e=>e!==best&&e.tier>=2)};
  result.news=dedupeNews(news);
  result.records=records.sort((a,b)=>b.tier-a.tier);
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
