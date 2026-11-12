// One shared word list: what each concept is called on the page and a one-line plain explanation, so every page
// names and explains it the same way. MCP server, Tool library, the tier names and Pivot keep their names on purpose.
import {TIERS} from './tool-tiers.js';

export const GLOSSARY=Object.freeze({
  mcpServer:{label:'MCP server',explain:'A service Public Desk asks when you search.'},
  toolLibrary:{label:'Tool library',explain:'Every tool your MCP servers offer.'},
  ...Object.fromEntries(TIERS.map(tier=>[tier.key,{label:tier.label,explain:tier.targetSees}])),
  pivot:{label:'Pivot',explain:'Search this value next.'},
  unverified:{label:'Not checked yet',explain:''},
  confirmed:{label:'Confirmed',explain:''},
  ruledOut:{label:'Ruled out',explain:''},
  fingerprint:{label:'Fingerprint (SHA-256)',explain:"Proves this saved result hasn't changed."},
  dataSource:{label:'Data source',explain:'An API key that unlocks more results for some tools.'}
});
