// Decides whether an MCP tool response is a real finding, an empty answer, or an error, so the
// main search never counts a failed or content-free source as a result category.

export const METADATA_KEYS=/^(query|source|note|feedCount|filtered|totalBeforeFilter|jurisdiction|total|count|status|success|ok|target|timestamp|generatedAt|fetchedAt|durationMs)$/i;
const FAILURE_STATUS=/^(error|errored|fail|failed|failure)$/i;
const ERROR_TEXT=/^(?:error\b|exception\b|traceback\b|failed\b|unable to\b|could not\b|no module named\b|unknown tool\b|http \d{3}\b|\d{3} (?:client|server) error\b)/i;
const EMPTY_TEXT=/^(?:ok|completed|done|none|null|n\/a|\[\]|\{\})$/i;
const MAX_ERROR_LENGTH=300;

export function parseToolResult(result){
  const content=result?.content;
  if(Array.isArray(content)&&content.length===1&&typeof content[0]?.text==='string'){
    try{return JSON.parse(content[0].text);}catch{return content[0].text;}
  }
  return result?.structuredContent??result;
}

export function hasUsefulData(value,key=''){
  if(value===null||value===undefined||value==='')return false;
  if(Array.isArray(value))return value.length>0;
  if(typeof value!=='object')return !METADATA_KEYS.test(key);
  return Object.entries(value).some(([childKey,child])=>hasUsefulData(child,childKey));
}

function shortError(value){
  const message=typeof value==='string'?value:JSON.stringify(value);
  return message.length>MAX_ERROR_LENGTH?`${message.slice(0,MAX_ERROR_LENGTH)}…`:message;
}

function contentText(result){
  return (Array.isArray(result?.content)?result.content:[]).map(part=>part?.text).filter(Boolean).join('\n').trim();
}

function isStatusEnvelope(value){
  return value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.status==='string';
}

export function classifyToolResult(result){
  if(result?.isError)return{kind:'error',error:shortError(contentText(result)||'The tool reported an error.')};
  let parsed=parseToolResult(result);

  if(isStatusEnvelope(parsed)){
    if(FAILURE_STATUS.test(parsed.status))return{kind:'error',error:shortError(parsed.error||parsed.message||`Source reported status “${parsed.status}”.`)};
    if('result' in parsed&&Object.keys(parsed).every(key=>['status','result'].includes(key)))parsed=parsed.result;
  }
  if(parsed&&typeof parsed==='object'){
    if(parsed.error)return{kind:'error',error:shortError(parsed.error)};
    if(parsed.data?.error)return{kind:'error',error:shortError(parsed.data.error)};
    if(parsed.success===false)return{kind:'error',error:shortError(parsed.message||'Source reported the request was unsuccessful.')};
  }
  if(typeof parsed==='string'){
    const value=parsed.trim();
    if(ERROR_TEXT.test(value)||value.includes('Traceback (most recent call last)'))return{kind:'error',error:shortError(value)};
    if(EMPTY_TEXT.test(value))return{kind:'empty'};
  }

  const data=parsed?.data??parsed;
  return hasUsefulData(data)?{kind:'data',data}:{kind:'empty'};
}
