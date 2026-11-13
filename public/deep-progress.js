import {detectDeepTarget,isPersonType} from './deep-search.js';
import {button,escapeHtml} from './ui.js';

const stages=Object.freeze([
  ['start','Checking what you typed'],
  ['leads','Following leads'],
  ['sites','Checking linked websites'],
  ['finish','Putting the results together']
]);

export function initialProgress(target,level,startedAt=Date.now()){
  return {target:{...target},level,startedAt,stage:'start',round:1,leads:[],linked:0,possible:0,done:0,total:0,durations:[],finished:false,outcome:''};
}

export function reduceProgress(state,event={}){
  if(event.type==='stage')return{...state,stage:event.stage,round:event.round??state.round};
  if(event.type==='lead')return{...state,leads:[...state.leads,{identifier:event.identifier,from:event.from,stage:state.stage,round:state.round}]};
  if(event.type==='counts')return{...state,linked:event.linked??state.linked,possible:event.possible??state.possible,done:event.done??state.done,total:event.total??state.total};
  if(event.type==='tool-end')return{...state,durations:[...state.durations,Math.max(0,Number(event.ms)||0)]};
  if(event.type==='done')return{...state,finished:true,outcome:event.outcome||'completed',stage:'finish'};
  return state;
}

export function minutesLeft(state,now=Date.now()){
  void now;
  if((state.done||0)<5||state.finished)return null;
  const durations=state.durations||[];if(durations.length<5)return null;
  const remaining=Math.max(0,(state.total||0)-(state.done||0));if(!remaining)return null;
  const average=durations.reduce((sum,value)=>sum+value,0)/durations.length;
  return Math.max(1,Math.ceil(remaining*average/60_000));
}

export function renderProgress(state){
  const current=Math.max(0,stages.findIndex(([key])=>key===state.stage));
  const total=Math.max(1,Number(state.total)||1),done=Math.min(total,Math.max(0,Number(state.done)||0));
  const estimate=minutesLeft(state);
  const stageList=stages.map(([key,label],index)=>{
    const complete=index<current||state.finished;const active=key===state.stage&&!state.finished;
    const leads=(state.leads||[]).filter(item=>item.stage===key).map(item=>`<li>${escapeHtml(item.identifier?.value||'New lead')}</li>`).join('');
    return `<li class="deep-progress-stage${active?' is-active':''}"><span aria-hidden="true">${complete?'✓':'○'}</span> ${escapeHtml(label)}${leads?`<ul>${leads}</ul>`:''}</li>`;
  }).join('');
  return `<section class="deep-progress-card" aria-labelledby="deepProgressHeading"><h2 id="deepProgressHeading" tabindex="-1">${escapeHtml(state.target?.value||'Deep Search')}</h2>${estimate?`<p>About ${estimate} ${estimate===1?'minute':'minutes'} left</p>`:''}<p>You can switch to other pages in the app. Keep this tab open until it finishes.</p><progress aria-label="Deep Search progress" max="${total}" value="${done}"></progress><p>${state.linked} linked so far · ${state.possible} possible · ${done} of ${state.total||0} tools done</p><ol class="deep-progress-stages">${stageList}</ol>${button({label:'Cancel search',kind:'danger',attrs:{'data-deep-cancel':true}})}</section>`;
}

export function deepStatusLine(input){
  const text=String(input??'').trim();
  if(!text)return{kind:'empty',message:'Type one email, username, website or IP address.'};
  const target=detectDeepTarget(text);
  if(!target)return{kind:'unsupported',message:'Deep Search needs an email, username, website or IP. To search a name, use Search.'};
  if(isPersonType(target.type)){
    if(target.type==='phone')return{kind:'other',message:'Looks like a phone number. We will check public sources only.'};
    return{kind:'person',message:`Looks like ${target.type==='email'?'an email address':'a username'}. We will check public sources and follow linked leads.`};
  }
  if(['domain','ip'].includes(target.type))return{kind:'site',message:`Looks like ${target.type==='ip'?'an IP address':'a website'}. Choose how far Deep Search may go.`};
  return{kind:'other',message:`Looks like a ${target.type.toUpperCase()}. Deep Search will use Passive public sources.`};
}
