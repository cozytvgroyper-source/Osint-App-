// Tracks whether each MCP tool worked the last time Public Desk ran it, so server cards can show
// exact working and failing counts instead of only how many tools a server advertises.

const STATUS_FOR_KIND={data:'working',empty:'working',error:'failing'};

const healthKey=(serverId,toolName)=>`${serverId}::${toolName}`;

export function recordToolHealth(health,serverId,toolName,kind,at){
  const status=STATUS_FOR_KIND[kind];
  if(!status)throw new Error(`Unknown tool outcome: ${kind}`);
  return{...health,[healthKey(serverId,toolName)]:{status,at}};
}

export function summarizeToolHealth(server,health){
  const counts={total:server.tools.length,working:0,failing:0,untested:0};
  for(const tool of server.tools){
    const status=health[healthKey(server.id,tool.name)]?.status;
    if(status==='working')counts.working++;
    else if(status==='failing')counts.failing++;
    else counts.untested++;
  }
  return counts;
}

export function toolCountLabel(server,health){
  const {total,working,failing,untested}=summarizeToolHealth(server,health);
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
