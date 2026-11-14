// Real-browser tests: each one starts a throwaway Public Desk (stand-in data, temporary work folder) and the Google
// Chrome already installed, then uses the app the way a person does. Tool servers are stood in for inside the page, so
// no real tool is ever called. Skipped when Chrome isn't installed. See tests/helpers/browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {STUB_MCP,findChrome,startBrowser,startServer} from './helpers/browser.mjs';

// CI sets PUBLIC_DESK_REQUIRE_BROWSER so a missing Chrome fails the run instead of quietly skipping these tests.
const required=process.env.PUBLIC_DESK_REQUIRE_BROWSER==='1';
const options={skip:findChrome()||required?false:'Google Chrome is not installed',timeout:90_000};
test('Chrome is available for the browser tests',{skip:!required&&!findChrome()&&'Google Chrome is not installed'},()=>{
  assert.ok(findChrome(),'Google Chrome is required here (PUBLIC_DESK_REQUIRE_BROWSER=1) but was not found');
});

// Runs one flow against a fresh server and browser, and fails it on any uncaught error in the page.
async function inApp(flow,{beforeLoad}={}){
  const server=await startServer();const browser=await startBrowser();
  try{
    if(beforeLoad)await browser.beforeLoad(beforeLoad);
    await browser.open(server.url);
    await flow(browser,server);
    assert.deepEqual(browser.errors,[],'no uncaught errors in the page');
  }finally{await browser.close();await server.stop();}
}
const show=view=>`document.querySelector('[data-view="${view}"]').click();`;
const confirmButton=label=>`[...document.querySelectorAll('#confirmDialog button')].find(button=>button.textContent.trim()===${JSON.stringify(label)}).click();`;
const connectToolbox=async browser=>{
  await browser.evaluate(STUB_MCP+show('servers'));
  await browser.evaluate("[...document.querySelectorAll('[data-connect]')].find(button=>button.closest('article,li')?.textContent.includes('OSINT Toolbox')).click();");
  await browser.waitFor("return [...document.querySelectorAll('article,li')].some(card=>/OSINT Toolbox/.test(card.textContent)&&/Connected · 2 tools/.test(card.textContent))",{timeout:20_000,label:'OSINT Toolbox connected'});
};
const startDeepSearch=async(browser,target)=>{
  await browser.evaluate(`${show('deep')}document.querySelector('[data-deep-new]')?.click();`);
  await browser.evaluate(`const input=document.getElementById('deepTarget');input.value=${JSON.stringify(target)};input.dispatchEvent(new Event('input'));`);
  await browser.waitFor("return !document.getElementById('startDeepSearch').disabled",{label:'Start enabled'});
  await browser.evaluate("document.getElementById('startDeepSearch').click();");
};

test('the app starts, every page opens and is announced, and the keyboard reaches the skip link first',options,()=>inApp(async browser=>{
  for(const view of ['workspace','evidence','news','servers','library','deep']){
    await browser.evaluate(show(view));
    await browser.waitFor(`return !document.getElementById(${JSON.stringify(view)}).hidden&&document.querySelector('[data-view="${view}"]').getAttribute('aria-current')==='page'`,{label:`${view} shown and announced`});
  }
  await browser.evaluate('document.activeElement.blur();');
  await browser.press('Tab');
  assert.deepEqual(await browser.evaluate("const element=document.activeElement;return {skip:element.classList.contains('skip-link'),visible:element.matches(':focus-visible')}"),{skip:true,visible:true});
}));

test('typing in the Passive search box shows no focus box',options,()=>inApp(async browser=>{
  await browser.evaluate(`${show('workspace')}document.getElementById('newInvestigation').focus();`);
  assert.equal(await browser.evaluate("return getComputedStyle(document.getElementById('newInvestigation')).outlineStyle"),'solid','other controls keep their keyboard focus marker');
  await browser.press('Tab');
  assert.deepEqual(await browser.evaluate(`const query=document.getElementById('query');const row=query.closest('.search-row');return {active:document.activeElement.id,query:getComputedStyle(query).outlineStyle,row:getComputedStyle(row).outlineStyle};`),{active:'query',query:'none',row:'none'});
}));

test('a saved Deep Search reopens with its results and keyboard focus on them',options,()=>inApp(async browser=>{
  await browser.evaluate(show('deep'));
  await browser.waitFor("return document.querySelectorAll('[data-open-deep]').length===2",{label:'two saved searches listed'});
  await browser.evaluate("document.querySelector('[data-open-deep=\"person-run-1234\"]').click();");
  await browser.waitFor("return !document.getElementById('deepResults').hidden&&document.activeElement?.id==='deepResultsHeading'",{label:'results shown and focused'});
  assert.match(await browser.evaluate("return document.getElementById('deepResults').textContent"),/Connected details/);
}));

test('deleting a saved search asks first, Cancel keeps it, and confirming deletes only that one',options,()=>inApp(async browser=>{
  await browser.evaluate(show('deep'));
  await browser.waitFor("return document.querySelectorAll('[data-delete-deep-run]').length===2");
  await browser.evaluate("document.querySelector('[data-delete-deep-run=\"site-run-123456\"]').click();");
  await browser.waitFor("return document.getElementById('confirmDialog').open",{label:'confirm dialog open'});
  assert.equal(await browser.evaluate("return document.activeElement.dataset.confirm"),'no','the dialog starts on Cancel');
  await browser.evaluate(confirmButton('Cancel'));
  await browser.waitFor("return !document.getElementById('confirmDialog').open");
  assert.equal(await browser.evaluate("return document.querySelectorAll('[data-delete-deep-run]').length"),2);
  await browser.evaluate("document.querySelector('[data-delete-deep-run=\"site-run-123456\"]').click();");
  await browser.waitFor("return document.getElementById('confirmDialog').open");
  await browser.evaluate("document.querySelector('#confirmDialog [data-confirm=\"yes\"]').click();");
  await browser.waitFor("return document.querySelectorAll('[data-delete-deep-run]').length===1",{label:'one search left'});
  assert.equal(await browser.evaluate("return document.querySelector('[data-delete-deep-run]').dataset.deleteDeepRun"),'person-run-1234');
  assert.equal(await browser.evaluate("return document.getElementById('deepHistoryStatus').textContent"),'Search deleted.');
}));

test('a connected tool runs and shows its answer, and a failing tool says why',options,()=>inApp(async browser=>{
  await connectToolbox(browser);
  const runWhois=`${show('library')}[...document.querySelectorAll('[data-run]')].find(button=>button.dataset.run.endsWith('::whois_lookup')).click();
    document.getElementById('runArgs').value='{"query":"example.com"}';document.getElementById('executeTool').click();`;
  await browser.evaluate(runWhois);
  await browser.waitFor("return document.getElementById('resultDialog').open&&document.getElementById('resultDialog').textContent.includes('Domain: example.com')",{label:'tool answer shown'});
  await browser.evaluate("document.getElementById('resultDialog').close();window.__mcp.fail='Tool timed out';");
  await browser.evaluate(runWhois);
  await browser.waitFor("return document.getElementById('toast').textContent==='whois_lookup failed: Tool timed out'",{label:'failure message shown'});
}));

test('a Deep Search shows its progress, ends on its results, and is kept in the history',options,()=>inApp(async browser=>{
  await connectToolbox(browser);
  await browser.evaluate(show('deep'));
  await browser.waitFor("return document.querySelectorAll('[data-open-deep]').length===2");
  await startDeepSearch(browser,'owner@example.com');
  await browser.waitFor("return !document.getElementById('deepProgress').hidden&&!!document.getElementById('deepProgressHeading')",{label:'progress shown'});
  await browser.waitFor("return !document.getElementById('deepResults').hidden&&document.activeElement?.id==='deepResultsHeading'",{label:'results shown',timeout:15000});
  await browser.waitFor("return document.querySelectorAll('[data-open-deep]').length===3",{label:'new search listed in history'});
  assert.ok((await browser.evaluate('return window.__mcp.calls')).includes('tools/call:holehe_email_search'));
  // The history lists every search from the audit log; reopening the new one proves its results were kept too.
  await browser.evaluate(`document.getElementById('toast').textContent='';document.getElementById('deepResults').innerHTML='';
    [...document.querySelectorAll('[data-open-deep]')].find(button=>!['person-run-1234','site-run-123456'].includes(button.dataset.openDeep)).click();`);
  await browser.waitFor("return !!document.getElementById('deepResultsHeading')||/Could not open/.test(document.getElementById('toast').textContent)",{label:'reopen answered'});
  assert.equal(await browser.evaluate("return document.getElementById('toast').textContent"),'','no "could not open" message');
  assert.equal(await browser.evaluate("return document.activeElement?.id"),'deepResultsHeading');
}));

test('while a search runs, nothing hides its progress, and Stop asks first and keeps what was found',options,()=>inApp(async browser=>{
  await connectToolbox(browser);
  await browser.evaluate('window.__mcp.slowMs=8000;');
  await startDeepSearch(browser,'owner@example.com');
  await browser.waitFor("return !document.getElementById('deepProgress').hidden");
  await browser.waitFor("return [...document.querySelectorAll('[data-open-deep]')].length>0&&[...document.querySelectorAll('[data-open-deep]')].every(button=>button.disabled)",{label:'Open results disabled'});
  // Even if an old result is opened anyway, the live progress (and its Stop button) comes back.
  await browser.evaluate("const button=document.querySelector('[data-open-deep]');button.disabled=false;button.click();");
  await browser.waitFor("return !document.getElementById('deepProgress').hidden&&document.getElementById('deepResults').hidden",{label:'progress kept'});
  assert.match(await browser.evaluate("return document.getElementById('toast').textContent"),/still running/);
  await browser.evaluate("document.querySelector('[data-deep-cancel]').click();");
  await browser.waitFor("return document.getElementById('confirmDialog').open");
  await browser.evaluate(confirmButton('Stop search'));
  await browser.waitFor("return /Stopped early/.test(document.getElementById('deepResults').textContent)&&document.activeElement?.id==='deepResultsHeading'",{label:'stopped, results focused',timeout:15000});
}));

test('a case can be created, filled from a result, renamed and deleted',options,()=>inApp(async browser=>{
  await browser.evaluate("const answers=['Stand-in case','Renamed case'];window.prompt=()=>answers.shift();"+show('evidence')+"document.getElementById('newCase').click();");
  await browser.waitFor("return document.getElementById('caseSelect').selectedOptions[0]?.textContent==='Stand-in case (0)'",{label:'case created'});
  await browser.evaluate(show('deep'));
  await browser.waitFor("return !!document.querySelector('[data-open-deep=\"person-run-1234\"]')");
  await browser.evaluate("document.querySelector('[data-open-deep=\"person-run-1234\"]').click();");
  await browser.waitFor("return !!document.querySelector('[data-deep-save]')");
  await browser.evaluate("document.querySelector('[data-deep-save]').click();");
  await browser.evaluate(show('evidence'));
  await browser.waitFor("return document.querySelectorAll('#evidenceList article').length===1",{label:'finding saved'});
  await browser.evaluate("document.getElementById('renameCase').click();");
  await browser.waitFor("return document.getElementById('caseSelect').selectedOptions[0]?.textContent==='Renamed case (1)'",{label:'case renamed'});
  await browser.evaluate("document.getElementById('deleteCase').click();");
  await browser.waitFor("return document.getElementById('confirmDialog').open");
  await browser.evaluate(confirmButton('Delete case'));
  await browser.waitFor("return document.getElementById('caseSelect').options[0]?.textContent==='No cases yet'",{label:'case deleted'});
}));

// Some browsers block site data (private windows, privacy settings); the app must still start and work.
const BLOCK_STORAGE=`for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{configurable:true,get(){const error=new Error('The operation is insecure.');error.name='SecurityError';throw error;}});`;
test('the app starts and works when the browser blocks site storage',options,()=>inApp(async browser=>{
  assert.equal(await browser.evaluate("try{localStorage;return 'readable';}catch(error){return error.name;}"),'SecurityError');
  await browser.evaluate(show('deep'));
  await browser.waitFor("return document.querySelectorAll('[data-open-deep]').length===2",{label:'server calls still work'});
  await browser.evaluate("document.getElementById('themeToggle').click();");
  assert.equal(await browser.evaluate('return document.documentElement.dataset.theme'),'dark');
},{beforeLoad:BLOCK_STORAGE}));

test('on a phone, both search boxes show and the history table scrolls inside its box',options,()=>inApp(async browser=>{
  await browser.setSize(375,812);
  await browser.open(await browser.evaluate('return location.href'));
  const visible=id=>`const element=document.getElementById(${JSON.stringify(id)});const box=element.getBoundingClientRect();return getComputedStyle(element.closest('label')||element).display!=='none'&&box.width>0&&box.right<=innerWidth;`;
  await browser.evaluate(show('library'));
  assert.equal(await browser.evaluate(visible('toolFilter')),true,'tool filter visible');
  await browser.evaluate(show('news'));
  assert.equal(await browser.evaluate(visible('intelNewsFilter')),true,'news search visible');
  await browser.evaluate(show('deep'));
  await browser.waitFor("return !!document.querySelector('#deepHistory .table-scroll')");
  assert.deepEqual(await browser.evaluate(`const box=document.querySelector('#deepHistory .table-scroll');box.scrollLeft=10000;
    const open=document.querySelector('#deepHistory [data-open-deep]').getBoundingClientRect();
    return {scrolls:box.scrollWidth>box.clientWidth,openReachable:open.right<=innerWidth&&open.left>=0,pageFits:document.documentElement.scrollWidth<=innerWidth};`),
    {scrolls:true,openReachable:true,pageFits:true});
}));

// Passive search on the Search page. Open OSINT is stood in for (see STUB_MCP); every name in it is a stand-in.
const STORY={title:'Owner Example opens a new office',link:'https://news.example/owner-example-office'};
const NAME_ANSWERS={
  get_wikidata:{entities:[
    {id:'wd:Q2',label:'Owner Example Jr.',description:'Stand-in relative',wikiUrl:'https://www.wikidata.org/wiki/Q2'},
    {id:'wd:Q1',label:'Owner Example',description:'Stand-in person',wikiUrl:'https://www.wikidata.org/wiki/Q1',facts:{website:'owner-site.example'}}]},
  get_news_rss:{items:[{...STORY,pubDate:'2026-11-10T09:00:00Z',source:'Stand-in Wire'},{title:'Unrelated weather story',link:'https://news.example/weather'}]},
  get_gdelt:{articles:[{title:STORY.title,url:STORY.link,seendate:'20261110T090000Z',domain:'news.example'}]},
  get_opensanctions:{entities:[{name:'Owner Example',dataset:'Stand-in list'}]},
  get_offshore_leaks:{entities:[]}
};
const connectOpenOsint=async(browser,answers,delays={})=>{
  await browser.evaluate(`${STUB_MCP}window.__mcp.answers=${JSON.stringify(answers)};window.__mcp.delays=${JSON.stringify(delays)};${show('servers')}`);
  await browser.evaluate("[...document.querySelectorAll('[data-connect]')].find(button=>button.closest('article,li')?.textContent.includes('Open OSINT')).click();");
  await browser.waitFor("return [...document.querySelectorAll('article,li')].some(card=>/Open OSINT/.test(card.textContent)&&/Connected · 7 tools/.test(card.textContent))",{timeout:20_000,label:'Open OSINT connected'});
  await browser.waitFor("return !document.getElementById('serverList').textContent.includes('Connecting…')",{timeout:20_000,label:'startup server notices settled'});
};
const search=async(browser,query)=>{
  await browser.evaluate(`${show('workspace')}document.getElementById('query').value=${JSON.stringify(query)};document.getElementById('investigateForm').requestSubmit();`);
};
const groupText=title=>`return [...document.querySelectorAll('#resultBody .passive-group')].find(group=>group.querySelector('h3')?.textContent===${JSON.stringify(title)})?.textContent||''`;
const searchDone="return /Search details/.test(document.getElementById('resultBody').textContent)&&!/still working/.test(document.querySelector('#resultBody .search-details')?.textContent||'still working')";
const caseFindings=`const id=document.getElementById('caseSelect').value;
  const response=await fetch('/api/cases/'+id,{headers:{'x-public-desk-token':sessionStorage.getItem('publicDesk.access')}});
  return (await response.json()).evidence.map(item=>({title:item.title,note:item.note}));`;

test('a name search groups results, ranks the exact name first, and shows each result once',options,()=>inApp(async browser=>{
  await connectOpenOsint(browser,NAME_ANSWERS);
  await search(browser,'Owner Example');
  await browser.waitFor(searchDone,{label:'every source answered'});
  const identity=await browser.evaluate("return document.querySelector('#resultBody .passive-group .passive-card strong')?.textContent");
  assert.equal(identity,'Owner Example','the exact name is the identity card');
  assert.match(await browser.evaluate(groupText('Who or what this is')),/Other people or things with this name[\s\S]*Owner Example Jr\./);
  const news=await browser.evaluate(groupText('News'));
  assert.equal(news.split(STORY.title).length-1,1,'the same story from two sources is shown once');
  assert.match(await browser.evaluate(groupText('Records')),/Owner Example[\s\S]*Stand-in list/);
  const calls=await browser.evaluate('return window.__mcp.calls');
  for(const name of ['get_wikidata','get_news_rss','get_gdelt','get_opensanctions','get_offshore_leaks'])assert.ok(calls.includes(`tools/call:${name}`),name);
  assert.ok(!calls.includes('tools/call:get_opencorporates'),'a person is not looked up in company registers');
}));

test('a subject Wikidata calls an organisation is also looked up in company registers',options,()=>inApp(async browser=>{
  await connectOpenOsint(browser,{...NAME_ANSWERS,get_wikidata:{entities:[{id:'wd:Q3',label:'Owner Example',description:'Stand-in business',facts:{instanceOf:['wd:Q4830453']}}]},
    get_opencorporates:{results:{companies:[{company:{name:'Owner Example',jurisdiction_code:'xx',current_status:'Active'}}]}}});
  await search(browser,'Owner Example');
  await browser.waitFor("return (window.__mcp.calls||[]).includes('tools/call:get_opencorporates')",{label:'company registers asked'});
  await browser.waitFor(searchDone,{label:'every source answered'});
  assert.match(await browser.evaluate(groupText('Records')),/xx · Active/);
}));

test('a website, IP or username opens Deep Search instead',options,()=>inApp(async browser=>{
  await connectOpenOsint(browser,NAME_ANSWERS);
  for(const [query,kind] of [['192.0.2.4','IP address'],['@ownername','username']]){
    await search(browser,query);
    await browser.waitFor(`return document.getElementById('resultTitle').textContent===${JSON.stringify(query)}&&/This looks like an? ${kind}\\./.test(document.getElementById('resultBody').textContent)`,{label:`${query} handed off`});
  }
  await search(browser,'owner-site.example');
  await browser.waitFor("return !!document.querySelector('#resultBody [data-open-deep-search]')",{label:'hand-off shown'});
  assert.match(await browser.evaluate("return document.getElementById('resultBody').textContent"),/This looks like a website\./);
  assert.equal(await browser.evaluate("return document.getElementById('saveEvidence').hidden"),true,'nothing to save');
  await browser.evaluate("document.querySelector('[data-open-deep-search]').click();");
  await browser.waitFor("return !document.getElementById('deep').hidden&&document.querySelector('[data-view=\"deep\"]').getAttribute('aria-current')==='page'",{label:'Deep Search shown'});
  assert.deepEqual(await browser.evaluate("return {value:document.getElementById('deepTarget').value,setup:!document.getElementById('deepSetup').hidden,running:!document.getElementById('deepProgress').hidden,dialog:document.getElementById('resultDialog').open}"),
    {value:'owner-site.example',setup:true,running:false,dialog:false});
  assert.ok(!(await browser.evaluate('return window.__mcp.calls')).some(call=>call.startsWith('tools/call')),'no tool was called');
}));

test('an event search lists news newest first, and the sort can change',options,()=>inApp(async browser=>{
  await connectOpenOsint(browser,{get_gdelt:{articles:[
    {title:'Earthquake shakes Example City',url:'https://news.example/quake',seendate:'20261101T080000Z',domain:'news.example'},
    {title:'Aftershock reported',url:'https://news.example/aftershock',seendate:'20261112T080000Z',domain:'news.example',snippet:'Residents of Example City felt an aftershock.'}]}});
  await search(browser,'earthquakes in Example City');
  await browser.waitFor(searchDone,{label:'every source answered'});
  const order="return [...document.querySelectorAll('#resultBody .news-row a')].map(link=>link.textContent)";
  assert.equal(await browser.evaluate("return document.getElementById('newsSort').value"),'newest');
  assert.deepEqual(await browser.evaluate(order),['Aftershock reported','Earthquake shakes Example City']);
  await browser.evaluate("const select=document.getElementById('newsSort');select.value='relevant';select.dispatchEvent(new Event('change',{bubbles:true}));");
  await browser.waitFor("return document.querySelector('#resultBody .news-row a')?.textContent==='Earthquake shakes Example City'",{label:'most relevant first'});
  assert.equal(await browser.evaluate("return document.getElementById('newsSort').value"),'relevant');
  assert.equal(await browser.evaluate("return document.querySelectorAll('#newsSort').length"),1);
}));

test('Save to case saves that one result with its note',options,()=>inApp(async browser=>{
  await browser.evaluate("window.prompt=()=> 'Stand-in case';");
  await connectOpenOsint(browser,NAME_ANSWERS);
  await search(browser,'Owner Example');
  await browser.waitFor(searchDone,{label:'every source answered'});
  await browser.evaluate("document.querySelector('#resultBody .record-row [data-save-result]').click();");
  await browser.waitFor("return document.querySelector('#resultBody .record-row [data-save-result]')?.textContent==='Saved'",{label:'button says Saved'});
  assert.equal(await browser.evaluate("return document.getElementById('toast').textContent"),'Saved to Stand-in case');
  assert.equal(await browser.evaluate("return document.getElementById('resultDialog').open"),true,'the results stay open');
  assert.deepEqual(await browser.evaluate(caseFindings),[{title:'Owner Example',note:'From Passive search: Owner Example'}]);
}));

test('a saved result stays saved through live updates',options,()=>inApp(async browser=>{
  await browser.evaluate("window.prompt=()=> 'Stand-in case';");
  await connectOpenOsint(browser,NAME_ANSWERS,{get_offshore_leaks:3000});
  await browser.evaluate("const before=window.fetch;window.__evidencePosts=0;window.fetch=(url,options)=>{if(/\\/evidence$/.test(String(url)))window.__evidencePosts++;return before(url,options);};");
  await search(browser,'Owner Example');
  await browser.waitFor("return !!document.querySelector('#resultBody .news-row [data-save-result]')&&/still working/.test(document.querySelector('#resultBody .search-details').textContent)",{label:'news shown while a source is pending'});
  await browser.evaluate("document.querySelector('#resultBody .news-row [data-save-result]').click();");
  await browser.waitFor("return document.querySelector('#resultBody .news-row [data-save-result]')?.textContent==='Saved'",{label:'saved'});
  await browser.waitFor(searchDone,{label:'the slow source answered',timeout:10000});
  assert.equal(await browser.evaluate("return document.querySelector('#resultBody .news-row [data-save-result]').textContent"),'Saved');
  await browser.evaluate("const button=document.querySelector('#resultBody .news-row [data-save-result]');button.disabled=false;button.click();");
  await new Promise(resolve=>setTimeout(resolve,500));
  assert.equal(await browser.evaluate('return window.__evidencePosts'),1,'a second press sends nothing');
  assert.equal((await browser.evaluate(caseFindings)).length,1);
}));

test('a pivot on a website goes to Deep Search',options,()=>inApp(async browser=>{
  await connectOpenOsint(browser,NAME_ANSWERS);
  await search(browser,'Owner Example');
  await browser.waitFor(searchDone,{label:'every source answered'});
  const before=(await browser.evaluate('return window.__mcp.calls')).length;
  await browser.evaluate("document.querySelector('#resultBody [data-pivot=\"owner-site.example\"]').click();");
  await browser.waitFor("return !document.getElementById('deep').hidden&&document.getElementById('deepTarget').value==='owner-site.example'",{label:'Deep Search filled in'});
  assert.equal(await browser.evaluate("return document.getElementById('resultDialog').open||!document.getElementById('deepProgress').hidden"),false);
  assert.equal((await browser.evaluate('return window.__mcp.calls')).length,before,'nothing was searched');
}));
