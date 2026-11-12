// Tracks whether each MCP tool worked the last time Public Desk ran it, so server cards can show
// exact working and failing counts instead of only how many tools a server advertises.

const STATUS_FOR_KIND={data:'working',empty:'working',error:'failing'};

const healthKey=(serverId,toolName)=>`${serverId}::${toolName}`;
// A failure says little about a tool a day later (services recover, one run may have timed out), so an older failure
// counts as not yet run. A failure whose time cannot be read stays failing rather than being hidden.
export const FAILING_EXPIRES_MS=24*60*60*1000;
const stale=(record,now)=>record?.status==='failing'&&now-Date.parse(record.at)>FAILING_EXPIRES_MS;

export function recordToolHealth(health,serverId,toolName,kind,at){
  const status=STATUS_FOR_KIND[kind];
  if(!status)throw new Error(`Unknown tool outcome: ${kind}`);
  return{...health,[healthKey(serverId,toolName)]:{status,at}};
}

export function summarizeToolHealth(server,health,now=Date.now()){
  const counts={total:server.tools.length,working:0,failing:0,untested:0};
  for(const tool of server.tools){
    const record=health[healthKey(server.id,tool.name)];
    const status=stale(record,now)?undefined:record?.status;
    if(status==='working')counts.working++;
    else if(status==='failing')counts.failing++;
    else counts.untested++;
  }
  return counts;
}

export function toolCountLabel(server,health,now=Date.now()){
  const {total,working,failing,untested}=summarizeToolHealth(server,health,now);
  const parts=[`${total} tool${total===1?'':'s'}`,`${working} working`];
  if(failing)parts.push(`${failing} failing`);
  if(untested)parts.push(`${untested} not yet run`);
  return parts.join(' · ');
}

export function serverConnectionLabel(servers){
  if(!servers.length)return 'No MCP servers saved';
  const connected=servers.filter(server=>server.status==='connected').length;
  return `${connected} of ${servers.length} MCP server${servers.length===1?'':'s'} connected`;
}
