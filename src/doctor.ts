import {DatabaseSync} from 'node:sqlite';
import {accessSync,constants,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {inspectOwner} from './ownership.js';
import {releaseVersion} from './update.js';

type Check={id:string;status:'ok'|'warning'|'error';message:string};
/** Local inspection only: never initialize state, migrate, launch a runtime or call a provider. */
export function diagnose(directory:string){
 const checks:Check[]=[];
 const add=(id:string,status:Check['status'],message:string)=>checks.push({id,status,message});
 const base={state:directory,node:process.version,releaseVersion,platform:process.platform,arch:process.arch,durable:'1.4.0'};
 const finish=(details:Record<string,unknown>={})=>({...base,...details,status:checks.some(c=>c.status==='error')?'error':checks.some(c=>c.status==='warning')?'warning':'ok',checks,limits:'Local configuration checks only. Does not verify inference, browser launch, service readiness, TLS, phone connectivity or optional integrations.'});
 const [major,minor,patch]=process.versions.node.split('.').map(Number);
 add('node',major===24&&(minor>22||minor===22&&patch>=1)?'ok':'error','Requires Node >=24.22.1 <25.');
 add('platform',process.platform==='linux'&&process.arch==='x64'?'ok':'warning','Supported host: Linux x86_64.');
 if(!existsSync(join(directory,'control.sqlite'))){add('state','error','No existing control database. Check --state; use setup explicitly for a new backend.');return finish();}
 let db:DatabaseSync|undefined;
 try{
  db=new DatabaseSync(join(directory,'control.sqlite'),{readOnly:true});
  db.exec('PRAGMA busy_timeout=1000');
  const get=<T>(key:string):T|undefined=>{const row=db!.prepare('SELECT value FROM config WHERE key=?').get(key);return row?JSON.parse(String(row.value)):undefined;};
  const schema=Number(db.prepare('PRAGMA user_version').get()?.user_version)||1;
  add('schema',[1,2].includes(schema)?'ok':'error','Control schema must be supported; doctor never migrates it.');
  const backendId=get<string>('identity');
  add('identity',typeof backendId==='string'&&!!backendId?'ok':'error','Existing backend identity required.');
  const model=get<{provider:string;modelId:string}>('model');
  // Never include raw stored credential values or arbitrary model configuration in the report.
  const modelValid=!!model&&typeof model.provider==='string'&&typeof model.modelId==='string'&&!!model.modelId;
  const credentials={openai:!!get('providerCredential:openai')||!!get('openaiKey'),anthropic:!!get('providerCredential:anthropic')||!!get('anthropicKey')};
  const selected=modelValid&&(model.provider==='openai'||model.provider==='anthropic')?credentials[model.provider]:false;
  add('model',modelValid?'ok':'error','Configure a provider and exact model with provider or login; catalog availability is not tested.');
  add('credentials',selected?'ok':'error','Selected provider needs stored credentials; presence does not prove validity.');
  const cwd=get<string>('cwd');let cwdAccessible=false;
  try{if(typeof cwd==='string'&&statSync(cwd).isDirectory()){accessSync(cwd,constants.R_OK|constants.X_OK);cwdAccessible=true;}}catch{}
  add('working-directory',cwdAccessible?'ok':'error','Default working folder must exist and be readable/searchable; configure it with setup --cwd.');
  const configuredBrowser=get<unknown>('browserExecutable');
  const executable=typeof configuredBrowser==='string'?configuredBrowser:'/usr/bin/chromium';
  let executablePresent=false;try{accessSync(executable,constants.X_OK);executablePresent=statSync(executable).isFile();}catch{}
  add('browser',executablePresent?'ok':'warning','Optional web browser needs executable Chromium; no browser is launched.');
  const ownership=inspectOwner(directory);
  add('ownership',ownership==='available'||ownership==='owned'?'ok':'warning',ownership==='owned'?'State is owned, as expected for a running backend; this is not a readiness check.':ownership==='available'?'No runtime owns this state; this is normal for an offline backend.':'Owner status needs manual investigation; doctor never removes locks.');
  return finish({backendId,controlSchema:schema,ownership,model:modelValid?{provider:model!.provider,modelId:model!.modelId}:undefined,providerCredentialPresent:selected,providerCredentials:credentials,browser:{executable,present:existsSync(executable),executablePresent,note:'Presence is not a successful launch test.'},service:backendId?`bob-${backendId}.service`:undefined});
 }catch{
  add('state','error','Cannot inspect control database/configuration. Check permissions, database format and the matching Bob release; no repair attempted.');return finish();
 }finally{db?.close();}
}
