import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateToolArguments} from '@earendil-works/pi-ai/utils/validation';
import {delegationSchema} from '../src/delegation.js';
import {DEFAULT_DELEGATION} from '../src/delegation-config.js';
import {createMcpTool} from '../src/mcp-tools.js';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
const parse=(parameters:any,args:Record<string,unknown>)=>validateToolArguments({name:'fixture',description:'Schema boundary fixture',parameters},{type:'toolCall',id:'fixture',name:'fixture',arguments:args});

test('Pi1.5 native validator preserves optional delegation fields and exact route allowlists',()=>{
 const schema=delegationSchema({...DEFAULT_DELEGATION,mode:'profile_routes',profileRoutes:{profiles:[{name:'researcher',description:'Read-only research'},{name:'reviewer',description:'Independent review'}],default:'researcher'}});
 assert.deepEqual(parse(schema,{action:'status'}),{action:'status'});
 assert.deepEqual(parse(schema,{action:'stop',name:'helper'}),{action:'stop',name:'helper'});
 assert.equal(parse(schema,{action:'spawn',name:'helper',message:'Bounded task',profile:'reviewer'}).profile,'reviewer');
 assert.throws(()=>parse(schema,{action:'spawn',profile:'unconfigured'}),/Validation failed/);
 assert.throws(()=>parse(schema,{action:'status',provider:'unconfigured'}),/Validation failed/);
 assert.throws(()=>parse(schema,JSON.parse('{"action":"status","__proto__":{"polluted":true}}')),/Validation failed/);
 assert.equal(({} as any).polluted,undefined);
});
test('Pi1.5 coercion is copy-on-validate and opaque MCP arguments are not reinterpreted',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'bob-pi15-schema-')),state=new State(directory),runtime=await openRuntime(state);
 try{
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx),notes=(await chat.agent(ctx)).tools.find(t=>t.name==='notes')!;
  assert.ok(notes);
  const raw={action:'update',id:'7acde8e3-0293-4b4b-9398-599dc0fc47af',expectedRevision:'4',categories:'Work',body:null};
  const result=parse(notes.parameters,raw);assert.equal(result.expectedRevision,4);assert.deepEqual(result.categories,['Work']);assert.equal(result.body,undefined);
  assert.deepEqual(raw,{action:'update',id:'7acde8e3-0293-4b4b-9398-599dc0fc47af',expectedRevision:'4',categories:'Work',body:null});
  assert.throws(()=>parse(notes.parameters,{action:'get',id:'not-a-uuid'}),/Validation failed/);
  const tool=createMcpTool({get:()=>undefined}),args={action:'call',serverId:'fixture',tool:'fixture',arguments:{page:'4',list:'one',empty:null}};
  assert.deepEqual(parse(tool.parameters,args).arguments,args.arguments);
  assert.throws(()=>validateToolArguments({name:'fixture',description:'Fixture',parameters:notes.parameters},{type:'toolCall',id:'broken',name:'fixture',arguments:{action:'list'},argumentsError:'Incomplete JSON'}),/Invalid arguments/);
 }finally{await runtime.close();state.close();rmSync(directory,{recursive:true,force:true});}
});
