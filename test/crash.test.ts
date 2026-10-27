import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
test('real process SIGKILL releases ownership; SQLite native admission resumes without resend',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR!,'bob-crash-'));
 const source=`import {State} from './dist/state.js';import {openRuntime,ctx} from './dist/runtime.js';import {createModels} from '@earendil-works/pi-ai/models';import {fauxProvider,fauxAssistantMessage} from '@earendil-works/pi-ai/providers/faux';const s=new State(${JSON.stringify(dir)}),m=createModels(),f=fauxProvider({tokensPerSecond:1});m.setProvider(f.provider);f.setResponses([fauxAssistantMessage('slow '.repeat(10000))]);const r=await openRuntime(s,m);const c=await r.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);const x=await c.submit({type:'input',content:'survive crash',requestId:'crash-operation'},ctx);console.log(JSON.stringify({chat:c.id,submission:x.id}));`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
 try{let output='';const admitted=await new Promise<{chat:number;submission:number}>((resolve,reject)=>{child.stdout.on('data',b=>{output+=b;if(output.includes('\n'))resolve(JSON.parse(output.split('\n')[0]));});child.once('error',reject);child.once('exit',code=>{if(!output)reject(Error('child exited '+code));});});const exit=once(child,'exit');child.kill('SIGKILL');await exit;
 const s=new State(dir),m=createModels(),f=fauxProvider();m.setProvider(f.provider);f.setResponses([fauxAssistantMessage('Recovered deterministic answer')]);const r=await openRuntime(s,m);
 try{const sub=(await r.harness.submission(admitted.submission as any,ctx))!;const settled=await sub.wait(ctx);assert.equal(settled.status,'done');const record=await r.harness.commit(tx=>tx.submissionByRequest(admitted.chat as any,'crash-operation'),ctx);assert.equal(record?.id,admitted.submission);const c=(await r.harness.conversation(admitted.chat as any,ctx))!;assert.equal((await c.entries({},100,undefined,ctx)).items.filter(e=>e.kind==='pi.user').length,1);}finally{await r.close();s.close();}
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
});
