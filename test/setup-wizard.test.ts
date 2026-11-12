import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guidedSetup,type SetupInspection,type SetupPort} from '../src/setup-wizard.js';
const id='11111111-1111-4111-8111-111111111111',endpoint='https://machine.tailnet.ts.net:49158';
function fixture(snapshot:Partial<SetupInspection>={},answers:boolean[]=[true,true]){
 const calls:string[]=[],messages:string[]=[];
 const ready:SetupInspection={exists:true,backendId:id,owned:false,managed:false,configurationReady:true,endpoint};
 const port:SetupPort={say:text=>messages.push(text),ask:async(q,fallback)=>{calls.push('ask:'+q);return fallback??endpoint;},confirm:async q=>{calls.push('confirm:'+q);return answers.shift()??false;},inspect:async()=>{calls.push('inspect');return {exists:false,owned:false,managed:false,configurationReady:false,...snapshot};},configure:async()=>{calls.push('configure');return ready;},prepareNetwork:async()=>{calls.push('network');return endpoint;},startService:async()=>{calls.push('service');return true;},verify:async()=>{calls.push('verify');},pair:async()=>{calls.push('pair');}};
 return {port,calls,messages,ready};
}
test('new installation confirms configuration and verifies HTTPS before offering private QR pairing',async()=>{
 const f=fixture();const result=await guidedSetup('/new/state',f.port);
 assert.equal(result.status,'invitation-issued');assert.deepEqual(f.calls.filter(s=>!s.startsWith('ask:')&&!s.startsWith('confirm:')),['inspect','configure','network','service','verify','pair']);
 assert.match(f.messages.join('\n'),/does not confirm pairing/);
});
test('declining new setup performs inspection only and cannot initialize, install, serve or pair',async()=>{
 const f=fixture({},[false]);assert.equal((await guidedSetup('/new/state',f.port)).status,'unchanged');
 assert.deepEqual(f.calls.filter(s=>!s.startsWith('ask:')&&!s.startsWith('confirm:')),['inspect']);
});
for(const flag of ['owned','managed'] as const)test(`${flag} existing backend can only verify and pair, never reconfigure or replace its service`,async()=>{
 const f=fixture({exists:true,backendId:id,[flag]:true,endpoint},[true,true]);
 assert.equal((await guidedSetup('/existing/state',f.port)).status,'invitation-issued');
 assert.deepEqual(f.calls.filter(s=>!s.startsWith('ask:')&&!s.startsWith('confirm:')),['inspect','verify','pair']);
});
test('declining reuse leaves existing installation unchanged',async()=>{
 const f=fixture({exists:true,backendId:id,owned:true,endpoint},[false]);assert.equal((await guidedSetup('/state',f.port)).status,'unchanged');assert.ok(!f.calls.includes('verify'));
});
test('configured offline state reuses credentials and does not call configuration again',async()=>{
 const f=fixture({exists:true,backendId:id,configurationReady:true},[false]);
 assert.equal((await guidedSetup('/state',f.port)).status,'ready-unpaired');assert.ok(!f.calls.includes('configure'));assert.ok(!f.calls.includes('pair'));
});
test('failed readiness cannot produce a QR or claim readiness',async()=>{
 const f=fixture();f.port.verify=async()=>{throw Error('TLS failed');};
 await assert.rejects(guidedSetup('/state',f.port),/TLS failed/);assert.ok(!f.calls.includes('pair'));assert.ok(!f.messages.some(s=>s.startsWith('Backend identity and trusted')));
});
for(const step of ['network','service'] as const)test(`declining ${step} preserves partial configuration but does not verify/pair`,async()=>{
 const f=fixture();if(step==='network')f.port.prepareNetwork=async()=>undefined;else f.port.startService=async()=>false;
 assert.equal((await guidedSetup('/state',f.port)).status,'incomplete');assert.ok(!f.calls.includes('verify'));assert.ok(!f.calls.includes('pair'));
});
test('existing endpoint must be HTTPS Tailscale before any probe or QR',async()=>{
 const f=fixture({exists:true,backendId:id,owned:true,endpoint:'http://example.com'},[true]);
 await assert.rejects(guidedSetup('/state',f.port),/HTTPS origin/);assert.ok(!f.calls.includes('verify'));assert.ok(!f.calls.includes('pair'));
});
test('an incomplete credential step does not advance or silently retry',async()=>{
 const f=fixture();f.port.configure=async()=>({...f.ready,configurationReady:false});
 await assert.rejects(guidedSetup('/state',f.port),/incomplete/);assert.ok(!f.calls.includes('network'));
});

test('running standalone setup explicitly explains that pairing does not install updates',async()=>{
 const f=fixture({exists:true,backendId:id,owned:true,endpoint},[false]);await guidedSetup('/state',f.port);
 assert.match(f.messages.join('\n'),/no update supervisor/);assert.match(f.messages.join('\n'),/bob updates install --help/);
});
