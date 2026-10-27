declare const __dirname:string;
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,NativeModules} from 'react-native';
import {copyAppDiagnostics,recordAppEvent,useAppDiagnostics} from '../app-diagnostics';
beforeEach(()=>{NativeModules.BobPlatform={recordDiagnosticEvent:jest.fn(async()=>{}),appDiagnostics:jest.fn(async()=>'{"versionName":"test","events":[]}'),copyText:jest.fn(async()=>{})};});
afterEach(()=>jest.restoreAllMocks());
test('diagnostics are local event metadata and do not automatically export a report',async()=>{
 let listener!:(state:any)=>void;const remove=jest.fn();jest.spyOn(AppState,'addEventListener').mockImplementation((_event,fn)=>{listener=fn;return{remove};});
 function Harness(){useAppDiagnostics();return null;}let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<Harness/>);});
 listener('background');listener('active');expect(NativeModules.BobPlatform.recordDiagnosticEvent.mock.calls.map((call:any)=>call[0])).toEqual(['js.ready','js.background','js.active']);
 expect(NativeModules.BobPlatform.appDiagnostics).not.toHaveBeenCalled();expect(NativeModules.BobPlatform.copyText).not.toHaveBeenCalled();await act(async()=>tree.unmount());expect(remove).toHaveBeenCalled();
});
test('copy is explicit and copies exactly the local native report',async()=>{
 await copyAppDiagnostics();expect(NativeModules.BobPlatform.appDiagnostics).toHaveBeenCalledTimes(1);expect(NativeModules.BobPlatform.copyText).toHaveBeenCalledWith('{"versionName":"test","events":[]}');
});
test('missing native diagnostics or a recording failure cannot crash normal app operation',async()=>{
 NativeModules.BobPlatform.recordDiagnosticEvent.mockRejectedValue(Error('Unavailable'));expect(()=>recordAppEvent('back.root-ignored')).not.toThrow();await Promise.resolve();
 NativeModules.BobPlatform={};expect(()=>recordAppEvent('js.ready')).not.toThrow();await expect(copyAppDiagnostics()).rejects.toThrow('latest Android app');
});
test('native root Back dispatch has no Android finish/minimize fallback, including before JS is ready',()=>{
 const {readFileSync}=jest.requireActual('node:fs'),{resolve}=jest.requireActual('node:path');
 const native=readFileSync(resolve(__dirname,'../android/app/src/main/java/com/bobmobile/MainActivity.kt'),'utf8');
 expect(native).toContain('override fun onBackPressed()');expect(native).toContain('reactActivityDelegate.onBackPressed()');expect(native).toContain('override fun invokeDefaultOnBackPressed()');
 expect(native).not.toMatch(/super\.(onBackPressed|invokeDefaultOnBackPressed)\s*\(/);expect(native).not.toMatch(/\b(finish|moveTaskToBack)\s*\(/);
});

test('code-only native crash capture is wired before React Native initialization and stays private',()=>{
 const {readFileSync}=jest.requireActual('node:fs'),{resolve}=jest.requireActual('node:path');
 const source=(name:string)=>readFileSync(resolve(__dirname,'../android/app/src/main/java/com/bobmobile/'+name),'utf8');
 const application=source('MainApplication.kt'),diagnostics=source('AppDiagnostics.kt'),storage=source('CrashDiagnostics.kt'),fingerprint=source('CrashFingerprint.kt');
 expect(application.indexOf('CrashDiagnostics.install(this)')).toBeLessThan(application.indexOf('BobFullscreen.install(this)'));
 expect(application.indexOf('CrashDiagnostics.install(this)')).toBeLessThan(application.indexOf('loadReactNative(this)'));
 expect(diagnostics).toContain('put("schema", 3)');expect(diagnostics).toContain('CrashDiagnostics.report(context)');
 expect(storage).toContain('context.noBackupFilesDir');expect(storage).toContain('AtomicFile');expect(storage).toContain('CrashFingerprints.MAX_CHARS');
 expect(fingerprint).toContain('finally { previous.uncaughtException(thread, error) }');
 const executable=fingerprint.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
 expect(executable).not.toMatch(/\.(message|localizedMessage|fileName|threadName)\b|printStackTrace\s*\(|\.toString\s*\(/);
 expect(storage).not.toMatch(/https?:|OkHttp|HttpURLConnection|sendBroadcast|startService|externalFilesDir/);
});


test('runtime sampling is numeric, periodic, and stops in the background',async()=>{
 jest.useFakeTimers();NativeModules.BobPlatform.recordStreamSample=jest.fn(async()=>{});
 let change!:(state:any)=>void;jest.spyOn(AppState,'addEventListener').mockImplementation((_event,fn)=>{change=fn;return{remove:jest.fn()};});
 function Harness(){useAppDiagnostics();return null;}let tree!:Renderer.ReactTestRenderer;
 try{
  await act(async()=>{tree=Renderer.create(<Harness/>);});
  await act(async()=>jest.advanceTimersByTime(30000));
  expect(NativeModules.BobPlatform.recordStreamSample).toHaveBeenCalledTimes(4);
  for(const [sample] of NativeModules.BobPlatform.recordStreamSample.mock.calls)expect(Object.values(sample).every(value=>typeof value==='number')).toBe(true);
  change('background');await act(async()=>jest.advanceTimersByTime(60000));
  expect(NativeModules.BobPlatform.recordStreamSample).toHaveBeenCalledTimes(4);
  expect(NativeModules.BobPlatform.appDiagnostics).not.toHaveBeenCalled();
 }finally{await act(async()=>tree.unmount());jest.useRealTimers();}
});
