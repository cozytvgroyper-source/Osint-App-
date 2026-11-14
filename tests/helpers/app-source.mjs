import fs from 'node:fs';

// The page's own code: app.js (startup and button wiring) plus each page's file in public/app/. Tests that check the
// code's text read all of it, so moving a function between these files never hides it from a test.
const APP_FILES=['app/core.js','app/news.js','app/servers.js','app/tools.js','app/evidence.js','app/results.js','app/search.js','app/deep.js','app.js'];

const WORD=/[A-Za-z0-9_$]/;
// A word followed by a quote or template always gets one space (return 'x', from './y.js'), however it was written.
const QUOTE=/['"`]/;
// After one of these characters (or words), a "/" starts a regular expression rather than a division.
const BEFORE_REGEX=new Set(['','(',',','=',':','[','!','&','|','?','{','}',';','+','-','*','%','<','>','~','^']);
const KEYWORDS_BEFORE_REGEX=new Set(['return','typeof','case','in','of','void','delete','throw','new','yield','await','else','do']);

// The code with layout taken out, so text checks keep testing the same code however it is laid out: spaces and line
// breaks between symbols are dropped, one space is kept between two words and between a word and a quote, a line
// break is kept before every statement that starts at the left margin, and text inside quotes, templates, regular expressions and comments is
// kept as written (with expressions inside a template's ${...} compacted the same way).
export function compactJs(source){
  let out='';let i=0;
  const last=()=>{for(let k=out.length-1;k>=0;k--)if(!/\s/.test(out[k]))return out[k];return '';};
  const lastWord=()=>out.match(/([A-Za-z_$][\w$]*)\s*$/)?.[1]||'';
  const emit=text=>{out+=text;};
  const readQuoted=quote=>{let s=quote;i++;while(i<source.length){const c=source[i];s+=c;i++;if(c==='\\'){s+=source[i];i++;continue;}if(c===quote)break;}return s;};
  const readRegex=()=>{let s='/';i++;let inClass=false;while(i<source.length){const c=source[i];s+=c;i++;if(c==='\\'){s+=source[i];i++;continue;}if(c==='[')inClass=true;else if(c===']')inClass=false;else if(c==='/'&&!inClass)break;}while(i<source.length&&/[a-z]/i.test(source[i])){s+=source[i];i++;}return s;};
  const readTemplate=()=>{let s='`';i++;while(i<source.length){const c=source[i];if(c==='\\'){s+=c+source[i+1];i+=2;continue;}if(c==='`'){s+='`';i++;break;}if(c==='$'&&source[i+1]==='{'){s+='${';i+=2;let depth=1;const start=i;while(i<source.length&&depth){const d=source[i];if(d==='`'){readTemplate();continue;}if(d==='\''||d==='"'){readQuoted(d);continue;}if(d==='{')depth++;else if(d==='}')depth--;i++;}s+=compactJs(source.slice(start,i-1))+'}';continue;}s+=c;i++;}return s;};
  let pendingSpace=false;let pendingBreak=false;
  const flush=next=>{
    if(pendingBreak&&out){out=out.replace(/[ \t]+$/,'');out+='\n';}
    else if(WORD.test(out.at(-1)||'')&&(pendingSpace&&WORD.test(next)||QUOTE.test(next)))out+=' ';
    pendingSpace=false;pendingBreak=false;
  };
  while(i<source.length){
    const c=source[i];
    if(c==='\n'){i++;pendingSpace=true;if(i<source.length&&!/\s/.test(source[i]))pendingBreak=true;continue;}
    if(/\s/.test(c)){pendingSpace=true;i++;continue;}
    if(c==='/'&&source[i+1]==='/'){flush(c);const end=source.indexOf('\n',i);const text=end<0?source.slice(i):source.slice(i,end);emit(text);i+=text.length;pendingBreak=false;pendingSpace=false;out+='\n';continue;}
    if(c==='/'&&source[i+1]==='*'){flush(c);const end=source.indexOf('*/',i+2);const text=source.slice(i,end+2);emit(text);i+=text.length;continue;}
    flush(c);
    if(c==='\''||c==='"'){emit(readQuoted(c));continue;}
    if(c==='`'){emit(readTemplate());continue;}
    if(c==='/'&&(BEFORE_REGEX.has(last())||KEYWORDS_BEFORE_REGEX.has(lastWord()))){emit(readRegex());continue;}
    emit(c);i++;
  }
  return out;
}

export function readAppSource(){
  return APP_FILES.map(file=>compactJs(fs.readFileSync(new URL(`../../public/${file}`,import.meta.url),'utf8'))).join('\n');
}

export function appSourceFiles(){return [...APP_FILES];}
