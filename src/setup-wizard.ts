import {resolve} from 'node:path';
import {validateEndpoint} from './setup-service.js';
export type SetupInspection={exists:boolean;backendId?:string;owned:boolean;managed:boolean;configurationReady:boolean;endpoint?:string};
export type SetupPort={
 say:(text:string)=>void;
 ask:(question:string,fallback?:string)=>Promise<string>;
 confirm:(question:string)=>Promise<boolean>;
 inspect:(state:string)=>Promise<SetupInspection>;
 configure:(state:string,existing:SetupInspection)=>Promise<SetupInspection>;
 prepareNetwork:(state:string,inspection:SetupInspection)=>Promise<string|undefined>;
 startService:(state:string,inspection:SetupInspection,endpoint:string)=>Promise<boolean>;
 verify:(endpoint:string,id:string)=>Promise<void>;
 pair:(state:string,endpoint:string)=>Promise<void>;
};
/** Effects are explicit ports: the wizard never treats a failed/partial step as readiness. */
export async function guidedSetup(defaultState:string,port:SetupPort){
 port.say('Bob guided setup — Linux backend with supervised updates. Android build tools are optional and are not required for backend updates.\nAgents run with this OS account’s permissions; model providers receive prompts and may charge for use.\nExisting state, credentials and services are preserved. No live model request is sent by this wizard.');
 const state=resolve(await port.ask('Backend state directory',defaultState));
 let inspection=await port.inspect(state);
 port.say(inspection.exists?`Existing Bob backend: ${inspection.backendId}\nState: ${state}`:`New backend location: ${state}`);
 let endpoint:string|undefined;
 if(inspection.managed||inspection.owned){
  if(!inspection.managed)port.say('This running backend has no update supervisor. Pairing will not add one. For an explicit conversion from an independent maintenance process, see bob updates install --help and INSTALL.md.');
  port.say('This backend is already running or supervisor-managed. Setup will not reconfigure it, install another service, or restart it. Only verified pairing is offered.');
  if(!await port.confirm('Check its existing HTTPS endpoint and optionally pair a phone?'))return {state,status:'unchanged' as const};
  endpoint=validateEndpoint(await port.ask('Existing Tailscale HTTPS endpoint',inspection.endpoint));
 }else{
  if(!inspection.configurationReady){
   if(!await port.confirm(inspection.exists?'Complete missing configuration for this offline backend? Existing credentials will be kept.':'Create and configure this new backend?'))return {state,status:'unchanged' as const};
   inspection=await port.configure(state,inspection);
   if(!inspection.configurationReady)throw Error('Configuration is incomplete; no service or pairing was started. Rerun setup to continue.');
  }else port.say('Working folder and provider configuration found; reusing them without replacement.');
  endpoint=await port.prepareNetwork(state,inspection);
  if(!endpoint){port.say('Configuration kept. Networking is incomplete; no service or QR invitation was started. Rerun setup to continue.');return {state,status:'incomplete' as const};}
  endpoint=validateEndpoint(endpoint);
  if(!await port.startService(state,inspection,endpoint)){port.say('Configuration kept. Service setup was declined; no QR invitation issued.');return {state,status:'incomplete' as const};}
 }
 if(!inspection.backendId)throw Error('Backend identity is missing.');
 await port.verify(endpoint,inspection.backendId);
 port.say(`Backend identity and trusted HTTPS verified: ${endpoint}\nThis is a local readiness check, not proof that the phone can reach it or that provider inference works.`);
 if(!await port.confirm('Pair the Android app now? The QR invitation is private, single-use and expires shortly.'))return {state,endpoint,status:'ready-unpaired' as const};
 await port.pair(state,endpoint);
 port.say('Scan the QR code in Bob on your phone. Install/sign in to Tailscale on the phone too.\nThen send a short message and reconnect to verify the full path. Displaying an invitation does not confirm pairing.');
 return {state,endpoint,status:'invitation-issued' as const};
}
