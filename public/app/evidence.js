// Evidence page: cases, saved findings and recent-search history.
// Moved unchanged from app.js; see app.js for the startup and button wiring.
import {browserOnlyNotice,caseSummary,evidenceEmpty,findingCard} from '../evidence-view.js?v=3';
import {escapeHtml} from '../ui.js?v=6';
import {activeCaseId,defaultCaseName,newestFirst} from '../cases-client.js';
import {$,localStore,state,persist,toast,apiGet,api} from './core.js';

function renderEvidence(){
  const options=state.cases.map(item=>`<option value="${escapeHtml(item.id)}"${item.id===state.activeCaseId?' selected':''}${item.damaged?' disabled':''}>${escapeHtml(item.name)}${item.damaged?'':` (${item.evidenceCount})`}</option>`).join('');
  $('#caseSelect').innerHTML=state.cases.length?`<option value="">Choose a case…</option>${options}`:'<option value="">No cases yet</option>';
  $('#caseSelect').value=state.activeCaseId||'';
  $('#renameCase').disabled=$('#deleteCase').disabled=$('#exportButton').disabled=!state.activeCase;
  const legacy=state.evidence.length;
  $('#caseImport').hidden=!legacy;
  $('#caseImport').innerHTML=legacy?browserOnlyNotice(legacy):'';
  const current=state.activeCase;
  $('#caseSummary').textContent=caseSummary(current);
  $('#evidenceList').innerHTML=!current?evidenceEmpty('no-case'):current.evidence.length?newestFirst(current.evidence).map(item=>findingCard(item)).join(''):evidenceEmpty('empty-case');
}
async function loadCases(){
  try{
    state.cases=(await apiGet('/api/cases')).cases;
    state.activeCaseId=activeCaseId(state.cases,state.activeCaseId);
    state.activeCase=state.activeCaseId?await apiGet(`/api/cases/${state.activeCaseId}`):null;
  }catch(error){toast(`Could not load cases: ${error.message}`);}
  if(state.activeCaseId)localStore.setItem('signaldesk.activeCase',state.activeCaseId);else localStore.removeItem('signaldesk.activeCase');
  renderEvidence();
}
async function selectCase(id){state.activeCaseId=id||null;await loadCases();}
async function createCase(suggested){
  const name=prompt('Name for the new case',suggested||defaultCaseName(''));
  if(name===null||!name.trim())return null;
  const created=await api('/api/cases',{name});
  await selectCase(created.id);
  return created;
}
function recordHistory(entry){
  state.history.unshift(entry);
  if(state.activeCaseId)api(`/api/cases/${state.activeCaseId}/searches`,{title:entry.title,time:entry.time,server:entry.server}).then(()=>loadCases()).catch(()=>{});
}
async function saveLastResultToCase(){
  if(!state.lastResult)return;
  if(!state.activeCase&&!(await createCase(defaultCaseName(state.lastResult.title))))return;
  await api(`/api/cases/${state.activeCaseId}/evidence`,state.lastResult);
  await loadCases();
  toast(`Saved to ${state.activeCase?.name||'the case'}`);$('#resultDialog').close();
}
async function importBrowserEvidence(){
  const items=[...state.evidence];
  if(!items.length)return;
  const created=await api('/api/cases',{name:`Imported from browser — ${new Date().toISOString().slice(0,10)}`});
  for(const item of [...items].reverse())await api(`/api/cases/${created.id}/evidence`,item);
  state.evidence=[];persist();
  await selectCase(created.id);
  toast(`Imported ${items.length} finding${items.length===1?'':'s'} into a case on this Mac`);
}

export {renderEvidence,loadCases,selectCase,createCase,recordHistory,saveLastResultToCase,importBrowserEvidence};
