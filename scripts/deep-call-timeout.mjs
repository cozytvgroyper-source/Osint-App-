import {DEEP_TOOLS} from '../public/deep-search.js';
import {toolRisk} from '../public/tool-tiers.js';

export const DEFAULT_MCP_TIMEOUT_MS=45_000;
export const DEFAULT_DEEP_TIMEOUT_MS=120_000;
export const MAX_DEEP_TIMEOUT_MS=600_000;

const allowedTimeouts=new Map();
for(const entries of Object.values(DEEP_TOOLS)){
  for(const entry of entries){
    const timeout=Math.min(entry.timeoutMs||DEFAULT_DEEP_TIMEOUT_MS,MAX_DEEP_TIMEOUT_MS);
    allowedTimeouts.set(entry.name,Math.max(allowedTimeouts.get(entry.name)||0,timeout));
  }
}

export function deepCallTimeout({name,serverName,deepSearch=false,timeoutMs}={},authorization={}){
  const deep=deepSearch||authorization?.grant?.purpose==='deep-search';
  const risk=toolRisk({name,serverName});
  const allowed=allowedTimeouts.get(name);
  if(!deep||!allowed||!risk.reviewed)return DEFAULT_MCP_TIMEOUT_MS;
  const requested=Number(timeoutMs);
  if(!Number.isFinite(requested)||requested<=0)return Math.min(allowed,DEFAULT_DEEP_TIMEOUT_MS);
  return Math.min(Math.max(requested,DEFAULT_DEEP_TIMEOUT_MS),allowed,MAX_DEEP_TIMEOUT_MS);
}
