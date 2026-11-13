import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Design tokens: WCAG 2.2 AA contrast in both themes, readable text sizes, always-visible focus and short motion that
// stops for people who ask for less. The values live in ui.css; these tests read them so a later edit cannot slip
// below the standard unnoticed.
const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const STYLESHEETS=['ui.css','styles.css','results.css','theme.css'];

function block(css,selector){
  const start=css.indexOf(`${selector}{`);
  assert.ok(start>=0,`ui.css has no ${selector} block`);
  return css.slice(start+selector.length+1,css.indexOf('}',start));
}
function tokens(text){return Object.fromEntries([...text.matchAll(/--([\w-]+):\s*([^;]+)/g)].map(m=>[m[1],m[2].trim()]));}
const css=read('ui.css');
const light=tokens(block(css,':root'));
const dark={...light,...tokens(block(css,'[data-theme="dark"]'))};
const token=(theme,name)=>{const value=(theme==='dark'?dark:light)[name];assert.match(value||'',/^#[0-9a-f]{6}$/i,`${theme} --${name} is a #rrggbb color`);return value;};

function luminance(hex){
  const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);
  return 0.2126*r+0.7152*g+0.0722*b;
}
function ratio(a,b){const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (hi+0.05)/(lo+0.05);}

const PAIRS=[['ink','bg',4.5],['ink','surface',4.5],['ink','surface-2',4.5],['muted','bg',4.5],['muted','surface',4.5],['muted','surface-2',4.5],
  ['accent-dark','bg',4.5],['accent-dark','surface',4.5],['accent-dark','surface-2',4.5],['accent','bg',4.5],['accent','surface',4.5],['accent','surface-2',4.5],
  ['deep','bg',4.5],['deep','surface',4.5],['on-action','action',4.5],['field-border','bg',3],['field-border','surface',3],['focus','bg',3],['focus','surface',3],['focus','surface-2',3]];

test('every text and control color meets WCAG AA in both themes',()=>{
  for(const theme of ['light','dark'])for(const [fg,bg,min] of PAIRS){
    const value=ratio(token(theme,fg),token(theme,bg));
    assert.ok(value>=min,`${theme} --${fg} on --${bg} is ${value.toFixed(2)}:1, needs ${min}:1`);
  }
});

// The size in a font shorthand is the first length after the optional style/weight; line-height after "/" is ignored.
function fontSizes(text){
  const sizes=[];
  for(const m of text.matchAll(/font-size:\s*([\d.]+)px/g))sizes.push([m[0],Number(m[1])]);
  for(const m of text.matchAll(/font:\s*(?:[a-z-]+\s+)*?(?:\d{3}\s+)?([\d.]+)px/g))sizes.push([m[0],Number(m[1])]);
  return sizes;
}
test('no text smaller than 13 px in any stylesheet',()=>{
  for(const file of STYLESHEETS)for(const [rule,size] of fontSizes(read(file)))if(size>0)assert.ok(size>=13,`${file}: ${rule}`);
});

test('focus is always visible',()=>{
  for(const file of STYLESHEETS)assert.doesNotMatch(read(file),/outline:\s*(?:0|none)\b/,file);
  assert.match(css,/:focus-visible\{outline:3px solid var\(--focus\)/);
});

test('motion is short and stops for people who ask for less',()=>{
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)\{[^}]*\{[^}]*animation:none!important/);
  for(const file of STYLESHEETS)for(const m of read(file).matchAll(/transition:[^;}]*?([\d.]+)(m?s)\b/g)){
    const ms=m[2]==='s'?Number(m[1])*1000:Number(m[1]);
    assert.ok(ms<=150,`${file}: ${m[0]}`);
  }
});

test('ui.css loads before the other stylesheets',()=>{
  const html=read('index.html');
  assert.ok(html.includes('/ui.css?v='),'index.html loads ui.css');
  assert.ok(html.indexOf('/ui.css?v=')<html.indexOf('/styles.css?v='));
});

// Behind the gradient, the page needs a solid color too: tools (and the overscroll area) read it, and an unset one is
// treated as white, which made every dark-theme heading fail contrast.
test('the page has a solid background color under its gradient',()=>{
  assert.match(css,/html\{background-color:var\(--bg\)\}/);
});

// The sidebar is navy in both themes, so the focus ring and the current-page bar there need their own colors, checked
// against every shade of its gradient and the hover background (11% white over the gradient).
test('focus ring and current-page bar stand out on the navy sidebar',()=>{
  const rail=tokens(block(css,'.rail'));
  const mix=(hex,alpha)=>'#'+[1,3,5].map(i=>Math.round(alpha*255+(1-alpha)*parseInt(hex.slice(i,i+2),16)).toString(16).padStart(2,'0')).join('');
  const shades=['#082767','#041744','#020c2b'];
  for(const bg of [...shades,...shades.map(s=>mix(s,0.11))])for(const name of ['focus','accent']){
    const value=ratio(rail[name],bg);assert.ok(value>=3,`sidebar --${name} on ${bg} is ${value.toFixed(2)}:1`);
  }
});

// Later stylesheets reset whole borders on selects and textareas to the faint --line color, so the field-border rule
// must out-rank every one of them.
function specificity(selector){
  let ids=0,classes=0,types=0;
  const s=selector.replace(/::?[\w-]+\(([^)]*)\)/g,(m,inner)=>{const [a,b,c]=specificity(inner);ids+=a;classes+=b+(m.startsWith(':not')?0:1);types+=c;return ' ';});
  ids+=(s.match(/#[\w-]+/g)||[]).length;
  classes+=(s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)||[]).length;
  types+=(s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+/g,' ').match(/(?:^|[\s>+~])([a-z][\w-]*)/gi)||[]).length;
  return [ids,classes,types];
}
const beats=(a,b)=>a[0]!==b[0]?a[0]>b[0]:a[1]!==b[1]?a[1]>b[1]:a[2]>b[2];
test('field borders reach every select and textarea',()=>{
  const rule=[...css.matchAll(/([^{}]+)\{border-color:var\(--field-border\)\}/g)].map(m=>m[1]).join(',');
  for(const tag of ['select','textarea']){
    const mine=rule.split(',').map(s=>s.trim()).filter(s=>new RegExp(`^${tag}\\b`).test(s));
    assert.ok(mine.length,`ui.css styles ${tag} borders`);
    for(const file of ['styles.css','results.css','theme.css'])for(const m of read(file).matchAll(/([^{}@]+)\{([^}]*\bborder(?:-color)?:[^}]*)\}/g))
      for(const selector of m[1].split(',').map(s=>s.trim()).filter(s=>new RegExp(`\\b${tag}$`).test(s)))
        assert.ok(mine.some(own=>beats(specificity(own),specificity(selector))),`${file}: "${selector}" overrides the ${tag} field border`);
  }
});

test('older stylesheets never style the building blocks',()=>{
  for(const file of ['styles.css','results.css','theme.css'])assert.doesNotMatch(read(file),/\.ui-(?:badge|empty)\b/,file);
  for(const name of ['ui-badge','ui-badge-neutral','ui-badge-safe','ui-badge-warn','ui-badge-danger','ui-empty'])assert.match(css,new RegExp(`\\.${name}\\b`),name);
});

// Badge tones: --ink text on a hue mixed into the surface, readable in both themes.
test('badge tones are readable in both themes',()=>{
  const mix=(hex,alpha,base)=>'#'+[1,3,5].map(i=>Math.round(alpha*parseInt(hex.slice(i,i+2),16)+(1-alpha)*parseInt(base.slice(i,i+2),16)).toString(16).padStart(2,'0')).join('');
  for(const m of css.matchAll(/\.ui-badge-(\w+)\{color:var\(--ink\);background:color-mix\(in srgb,(#[0-9a-f]{6}) (\d+)%,var\(--surface\)\)\}/gi))
    for(const theme of ['light','dark']){
      const value=ratio(token(theme,'ink'),mix(m[2],Number(m[3])/100,token(theme,'surface')));
      assert.ok(value>=4.5,`${theme} ui-badge-${m[1]} is ${value.toFixed(2)}:1`);
    }
  assert.equal([...css.matchAll(/\.ui-badge-\w+\{color:var\(--ink\)/g)].length,4,'four tones, each with --ink text');
});
