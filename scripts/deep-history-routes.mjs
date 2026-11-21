import {clearDeepSearchAudit,deleteDeepSearchAudit,listedRunIds} from './deep-search-audit.mjs';

// The routes that delete Deep Search runs. Returns {status, body}, or null for a path or method that is not one of
// these routes. Every write is a POST behind server.mjs's request guard, like the case routes.
// Results are always deleted before history lines: if the second step fails, the row stays visible and can be
// deleted again, so nothing is ever left on disk behind a hidden row.
const RUN_DELETE=/^\/api\/deep-search\/runs\/([^/]+)\/delete$/;

export async function handleDeepHistoryRequest({runs,auditFile},method,pathname,readBody){
  if(method!=='POST')return null;
  const runMatch=pathname.match(RUN_DELETE);
  if(runMatch){
    const id=runMatch[1];
    const results=await runs.remove(id);
    const deleted=await deleteDeepSearchAudit(auditFile,{runId:id});
    return {status:200,body:{deleted,results}};
  }
  if(pathname==='/api/deep-search/history/delete'){
    const {time,target}=await readBody()||{};
    const deleted=await deleteDeepSearchAudit(auditFile,{time,target});
    return {status:200,body:{deleted,results:false}};
  }
  if(pathname==='/api/deep-search/history/delete-all'){
    const results=await runs.removeAll();
    const deleted=await clearDeepSearchAudit(auditFile);
    return {status:200,body:{deleted,results}};
  }
  return null;
}

// Removes the results that no history line mentions. The log keeps its newest 1 MB, so older runs' lines drop out and
// their results had no row left to delete them from: they stayed on disk, and in every backup, until Delete all.
// Every run the history still mentions is kept; with no log at all, nothing is removed.
export function pruneUnlistedDeepRuns({runs,auditFile}){
  return runs.removeUnlisted(()=>listedRunIds(auditFile));
}
