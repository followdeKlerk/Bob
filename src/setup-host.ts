import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {accessSync,chmodSync,constants,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir,userInfo} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {State} from './state.js';
import {inspectOwner,acquireOwner} from './ownership.js';
import {createBackendModels} from './backend-models.js';
import {hasProviderCredential,setProviderKey} from './provider-auth.js';
import {guidedSetup,type SetupInspection,type SetupPort} from './setup-wizard.js';
import {readControlFloor} from './maintenance-migration.js';
import {checkSetupService,connectionEndpoint,installSetupService,renderSetupService,setupUnitName,validateConnection,verifyCertificate,verifySetupEndpoint,type SetupConnection} from './setup-service.js';

export function executable(name:string){
 for(const directory of (process.env.PATH??'').split(':').filter(Boolean)){const file=resolve(directory,name);try{accessSync(file,constants.X_OK);if(statSync(file).isFile())return file;}catch{}}
 return undefined;
}
function regular(path:string){try{return lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink();}catch{return false;}}
function folder(path:unknown):path is string {try{if(typeof path!=='string'||!statSync(path).isDirectory())return false;accessSync(path,constants.R_OK|constants.X_OK);return true;}catch{return false;}}
function savedConnection(state:string):SetupConnection|undefined{
 const file=join(state,'setup-connection.json');if(!existsSync(file))return undefined;
 if(!regular(file))throw Error('Setup connection metadata must be a regular file.');
 try{return validateConnection(JSON.parse(readFileSync(file,'utf8')));}catch{throw Error('Existing setup connection metadata is invalid; it was not replaced.');}
}
export function inspectSetup(state:string,configPath=join(homedir(),'.config/bob/cli.json')):SetupInspection{
 if(existsSync(state)&&(!lstatSync(state).isDirectory()||lstatSync(state).isSymbolicLink()))throw Error('State must be a real directory, not a symlink.');
 const database=join(state,'control.sqlite');
 if(!existsSync(database)){
  if(existsSync(state)&&readdirSync(state).length)throw Error('The selected directory is nonempty but has no Bob control database. Choose a new empty state directory.');
  return {exists:false,owned:false,managed:false,configurationReady:false};
 }
 if(!regular(database))throw Error('The control database must be a regular file.');
 let db:DatabaseSync|undefined;
 try{
  readControlFloor(state,true); // Shared read-only authority validates current and historical floors.
  db=new DatabaseSync(database,{readOnly:true});db.exec('PRAGMA busy_timeout=1000');
  const get=(key:string)=>{const row=db!.prepare('SELECT value FROM config WHERE key=?').get(key);return row?JSON.parse(String(row.value)):undefined;};
  const backendId=get('identity');setupUnitName(backendId);
  const ownership=inspectOwner(state);if(!['owned','available'].includes(ownership))throw Error('Uncertain runtime owner');
  const model=get('model'),ready=folder(get('cwd'))&&['openai','anthropic'].includes(model?.provider)&&typeof model?.modelId==='string'&&!!model.modelId&&!!(get(`providerCredential:${model.provider}`)||get(`${model.provider}Key`));
  let endpoint:string|undefined;
  if(regular(configPath)){const config=JSON.parse(readFileSync(configPath,'utf8'));if(typeof config.state==='string'&&resolve(config.state)===state&&typeof config.endpoint==='string')endpoint=config.endpoint;}
  const connection=savedConnection(state);if(connection)endpoint=connectionEndpoint(connection);
  return {exists:true,backendId,owned:ownership==='owned',managed:!!get('maintenanceHome'),configurationReady:ready,endpoint};
 }catch{throw Error('Existing Bob state/configuration could not be safely inspected. No initialization or repair was attempted. Use doctor and the matching release.');}
 finally{db?.close();}
}
export async function terminalQuestion(question:string,fallback?:string){
 const input=createInterface({input:process.stdin,output:process.stdout});
 try{const answer=(await input.question(`${question}${fallback?` [${fallback}]`:''}: `)).trim();if(!answer&&!fallback)throw Error('An answer is required; rerun setup to continue.');return answer||fallback!;}finally{input.close();}
}
export async function terminalConfirm(question:string){
 const input=createInterface({input:process.stdin,output:process.stdout});
 try{return /^(y|yes)$/i.test((await input.question(`${question} [y/N] `)).trim());}finally{input.close();}
}
export function terminalSecret(question:string):Promise<string>{
 if(!process.stdin.isTTY)throw Error('Private key entry requires a local terminal.');
 return new Promise((resolveSecret,reject)=>{
  let value='';const wasRaw=process.stdin.isRaw;process.stdout.write(question+': ');process.stdin.setRawMode(true);process.stdin.resume();
  const cleanup=()=>{process.stdin.off('data',receive);process.stdin.off('end',ended);process.stdin.setRawMode(wasRaw);process.stdin.pause();process.stdout.write('\n');};
  const ended=()=>{cleanup();reject(Error('Private entry cancelled.'));};
  const receive=(chunk:Buffer)=>{for(const ch of chunk.toString('utf8')){
   if(ch==='\u0003'||ch==='\u0004'){ended();return;}
   if(ch==='\r'||ch==='\n'){cleanup();if(!value.trim())reject(Error('No key entered.'));else resolveSecret(value.trim());return;}
   if(ch==='\u007f'||ch==='\b')value=value.slice(0,-1);else if(ch>=' '&&ch<='~')value+=ch;
   if(value.length>10000){cleanup();reject(Error('Key entry is too long.'));return;}
  }};
  process.stdin.on('data',receive);process.stdin.once('end',ended);
 });
}
function command(file:string,args:string[],inherit=false,timeout=120000){
 if(inherit)process.stdin.pause();
 const result=spawnSync(file,args,{stdio:inherit?'inherit':'pipe',encoding:'utf8',timeout,maxBuffer:1024*1024});
 if(result.error||result.status!==0)throw Error(`${file.split('/').at(-1)} did not complete successfully. No automatic retry was made; check the local terminal and rerun setup after resolving the problem.`);
 return result.stdout??'';
}
async function withOffline<T>(state:string,fn:(store:State)=>Promise<T>){
 mkdirSync(state,{recursive:true,mode:0o700});const release=acquireOwner(state);let store:State|undefined;
 try{store=new State(state);if(store.get('maintenanceHome'))throw Error('Supervisor-managed state cannot be reconfigured by setup.');return await fn(store);}finally{store?.close();release();}
}
async function installTailscale(port:SetupPort){
 if(!await port.confirm('Tailscale is missing. Download and run its official Linux installer (https://tailscale.com/install.sh)? It may request sudo and add a package repository.'))return false;
 const response=await fetch('https://tailscale.com/install.sh',{redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('The official Tailscale installer could not be downloaded.');
 const chunks:Uint8Array[]=[];let size=0;
 if(!response.body)throw Error('Empty Tailscale installer.');
 for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw Error('Unexpectedly large Tailscale installer.');chunks.push(chunk);}
 const directory=mkdtempSync(join(tmpdir(),'bob-tailscale-')),file=join(directory,'install.sh');
 try{writeFileSync(file,Buffer.concat(chunks),{mode:0o600,flag:'wx'});port.say(`Downloaded installer for local review: ${file}`);if(!await port.confirm('Run this downloaded official installer now?'))return false;command('sh',[file],true,600000);return !!executable('tailscale');}finally{rmSync(directory,{recursive:true,force:true});}
}
/** Refuse service/config disagreement before committing connection metadata. */
export function saveSetupConnection(state:string,id:string,connection:SetupConnection,unitDirectory:string,node:string,cli:string,run=command){
 const name=setupUnitName(id),unitFile=join(unitDirectory,name);
 const known=run('systemctl',['--user','list-unit-files',name,'--no-legend','--no-pager']).trim();
 const fragment=known?run('systemctl',['--user','show',name,'--property=FragmentPath','--value']).trim():'';
 if(fragment&&fragment!==unitFile)throw Error('A service with this name is managed elsewhere; connection metadata was not changed.');
 checkSetupService(unitDirectory,name,renderSetupService(node,cli,state,id,connection));
 const file=join(state,'setup-connection.json');if(existsSync(file)&&!regular(file))throw Error('Connection metadata is not a regular file.');
 const staging=mkdtempSync(join(state,'.connection-')),temporary=join(staging,'connection.json');
 try{writeFileSync(temporary,JSON.stringify(connection,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temporary,file);}finally{rmSync(staging,{recursive:true,force:true});}
}
export function nativeSetupPort(cliPath=resolve(process.argv[1])):SetupPort{
 const port:SetupPort={say:console.log,ask:terminalQuestion,confirm:terminalConfirm,inspect:async state=>inspectSetup(state),
  configure:async(state,existing)=>{
   await withOffline(state,async store=>{
    const currentCwd=store.get<string>('cwd');
    if(folder(currentCwd))port.say(`Keeping working folder: ${currentCwd}`);
    else{const cwd=resolve(await port.ask('Existing working folder',process.cwd()));if(!folder(cwd))throw Error('Working folder must exist and be readable.');store.set('cwd',cwd);}
    const old=store.get<{provider:string;modelId:string}>('model');
    if(old&&['openai','anthropic'].includes(old.provider)&&hasProviderCredential(store,old.provider)){port.say('Keeping existing provider credentials and model.');return;}
    port.say('Authentication: 1 = OpenAI API key; 2 = Bob-owned ChatGPT browser login; 3 = Anthropic API key. Keys are entered privately here, never imported from another app.');
    const choice=await port.ask('Choose 1, 2 or 3');if(!['1','2','3'].includes(choice))throw Error('Unsupported authentication choice.');
    const provider=choice==='3'?'anthropic':'openai';
    const model=await port.ask('Exact model ID available to your account',old?.provider===provider?old.modelId:undefined);
    if(!createBackendModels(store).getModel(provider,model))throw Error('Unknown model ID in this Bob release. Configuration is incomplete; no provider request was made.');
    if(hasProviderCredential(store,provider)){store.set('model',{provider,modelId:model});port.say('Reusing this provider’s existing Bob credentials.');}
    else if(choice==='2'){command(process.execPath,[cliPath,'--state',state,'login','--provider','openai','--model',model],true,330000);}
    else{const key=await terminalSecret(`${provider} API key (input hidden)`);await setProviderKey(store,provider,key);store.set('model',{provider,modelId:model});}
   });
   const browser=executable('chromium')??executable('chromium-browser');
   if(browser){port.say(`Chromium found: ${browser}`);await withOffline(state,async store=>{if(!store.get('browserExecutable'))store.set('browserExecutable',browser);});}
   else{
    port.say('Chromium is optional: chat works without it, but browser tools need it.');
    const manager=executable('apt-get')?'apt-get':executable('dnf')?'dnf':executable('pacman')?'pacman':undefined;
    if(manager&&await port.confirm(`Install Chromium using sudo ${manager}?`)){
     const args=manager==='apt-get'?['apt-get','install','chromium']:manager==='dnf'?['dnf','install','chromium']:['pacman','-S','--needed','chromium'];
     command('sudo',args,true,600000);const found=executable('chromium')??executable('chromium-browser');if(!found)throw Error('No Chromium executable was found after installation. Configure it manually; backend configuration was kept.');
     await withOffline(state,async store=>store.set('browserExecutable',found));
    }
   }
   return inspectSetup(state);
  },
  prepareNetwork:async(state,inspection)=>{
   if(!executable('tailscale')&&!await installTailscale(port))return undefined;
   let status:any;try{status=JSON.parse(command('tailscale',['status','--json']));}catch{status={};}
   if(status.BackendState!=='Running'){
    if(!await port.confirm('Tailscale is not connected. Run sudo tailscale up and complete its login? Existing routing/security options will not be reset.'))return undefined;
    command('sudo',['tailscale','up'],true,600000);status=JSON.parse(command('tailscale',['status','--json']));
   }
   if(status.BackendState!=='Running')throw Error('Tailscale is not connected.');
   const host=(status.Self?.TailscaleIPs??[]).find((ip:unknown)=>typeof ip==='string'&&ip.startsWith('100.'));
   const hostname=String(status.Self?.DNSName??'').replace(/\.$/,'');
   const saved=savedConnection(state),tlsDir=join(homedir(),'.local/share/bob-tls',inspection.backendId!);
   const connection=validateConnection({host,hostname,port:Number(await port.ask('HTTPS port',String(saved?.port??49158))),cert:resolve(await port.ask('TLS certificate file',saved?.cert??join(tlsDir,'cert.pem'))),key:resolve(await port.ask('TLS private-key file',saved?.key??join(tlsDir,'key.pem')))});
   port.say(`Tailscale listener: ${connection.host}\nHTTPS: ${connectionEndpoint(connection)}`);
   if(!existsSync(connection.cert)||!existsSync(connection.key)){
    if(existsSync(connection.cert)||existsSync(connection.key))throw Error('Only one TLS file exists; setup will not overwrite it. Provide a matching pair.');
    if(connection.cert!==join(tlsDir,'cert.pem')||connection.key!==join(tlsDir,'key.pem'))throw Error('Automatic TLS provisioning uses the suggested private Bob paths only. Supply existing files for custom paths.');
    if(!await port.confirm('Obtain a public HTTPS certificate through sudo tailscale cert? HTTPS must be enabled in your tailnet; the machine name is recorded in public Certificate Transparency logs.'))return undefined;
    mkdirSync(tlsDir,{recursive:true,mode:0o700});if(lstatSync(tlsDir).isSymbolicLink())throw Error('TLS directory cannot be a symlink.');
    const staging=mkdtempSync(join(tlsDir,'.new-'));const cert=join(staging,'cert.pem'),key=join(staging,'key.pem');
    try{
     command('sudo',['tailscale','cert','--cert-file',cert,'--key-file',key,hostname],true);
     command('sudo',['chown',`${process.getuid!()}:${process.getgid!()}`,cert,key],true);chmodSync(key,0o600);
     verifyCertificate({...connection,cert,key});
     writeFileSync(connection.cert,readFileSync(cert),{flag:'wx',mode:0o600});writeFileSync(connection.key,readFileSync(key),{flag:'wx',mode:0o600});
    }finally{rmSync(staging,{recursive:true,force:true});}
   }
   verifyCertificate(connection);
   if(!await port.confirm('Save these HTTPS paths for this backend? No private-key contents are copied into Bob configuration.'))return undefined;
   await withOffline(state,async()=>saveSetupConnection(state,inspection.backendId!,connection,join(homedir(),'.config/systemd/user'),process.execPath,cliPath));
   port.say('Certificate files are not automatically renewed by this installer. Renew them with Tailscale before expiry and restart this standalone service explicitly; see INSTALL.md.');
   return connectionEndpoint(connection);
  },
  startService:async(state,inspection,endpoint)=>{
   command('systemctl',['--user','show-environment']);
   const connection=savedConnection(state);if(!connection||connectionEndpoint(connection)!==endpoint)throw Error('Saved connection does not match the selected endpoint.');
   const name=setupUnitName(inspection.backendId!),directory=join(homedir(),'.config/systemd/user'),file=join(directory,name);
   port.say(`User service: ${name}\nExecutable: ${process.execPath}\nCLI: ${cliPath}\nState: ${state}`);
   if(!await port.confirm('Install/reuse this backend’s user service, enable it at login, and start it now?'))return false;
   const known=command('systemctl',['--user','list-unit-files',name,'--no-legend','--no-pager']).trim();
   const fragment=known?command('systemctl',['--user','show',name,'--property=FragmentPath','--value']).trim():'';
   if(fragment&&fragment!==file)throw Error('A service with this name is managed elsewhere; it was not changed.');
   await withOffline(state,async()=>installSetupService(directory,name,renderSetupService(process.execPath,cliPath,state,inspection.backendId!,connection)));
   command('systemctl',['--user','daemon-reload']);command('systemctl',['--user','enable','--now',name],true);
   if(await port.confirm('Also keep this user service running after logout and start it before login? This enables user lingering with sudo.'))command('sudo',['loginctl','enable-linger',userInfo().username],true);
   port.say(`Manage this standalone service with: systemctl --user status ${name}\nIt is not the optional Bob self-update supervisor. Existing supervisor-managed installations are never converted.`);
   return true;
  },
  verify:async(endpoint,id)=>{
   // Read-only, bounded startup probes, never retries a mutation.
   let last:unknown;for(let attempt=0;attempt<5;attempt++){try{await verifySetupEndpoint(endpoint,id);return;}catch(error){last=error;if(attempt<4)await new Promise(resolveWait=>setTimeout(resolveWait,1000));}}
   throw last;
  },
  pair:async(state,endpoint)=>{command(process.execPath,[cliPath,'--state',state,'connect','--endpoint',endpoint],true);},
 };
 return port;
}
export async function setupOnTerminal(state:string){
 if(process.platform!=='linux'||process.arch!=='x64')throw Error('Guided installation currently supports Linux x86_64 only.');
 if(process.getuid?.()===0)throw Error('Run Bob setup as the intended non-root backend account; privileged steps ask for sudo separately.');
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Guided setup needs an interactive local terminal. Legacy setup --cwd and doctor remain available for scripts.');
 const [major,minor,patch]=process.versions.node.split('.').map(Number);if(major!==24||minor<22||minor===22&&patch<1)throw Error('Use Node >=24.22.1 <25, or run install.sh to provision a private compatible runtime.');
 return guidedSetup(state,nativeSetupPort());
}
