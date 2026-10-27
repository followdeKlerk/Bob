import {NativeModules} from 'react-native';
type ErrorPort={getGlobalHandler:()=>((error:unknown,fatal?:boolean)=>void);setGlobalHandler:(handler:(error:unknown,fatal?:boolean)=>void)=>void};
const types=new Set(['Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError']);
/** Never send raw error text, stack, function names, URLs or filenames across the bridge. */
export function faultFingerprint(error:unknown,source:'global'|'render',fatal:boolean){
 let type='other',stack='';
 try{if(error&&typeof error==='object'){
  const value=error as {name?:unknown;stack?:unknown};
  if(typeof value.name==='string'&&types.has(value.name))type=value.name;
  if(typeof value.stack==='string')stack=value.stack.slice(0,32768);
 }}catch{/* Hostile getters must not replace the original failure. */}
 const frames:{line:number;column:number}[]=[];
 // Release Hermes frames only. Debug URLs and arbitrary source filenames are deliberately omitted.
 for(const line of stack.split('\n').slice(1,65)){
  const match=line.match(/^\s*(?:at .{0,160}?\((?:address at )?index\.android\.bundle:(\d+):(\d+)\)|[^@\n]{0,160}@(?:address at )?index\.android\.bundle:(\d+):(\d+))\s*$/);
  if(!match)continue;
  const row=Number(match[1]??match[3]),column=Number(match[2]??match[4]);
  if(Number.isSafeInteger(row)&&row>0&&row<=10000000&&Number.isSafeInteger(column)&&column>=0&&column<=100000000)frames.push({line:row,column});
  if(frames.length===16)break;
 }
 return {source,type,fatal,frames};
}
export function captureJsFault(error:unknown,source:'global'|'render',fatal=true){
 try{NativeModules.BobPlatform?.recordJsFault?.(JSON.stringify(faultFingerprint(error,source,fatal)));}catch{/* Best effort, including allocation failures. */}
}
let installed=false;
export function installJsFaultCapture(port:ErrorPort|undefined=(globalThis as unknown as {ErrorUtils?:ErrorPort}).ErrorUtils){
 try {
 if(installed||!port)return;
 const previous=port.getGlobalHandler();if(typeof previous!=='function')return;
 port.setGlobalHandler((error,fatal)=>{try{captureJsFault(error,'global',!!fatal);}finally{previous(error,fatal);}});
 installed=true;
 } catch {/* A missing error API must not prevent app startup. */}
}
