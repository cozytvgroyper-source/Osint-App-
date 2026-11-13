// Small CSS readers for tests. Every plain rule (selectors and body; at-rule heads are skipped, rules inside @media are
// included) with its position, so a test can ask which rules come after a given one in the single stylesheet.
export function rules(css){
  // Comments become spaces of the same length, so they never join a selector and every index stays true.
  const clean=css.replace(/\/\*[\s\S]*?\*\//g,c=>' '.repeat(c.length));
  return [...clean.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(m=>({selector:m[1].trim(),body:m[2],index:m.index}));
}
export function rulesAfter(css,index){
  return rules(css).filter(rule=>rule.index>=index).map(({selector,body})=>({selector,body}));
}
