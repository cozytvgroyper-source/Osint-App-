import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_IDENTIFIERS,MAX_ROUNDS,PASSIVE_CONCURRENCY,runDeepSearch} from '../public/deep-engine.js';

const schemaFor=type=>({type:'object',properties:{[type]:{type:'string'}},required:[type]});
const tool=(name,serverName,input='target')=>({name,serverName,inputSchema:schemaFor(input)});
const toolbox=(name,input)=>tool(name,'OSINT Toolbox',input);
const omega=name=>tool(name,'Omega MCP','target');
const textResult=text=>({content:[{type:'text',text}],isError:false});

test('a person search follows linked leads and never exceeds three rounds',async()=>{
  const seen=[];
  const tools=[toolbox('phoneinfoga_scan','number'),toolbox('holehe_email_search','email')];
  const run=await runDeepSearch({id:'person-run',target:{type:'phone',value:'+15555550100'},level:3,tools,excluded:new Set(),confirmation:{acknowledged:true},
    callTool:async(current,args)=>{seen.push([current.name,args]);return{result:current.name==='phoneinfoga_scan'?textResult('Contact lead@example.net for this number'):textResult('[+] ExampleSite')}}
  });
  assert.equal(run.outcome,'completed');
  assert.ok(seen.some(([name,args])=>name==='holehe_email_search'&&args.email==='lead@example.net'));
  assert.ok(run.rounds<=MAX_ROUNDS);
  assert.ok(run.findings.some(finding=>finding.status==='linked'));
});

test('Light touch and higher calls never overlap; Passive runs at most four at a time',async()=>{
  const tools=[toolbox('whois_lookup','domain'),toolbox('dns_lookup','domain'),toolbox('crtsh_certificate_search','domain'),toolbox('wayback_snapshots','url'),toolbox('dnstwist_lookalike_domains','domain'),omega('omega_headers'),omega('omega_ssl'),omega('omega_ports')];
  let passive=0,controlled=0,maxPassive=0,maxControlled=0;
  const callTool=async(current,args,options)=>{
    const active=['omega_headers','omega_ssl','omega_ports'].includes(current.name);
    if(active){controlled++;maxControlled=Math.max(maxControlled,controlled);}else{passive++;maxPassive=Math.max(maxPassive,passive);}
    await new Promise(resolve=>setTimeout(resolve,8));
    if(active)controlled--;else passive--;
    return{result:textResult(JSON.stringify({target:args.target||args.domain||args.url,status:'ok'}))};
  };
  await runDeepSearch({id:'concurrency',target:{type:'domain',value:'example.com'},level:2,tools,excluded:new Set(),confirmation:{acknowledged:true,authorization:true},callTool,
    requestGrant:async()=>({token:'grant',expiresAt:Date.now()+1e6})});
  assert.ok(maxPassive<=PASSIVE_CONCURRENCY);
  assert.equal(maxControlled,1);
});

test('grants are chunked with runId and released at the end',async()=>{
  const tools=[omega('omega_headers'),omega('omega_ssl'),omega('omega_ports')];const requests=[];const released=[];
  await runDeepSearch({id:'grant-run',target:{type:'domain',value:'example.com'},level:2,tools,excluded:new Set(),confirmation:{acknowledged:true,authorization:true},
    callTool:async()=>({result:textResult('{}')}),requestGrant:async request=>{requests.push(request);return{token:`g${requests.length}`,expiresAt:Date.now()+1e6}},releaseGrants:async id=>released.push(id)});
  assert.ok(requests.length>=1);
  assert.ok(requests.every(request=>request.runId==='grant-run'&&request.ttlMs===30*60_000&&request.tools.length<=25));
  assert.deepEqual(released,['grant-run']);
});

test('a website linked to a person gets Passive and Light touch checks only',async()=>{
  const tools=[toolbox('phoneinfoga_scan','number'),toolbox('whois_lookup','domain'),omega('omega_headers'),omega('omega_ports')];
  const calls=[];const grants=[];
  await runDeepSearch({id:'linked-site',target:{type:'phone',value:'+15555550100'},level:3,tools,excluded:new Set(),confirmation:{acknowledged:true},
    callTool:async(current,args)=>{calls.push([current.name,args]);return{result:textResult(current.name==='phoneinfoga_scan'?'Website: https://blog.example/about':'{}')}},
    requestGrant:async request=>{grants.push(request);return{token:'site-grant',expiresAt:Date.now()+1e6}}});
  assert.ok(calls.some(([name,args])=>name==='whois_lookup'&&args.domain==='blog.example'));
  assert.ok(calls.some(([name,args])=>name==='omega_headers'&&args.target==='blog.example'));
  assert.ok(!calls.some(([name])=>name==='omega_ports'));
  assert.ok(grants.some(request=>request.target==='blog.example'&&request.level===1&&request.confirmation.acknowledged&&!request.confirmation.authorization));
});

test('an expired grant is renewed once with the same confirmation',async()=>{
  const tools=[omega('omega_headers')];let grants=0,calls=0;
  await runDeepSearch({id:'renew',target:{type:'domain',value:'example.com'},level:1,tools,excluded:new Set(),confirmation:{acknowledged:true},
    requestGrant:async()=>({token:`g${++grants}`,expiresAt:Date.now()+1e6}),
    callTool:async()=>{calls++;return calls===1?{error:{message:'current confirmed run grant expired'}}:{result:textResult('{}')}}});
  assert.equal(grants,2);
  assert.equal(calls,2);
});

test('a lead loop ends without repeating calls',async()=>{
  const tools=[toolbox('phoneinfoga_scan','number')];const keys=[];
  const run=await runDeepSearch({id:'loop',target:{type:'phone',value:'+15555550100'},level:0,tools,excluded:new Set(),confirmation:{acknowledged:true},
    callTool:async(current,args)=>{keys.push(`${current.name}:${args.number}`);return{result:textResult('Phone +15555550100')}}});
  assert.equal(new Set(keys).size,keys.length);
  assert.ok(run.rounds<=MAX_ROUNDS);
});

test('more than 25 identifiers are kept as leads not followed',async()=>{
  const tools=[toolbox('phoneinfoga_scan','number')];
  const emails=Array.from({length:30},(_,index)=>`lead${index}@example.net`).join(' ');
  const run=await runDeepSearch({id:'cap',target:{type:'phone',value:'+15555550100'},level:0,tools,excluded:new Set(),confirmation:{acknowledged:true},
    callTool:async()=>({result:textResult(emails)})});
  assert.ok(run.leadsNotFollowed.length>0);
  assert.equal(run.identifiersSearched<=MAX_IDENTIFIERS,true);
});

test('a failing and oversized tool do not stop the run',async()=>{
  const tools=[toolbox('whois_lookup','domain'),toolbox('dns_lookup','domain')];
  const run=await runDeepSearch({id:'resilient',target:{type:'domain',value:'example.com'},level:0,tools,excluded:new Set(),confirmation:{acknowledged:true},
    callTool:async current=>current.name==='whois_lookup'?{error:{message:'server dropped'}}:{result:textResult('x'.repeat(3_000_000))}});
  assert.equal(run.outcome,'completed');
  assert.ok(run.calls.some(call=>call.outcome==='error'));
  assert.ok(run.calls.some(call=>call.outcome==='trimmed'));
  assert.ok(Object.values(run.raw).every(value=>Buffer.byteLength(value)<=1_000_000));
});

test('cancel stops scheduling and returns what was found',async()=>{
  const controller=new AbortController();const tools=[toolbox('whois_lookup','domain'),toolbox('dns_lookup','domain'),toolbox('crtsh_certificate_search','domain')];let calls=0;
  const run=await runDeepSearch({id:'cancel',target:{type:'domain',value:'example.com'},level:0,tools,excluded:new Set(),confirmation:{acknowledged:true},signal:controller.signal,
    callTool:async()=>{calls++;controller.abort();return{result:textResult('{}')}}});
  assert.equal(run.outcome,'stopped');
  assert.ok(calls<tools.length);
});

test('events end with counts and done matching the final record',async()=>{
  const events=[];const tools=[toolbox('whois_lookup','domain')];
  const run=await runDeepSearch({id:'events',target:{type:'domain',value:'example.com'},level:0,tools,excluded:new Set(),confirmation:{acknowledged:true},onEvent:event=>events.push(event),callTool:async()=>({result:textResult('{"owner":"Example"}')})});
  assert.equal(events.at(-1).type,'done');
  const counts=events.filter(event=>event.type==='counts').at(-1);
  assert.equal(counts.done,run.calls.length);
});

test('website searches have one round',async()=>{
  const run=await runDeepSearch({id:'site',target:{type:'domain',value:'example.com'},level:0,tools:[toolbox('whois_lookup','domain')],excluded:new Set(),confirmation:{acknowledged:true},callTool:async()=>({result:textResult('{}')})});
  assert.equal(run.rounds,1);
});

test('public-only tools are skipped for a private IP and shown as skipped',async()=>{
  const openOsint=name=>tool(name,'Open OSINT','query');
  const tools=[openOsint('get_greynoise'),openOsint('get_bgp')];
  const runFor=async value=>{
    const seen=[];const events=[];
    const run=await runDeepSearch({id:`ip-${value}`,target:{type:'ip',value},level:0,tools,excluded:new Set(),confirmation:{acknowledged:true},
      callTool:async current=>{seen.push(current.name);return{result:textResult('{"ok":true}')};},
      onEvent:event=>events.push(event)});
    return {run,seen,events};
  };
  const privateRun=await runFor('192.168.1.10');
  assert.deepEqual(privateRun.seen,['get_bgp']);
  const skipped=privateRun.run.calls.find(call=>call.tool==='get_greynoise');
  assert.deepEqual({outcome:skipped.outcome,error:skipped.error,ms:skipped.ms},{outcome:'skipped',error:'Only covers public internet addresses.',ms:0});
  const lastCounts=privateRun.events.filter(event=>event.type==='counts').at(-1);
  assert.equal(lastCounts.total,2);assert.equal(lastCounts.done,2);
  assert.ok(privateRun.events.some(event=>event.type==='tool-end'&&event.tool.name==='get_greynoise'&&event.outcome==='skipped'));
  const publicRun=await runFor('8.8.8.8');
  assert.deepEqual(publicRun.seen.sort(),['get_bgp','get_greynoise']);
  assert.equal(publicRun.run.calls.some(call=>call.outcome==='skipped'),false);
});

test('a refused permission fails only its own tools and the run keeps everything else',async()=>{
  const tools=[toolbox('whois_lookup','domain'),toolbox('dns_lookup','domain'),omega('omega_headers'),omega('omega_ssl')];const called=[];let released=0;
  const run=await runDeepSearch({id:'refused-run',target:{type:'domain',value:'example.com'},level:2,tools,excluded:new Set(),confirmation:{acknowledged:true,authorization:true},
    callTool:async current=>{called.push(current.name);return{result:textResult(JSON.stringify({target:'example.com',status:'ok'}))};},
    requestGrant:async()=>{throw new Error('Server refused the grant (HTTP 400)');},releaseGrants:async()=>{released+=1;}});
  assert.equal(run.outcome,'completed');
  assert.deepEqual(called.sort(),['dns_lookup','whois_lookup']);
  const refused=run.calls.filter(call=>['omega_headers','omega_ssl'].includes(call.tool));
  assert.equal(refused.length,2);
  for(const call of refused){assert.equal(call.outcome,'error');assert.match(call.error,/permission.*Server refused the grant \(HTTP 400\)/i);}
  assert.equal(run.calls.filter(call=>call.outcome!=='error').length,2);
  assert.equal(released,1);
});

test('a person search keeps round-one findings when a later permission is refused',async()=>{
  const tools=[toolbox('holehe_email_search','email'),toolbox('phoneinfoga_scan','number'),omega('omega_headers')];let asked=0;
  const run=await runDeepSearch({id:'person-refused',target:{type:'phone',value:'+15555550100'},level:0,tools,excluded:new Set(),confirmation:{acknowledged:true},
    callTool:async(current)=>({result:current.name==='phoneinfoga_scan'?textResult('Contact lead@owner-site.example, site https://owner-site.example'):textResult('[+] ExampleSite')}),
    requestGrant:async()=>{asked+=1;throw new Error('network blip');}});
  assert.equal(run.outcome,'completed');
  assert.ok(asked>=1,'a permission was asked for the lead website');
  assert.ok(run.calls.some(call=>call.tool==='omega_headers'&&call.outcome==='error'&&/network blip/.test(call.error)));
  assert.ok(run.calls.some(call=>call.tool==='phoneinfoga_scan'&&call.outcome!=='error'));
  assert.ok(run.findings.length>0);
});

test('a failed permission renewal records the tool error instead of ending the run',async()=>{
  const tools=[omega('omega_headers'),omega('omega_ssl')];let grants=0;
  const run=await runDeepSearch({id:'renew-fail',target:{type:'domain',value:'example.com'},level:2,tools,excluded:new Set(),confirmation:{acknowledged:true,authorization:true},
    callTool:async()=>({error:{message:'Run grant expired'}}),
    requestGrant:async()=>{grants+=1;if(grants>1)throw new Error('refused on renewal');return{token:'g1',expiresAt:Date.now()+1e6};}});
  assert.equal(run.outcome,'completed');
  assert.equal(run.calls.length,2);
  assert.ok(run.calls.every(call=>call.outcome==='error'&&/expired/.test(call.error)));
});
