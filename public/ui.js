// Shared building blocks for every page. Each returns an HTML string, escapes every value it interpolates, and carries
// the accessibility its use needs (labels, hidden decorative icons, current-page state), so pages get it for free.
// Arguments named body, actions or action take trusted HTML built by these same functions.
import {GLOSSARY} from './glossary.js';

export function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

const attributes=attrs=>Object.entries(attrs).filter(([,value])=>value!==undefined&&value!==null&&value!==false)
  .map(([name,value])=>value===true?` ${escapeHtml(name)}`:` ${escapeHtml(name)}="${escapeHtml(value)}"`).join('');
const decorative=icon=>icon?`<span aria-hidden="true">${escapeHtml(icon)}</span>`:'';

export function pageHeader({title,intro}){
  return `<h1>${escapeHtml(title)}</h1><p class="page-intro">${escapeHtml(intro)}</p>`;
}

export function navItem({view,icon,label,current=false}){
  return `<button class="nav" data-view="${escapeHtml(view)}"${current?' aria-current="page"':''}>${decorative(icon)}${escapeHtml(label)}</button>`;
}

export function button({label,kind='secondary',icon='',iconOnly=false,attrs={}}){
  if(!String(label??'').trim())throw new Error('button needs a label');
  const {type='button',...rest}=attrs;
  const name=iconOnly?{'aria-label':label}:{};
  return `<button${attributes({type,class:`btn btn-${kind}`,...name,...rest})}>${decorative(icon)}${iconOnly?'':escapeHtml(label)}</button>`;
}

export function field({id,label,hint='',error='',control}){
  const described=[hint&&`${id}-hint`,error&&`${id}-error`].filter(Boolean).join(' ');
  const attrs=attributes({id,...control.attrs,'aria-describedby':described||undefined,'aria-invalid':error?'true':undefined});
  const options=(control.options||[]).map(option=>`<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
  const element=control.tag==='input'?`<input${attrs}>`:`<${control.tag}${attrs}>${control.tag==='select'?options:escapeHtml(control.value??'')}</${control.tag}>`;
  return `<div class="field"><label for="${escapeHtml(id)}">${escapeHtml(label)}</label>${element}${hint?`<p class="field-hint" id="${escapeHtml(id)}-hint">${escapeHtml(hint)}</p>`:''}${error?`<p class="field-error" id="${escapeHtml(id)}-error" role="alert">${escapeHtml(error)}</p>`:''}</div>`;
}

export function card({title,body='',actions='',headingLevel=3}){
  const level=Math.min(6,Math.max(2,Number(headingLevel)||3));
  return `<article class="card"><h${level} class="card-title">${escapeHtml(title)}</h${level}>${body}${actions?`<div class="card-actions">${actions}</div>`:''}</article>`;
}

export function badge({text,tone='neutral',icon=''}){
  return `<span class="ui-badge ui-badge-${escapeHtml(tone)}">${decorative(icon)}${escapeHtml(text)}</span>`;
}

export function emptyState({title,text,action=''}){
  return `<div class="ui-empty"><p class="ui-empty-title">${escapeHtml(title)}</p><p>${escapeHtml(text)}</p>${action}</div>`;
}

// visible:true shows the meaning on the page too, for the place where a term is being explained rather than mentioned.
export function term(key,{visible=false}={}){
  const entry=GLOSSARY[key];
  if(!entry)throw new Error(`Unknown glossary term: ${key}`);
  if(visible&&entry.explain)return `<span class="term-explained"><b>${escapeHtml(entry.label)}</b>: ${escapeHtml(entry.explain)}</span>`;
  if(!entry.explain)return `<span class="term">${escapeHtml(entry.label)}</span>`;
  return `<span class="term" title="${escapeHtml(entry.explain)}">${escapeHtml(entry.label)}</span><span class="visually-hidden">: ${escapeHtml(entry.explain)}</span>`;
}
