import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createModels} from '@earendil-works/pi-ai/models';
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {State} from '../src/state.js';
import {openRuntime,ctx} from '../src/runtime.js';
import {importCustomModule} from '../src/custom-modules.js';
import {listModules,selectModules} from '../src/modules.js';
import {installedDurableVersion} from '../src/recovery.js';

const guide=readFileSync('EXTENSIONS.md','utf8');
function example(marker:string,language:string){
 const matches=[...guide.matchAll(new RegExp(`<!-- ${marker} -->\\n\x60\x60\x60${language}\\n([\\s\\S]*?)\\n\x60\x60\x60`,'g'))];
 assert.equal(matches.length,1,`One unambiguous ${marker} block is required`);
 return matches[0]![1]!;
}

test('published stateless starter imports, registers, remains opt-in and executes through native Durable',async()=>{
 const directory=mkdtempSync(join(process.env.TMPDIR!,'bob-extension-guide-')),source=join(directory,'package');
 const version=installedDurableVersion(),manifest=JSON.parse(example('example-package','json').replaceAll('<INSTALLED_DURABLE_VERSION>',version));
 const state=new State(join(directory,'state')),models=createModels(),faux=fauxProvider({tokensPerSecond:10000});
 models.setProvider(faux.provider);
 let runtime:Awaited<ReturnType<typeof openRuntime>>|undefined;
 try{
  mkdirSync(join(source,'dist'),{recursive:true});
  writeFileSync(join(source,'package.json'),JSON.stringify(manifest));
  writeFileSync(join(source,'dist/index.js'),example('example-tool','js'));
  runtime=await openRuntime(state,models,undefined,{resume:false});
  const imported=await importCustomModule(state,runtime,'example-greeting',source);
  assert.equal(imported.installed,true);assert.equal(imported.defaultSelected,false);assert.equal(imported.restartRequired,true);
  assert.equal((await listModules(state,runtime)).find(module=>module.id==='example-greeting')?.registered,false);
  await runtime.close();runtime=undefined;
  runtime=await openRuntime(state,models);
  assert.equal((await listModules(state,runtime)).find(module=>module.id==='example-greeting')?.registered,true);
  const chat=await runtime.harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'faux',modelId:'faux-1'}}},ctx);
  assert.equal((await chat.agent(ctx)).tools.some(tool=>tool.name==='example_greeting'),false);
  await selectModules(state,runtime,chat,['example-greeting']);
  assert.deepEqual((await listModules(state,runtime,chat)).filter(module=>module.selected).map(module=>module.id),['example-greeting']);
  faux.setResponses([
   fauxAssistantMessage(fauxToolCall('example_greeting',{name:'Ada'}),{stopReason:'toolUse'}),
   fauxAssistantMessage('Synthetic greeting verified'),
  ]);
  const completed=await(await chat.submit({type:'input',content:'Exercise the documented example tool'},ctx)).wait(ctx);
  assert.equal(completed.status,'done');
  const results=(await chat.entries({},100,undefined,ctx)).items.filter(entry=>entry.kind==='pi.tool-result');
  assert.match(JSON.stringify(results),/Hello, Ada\./);
  assert.equal((await listModules(state,runtime,chat)).find(module=>module.id==='example-greeting')?.defaultSelected,false);
 }finally{await runtime?.close();state.close();rmSync(directory,{recursive:true,force:true});}
});
