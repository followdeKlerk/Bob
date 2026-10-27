import {takeStreamDiagnostics} from './stream-diagnostics';
import {AppState,NativeModules} from 'react-native';
import {useEffect} from 'react';
function sampleStreamDiagnostics(){
 try{void Promise.resolve(NativeModules.BobPlatform?.recordStreamSample?.(takeStreamDiagnostics())).catch(()=>{});}catch{/* Observability must not interrupt the app. */}
}
/** Local metadata only. Never pass a message, error body, URL, token or location. */
export function recordAppEvent(event:string){
 try{void Promise.resolve(NativeModules.BobPlatform?.recordDiagnosticEvent?.(event)).catch(()=>{});}catch{/* Diagnostics must not affect app operation. */}
}
export function useAppDiagnostics(){
 useEffect(()=>{
  recordAppEvent('js.ready');
  let timer:ReturnType<typeof setInterval>|undefined;
  const sampling=(active:boolean)=>{clearInterval(timer);timer=undefined;if(active){sampleStreamDiagnostics();timer=setInterval(sampleStreamDiagnostics,10000);}};
  sampling(AppState.currentState!=='background'&&AppState.currentState!=='inactive');
  const subscription=AppState.addEventListener('change',state=>{recordAppEvent(`js.${state}`);sampling(state==='active');});
  return()=>{clearInterval(timer);subscription.remove();};
 },[]);
}
export async function copyAppDiagnostics(){
 if(!NativeModules.BobPlatform?.appDiagnostics)throw Error('App diagnostics require the latest Android app.');
 const report=await NativeModules.BobPlatform.appDiagnostics();
 if(typeof report!=='string'||!report)throw Error('App diagnostics are unavailable.');
 await NativeModules.BobPlatform.copyText(report);
}
