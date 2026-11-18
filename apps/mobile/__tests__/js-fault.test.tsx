import {NativeModules} from 'react-native';
import {captureJsFault,faultFingerprint,installJsFaultCapture} from '../js-fault';
declare const __dirname:string;
beforeEach(()=>{NativeModules.BobPlatform={recordJsFault:jest.fn(()=>true)};});
afterEach(()=>jest.restoreAllMocks());
test('only numeric release bundle positions and allowlisted types survive sanitization',()=>{
 const error={name:'TypeError',message:'PRIVATE CHAT Bearer secret',stack:'TypeError: PRIVATE CHAT\n    at sensitiveFunction (address at index.android.bundle:1:23456)\nsecretName@index.android.bundle:2:40\n at private (https://secret.example/code.js:1:23)\n at x (/home/owner/secret.js:1:2)'};
 expect(faultFingerprint(error,'global',true)).toEqual({source:'global',type:'TypeError',fatal:true,frames:[{line:1,column:23456},{line:2,column:40}]});
 captureJsFault(error,'global');const sent=NativeModules.BobPlatform.recordJsFault.mock.calls[0][0];
 expect(sent).not.toMatch(/PRIVATE|Bearer|secret|sensitive|https:|owner|message|stack/);
});
test('malformed, oversized and hostile error inputs stay bounded',()=>{
 expect(faultFingerprint({name:'private-type',stack:'error\n'+ 'at f (index.android.bundle:1:20)\n'.repeat(1000)},'render',true).frames).toHaveLength(16);
 expect(faultFingerprint({name:'private-type',stack:'x\nat f (index.android.bundle:0:4)\nat f (index.android.bundle:1:999999999)'},'render',true)).toMatchObject({type:'other',frames:[]});
 const hostile={get name(){throw Error('getter');}};expect(()=>captureJsFault(hostile,'global')).not.toThrow();
 NativeModules.BobPlatform.recordJsFault.mockImplementation(()=>{throw Error('disk');});expect(()=>captureJsFault(Error('original'),'global')).not.toThrow();
});
test('global hook always delegates the same exception and fatal flag to the original handler',()=>{
 let handler!:(error:unknown,fatal?:boolean)=>void;const original=jest.fn();
 installJsFaultCapture({getGlobalHandler:()=>original,setGlobalHandler:value=>{handler=value;}});
 const error=Error('original');NativeModules.BobPlatform.recordJsFault.mockImplementation(()=>{throw Error('capture failed');});
 handler(error,true);expect(original).toHaveBeenCalledWith(error,true);expect(original).toHaveBeenCalledTimes(1);
});
test('production React boundary renders recovery, allows one explicit retry, and contains fatal and repeated failures',()=>{
 const process=require('node:process'),{execFileSync}=require('node:child_process');
 const result=execFileSync(process.execPath,['-e',String.raw`
  const assert=require('node:assert/strict');
  const Module=require('node:module');
  const React=require('react');
  const Renderer=require('react-test-renderer');
  assert.equal(process.env.NODE_ENV,'production');
  const faults=[];
  const load=Module._load;
  Module._load=function(id,...args){
   if(id.includes('async-storage')||id.includes('keychain'))throw Error('Recovery must not access stored data');
   if(id==='react-native')return{Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',useColorScheme:()=> 'dark',NativeModules:{BobPlatform:{recordJsFault:value=>faults.push(JSON.parse(value))}}};
   return load.call(this,id,...args);
  };
  const source=require('esbuild').buildSync({entryPoints:['components/diagnostic-boundary.tsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','react-native'],jsx:'automatic'}).outputFiles[0].text;
  const compiled=new Module(require('node:path').resolve('boundary-production.cjs'),module);
  compiled.filename=require('node:path').resolve('boundary-production.cjs');compiled.paths=module.paths;compiled._compile(source,compiled.filename);
  const {DiagnosticBoundary}=compiled.exports;
  const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Timed out waiting for React commit');};
  const fallback=tree=>tree.toJSON()?.props?.testID==='diagnostic-fallback';
  const retry=tree=>tree.root.findAll(node=>node.props.accessibilityLabel==='Retry app once')[0];
  const originalConsole=console.error;console.error=()=>{};
  (async()=>{
   let fail=true,renders=0;
   const privateError=Error('PRIVATE text and credentials');privateError.stack='Error: PRIVATE\n at f (address at index.android.bundle:1:100)';
   function Child(){renders++;if(fail)throw privateError;return React.createElement('Editor',{value:'rehydrated saved draft'});}
   let tree=Renderer.create(React.createElement(DiagnosticBoundary,null,React.createElement(Child)));
   await wait(()=>fallback(tree));
   assert.equal(faults.length,1);assert.equal(faults[0].source,'render');assert.equal(faults[0].fatal,true);
   assert(!JSON.stringify(tree.toJSON()).includes('PRIVATE'));assert(!JSON.stringify(faults).includes('PRIVATE'));
   assert(JSON.stringify(tree.toJSON()).includes('Unsaved edits may not be recoverable'));
   const count=renders;await new Promise(resolve=>setTimeout(resolve,30));assert.equal(renders,count);
   fail=false;const action=retry(tree);action.props.onPress();action.props.onPress();
   await wait(()=>tree.toJSON()?.type==='Editor');assert.equal(tree.toJSON().props.value,'rehydrated saved draft');
   fail=true;tree.update(React.createElement(DiagnosticBoundary,null,React.createElement(Child,{changed:true})));
   await wait(()=>fallback(tree));assert.equal(retry(tree),undefined);assert(JSON.stringify(tree.toJSON()).includes('No more retries'));
   assert.equal(faults.length,2);tree.unmount();
   // A still-broken child fails the explicit retry, without a third attempt.
   tree=Renderer.create(React.createElement(DiagnosticBoundary,null,React.createElement(Child)));
   await wait(()=>fallback(tree));retry(tree).props.onPress();
   await wait(()=>fallback(tree)&&JSON.stringify(tree.toJSON()).includes('No more retries'));
   assert.equal(retry(tree),undefined);tree.unmount();
   for(const error of [Object.assign(Error('private invariant'),{name:'Invariant Violation'}),Object.assign(Error('private fatal'),{fatal:true})]){
    function Fatal(){throw error;}
    tree=Renderer.create(React.createElement(DiagnosticBoundary,null,React.createElement(Fatal)));
    await wait(()=>fallback(tree));assert.equal(retry(tree),undefined);assert(JSON.stringify(tree.toJSON()).includes('internal safety check failed'));tree.unmount();
   }
   console.error=originalConsole;
   console.log(JSON.stringify({production:true,capturedFaults:faults.length,retryRecovery:true,repeatedFailure:true,fatalBlocked:true}));
  })().catch(error=>{console.error=originalConsole;console.error(error);process.exitCode=1;});
 `],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,NODE_ENV:'production'},encoding:'utf8',timeout:15000});
 expect(JSON.parse(result.trim())).toEqual({production:true,capturedFaults:6,retryRecovery:true,repeatedFailure:true,fatalBlocked:true});
});
