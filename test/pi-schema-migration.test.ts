import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateToolArguments} from '@earendil-works/pi-ai/utils/validation';
import {createResources} from '@bob-local/resources';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {delegationSchema} from '../src/delegation.js';
import {DEFAULT_DELEGATION} from '../src/delegation-config.js';

// Captured from the pre-conversion Pi1.5 release, not regenerated from the new builders.
const baseline=JSON.parse(readFileSync(new URL('./fixtures/tool-schema-baseline.json',import.meta.url),'utf8'));
function canonical(value:any):any {
 if(Array.isArray(value))return value.map(canonical);
 if(!value||typeof value!=='object')return value;
 const result:any=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,canonical(item)]));
 // Only normalize these semantically equivalent builder encodings, never limits,
 // optionality, allowlists, unknown-property policy or other schema keywords.
 if('const' in result&&result.type===typeof result.const)delete result.type;
 if(result.anyOf?.length===1)return {...result.anyOf[0],...Object.fromEntries(Object.entries(result).filter(([key])=>key!=='anyOf'))};
 if(result.type==='object'&&result.patternProperties&&JSON.stringify(result.patternProperties)==='{"^.*$":{}}'&&!('additionalProperties' in result)){
  delete result.patternProperties;result.additionalProperties={};
 }
 return result;
}
function sample(schema:any):any {
 if('const' in schema)return schema.const;
 if(schema.enum)return schema.enum[0];
 if(schema.anyOf)return sample(schema.anyOf[0]);
 if(schema.type==='object')return Object.fromEntries((schema.required??[]).map((key:string)=>[key,sample(schema.properties[key])]));
 if(schema.type==='array')return Array.from({length:schema.minItems??1},()=>sample(schema.items));
 if(schema.type==='boolean')return true;
 if(schema.type==='integer'||schema.type==='number')return schema.minimum??0;
 if(schema.type==='string')return schema.format==='uuid'?'7acde8e3-0293-4b4b-9398-599dc0fc47af':'a'.repeat(Math.max(1,schema.minLength??1));
 return {};
}
function outcome(parameters:any,args:any){
 try{return {ok:true,value:validateToolArguments({name:'fixture',description:'Migration boundary',parameters},{type:'toolCall',id:'fixture',name:'fixture',arguments:args})};}
 catch{return {ok:false};}
}
test('pi-schema builders preserve every published tool schema and native parsing behavior',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-schema-parity-')),state=new State(dir),runtime=await openRuntime(state);
 try{
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const current:Record<string,any>=Object.fromEntries((await chat.agent(ctx)).tools.map(tool=>[tool.name,tool.parameters]));
  const maintenance=createResources(()=>chat.id,undefined,{describe:()=>'',request:()=>{throw Error('Parity test must never execute maintenance');}});
  current.self_update=maintenance.tools!.find(tool=>tool.name==='self_update')!.parameters;
  for(const mode of ['default','model_map','profile_routes'] as const)current['delegation:'+mode]=delegationSchema({...DEFAULT_DELEGATION,mode,modelMap:{options:[{name:'fast',description:'Fast',provider:'openai',model:'fixture',reasoning_effort:'high',service_tier:'normal'}],default:'fast'},profileRoutes:{profiles:[{name:'researcher',description:'Read-only research'},{name:'reviewer',description:'Independent review'}],default:'researcher'}});
  assert.deepEqual(Object.keys(current).sort(),Object.keys(baseline).sort());
  let comparisons=0;
  for(const [name,before] of Object.entries<any>(baseline)){
   const after=current[name];assert.deepEqual(canonical(after),canonical(before),`${name}: schema changed`);
   const seed=sample(before),cases:any[]=[{},seed,{...seed,unexpected:true},JSON.parse('{"__proto__":{"polluted":true}}')];
   for(const [key,property] of Object.entries<any>(before.properties??{})){
    const absent={...seed};delete absent[key];cases.push(absent);
    for(const value of [sample(property),null,'42',42,true,[],{},'invalid-value'])cases.push({...seed,[key]:value});
    if(property.minimum!==undefined)cases.push({...seed,[key]:property.minimum-1});
    if(property.maximum!==undefined)cases.push({...seed,[key]:property.maximum+1});
    if(property.maxLength!==undefined)cases.push({...seed,[key]:'a'.repeat(property.maxLength+1)});
   }
   for(const args of cases){const original=structuredClone(args);assert.deepEqual(outcome(after,args),outcome(before,args),`${name}: input contract drift`);assert.deepEqual(args,original,`${name}: validation mutated input`);comparisons++;}
  }
  assert.ok(comparisons>1000);assert.equal(({} as any).polluted,undefined);
 }finally{await runtime.close();state.close();rmSync(dir,{recursive:true,force:true});}
});
