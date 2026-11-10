import {NativeModules,Platform} from 'react-native';

export type TerminalStatus={available:boolean;reason?:string;cwd:string;session?:{id:string;state:string;cwd:string}};
export type TerminalConnection={sessionId:string;host:string;port:number;key:string;cwd:string};
export type TerminalTarget={backendId:string;conversationId:number;title:string};
export type TerminalControl={sequence:number;action:'input'|'ctrl'|'copy'|'paste'|'history'|'keyboard';text?:string;enabled?:boolean};
export type TerminalState={session:string;phase:'starting'|'running'|'closed'|'failed';ctrl?:boolean;acknowledged?:number};
export type TerminalNative={capabilities:()=>Promise<{available:boolean;reason?:string}>;prepare:(config:TerminalConnection&TerminalTarget)=>Promise<string>;releasePrepared:(handle:string)=>Promise<void>};

/** Seven keys fit at 337dp without shrinking text; large text wraps into balanced rows. */
export function terminalKeyLayout(width:number,fontScale:number){
 const available=Math.max(0,(Number.isFinite(width)?width:337)-16),gap=2;
 const scale=Math.max(1,Number.isFinite(fontScale)?fontScale:1);
 const minimum=Math.max(44,Math.ceil(32*scale+8));
 const columns=available>=7*minimum+6*gap?7:Math.max(1,Math.min(4,Math.floor((available+gap)/(minimum+gap))));
 return {columns,basis:Math.max(0,Math.floor((available-(columns-1)*gap)/columns)),faceHeight:Math.max(36,Math.ceil(20*scale+14))};
}

/** Strip only a known Tailscale MagicDNS suffix; ordinary FQDNs stay intact. */
export function terminalHostname(workstation:string){
 return workstation.replace(/\.tail[a-z0-9-]+\.ts\.net\.?$/i,'');
}

export function terminalNative():TerminalNative|undefined{
 const native=NativeModules.BobTerminal;
 return Platform.OS==='android'&&typeof native?.capabilities==='function'&&typeof native?.prepare==='function'&&typeof native?.releasePrepared==='function'?native:undefined;
}
// Never include the supplied value in an error: a bootstrap response contains a secret.
export function terminalConnection(value:unknown):TerminalConnection{
 const v=value as Partial<TerminalConnection>|null;
 if(!v||typeof v.sessionId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(v.sessionId)||typeof v.host!=='string'||!/^[0-9.]+$/.test(v.host)||typeof v.port!=='number'||!Number.isInteger(v.port)||v.port<1024||v.port>65535||typeof v.key!=='string'||!/^[A-Za-z0-9+/]{22}$/.test(v.key)||typeof v.cwd!=='string'||!v.cwd.startsWith('/')||v.cwd.includes('\0'))throw Error('Invalid terminal connection response. Refresh the session before trying again.');
 return {sessionId:v.sessionId,host:v.host,port:v.port,key:v.key,cwd:v.cwd};
}
export function terminalStatus(value:unknown):TerminalStatus{
 const v=value as Partial<TerminalStatus>|null;
 if(!v||typeof v.available!=='boolean'||typeof v.cwd!=='string'||(v.reason!==undefined&&typeof v.reason!=='string')||(v.session!==undefined&&(!v.session||typeof v.session.id!=='string'||typeof v.session.state!=='string'||typeof v.session.cwd!=='string')))throw Error('Could not read terminal status. Update the backend or try refreshing.');
 return {available:v.available,cwd:v.cwd,reason:v.reason,session:v.session};
}
