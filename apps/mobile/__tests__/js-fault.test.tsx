import {NativeModules} from 'react-native';
import {captureJsFault,faultFingerprint,installJsFaultCapture} from '../js-fault';
import {DiagnosticBoundary} from '../components/diagnostic-boundary';
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
test('render observer captures but rethrows the same failure without a recovery render',()=>{
 const original=Error('original render failure');original.stack='Error: private\n at f (address at index.android.bundle:1:100)';
 const observer=new DiagnosticBoundary({children:null});
 expect(observer.render()).toBeNull();
 expect(()=>observer.componentDidCatch(original)).toThrow(original);
 expect(NativeModules.BobPlatform.recordJsFault).toHaveBeenCalledWith(expect.stringContaining('"source":"render"'));
});
