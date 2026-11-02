import {createPrivateKey,createPublicKey,X509Certificate} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join} from 'node:path';
import {request,type RequestOptions} from 'node:https';

export type SetupConnection={host:string;hostname:string;port:number;cert:string;key:string};
export function validateConnection(value:SetupConnection){
 const octets=value.host.split('.').map(Number);
 if(!/^100\.(?:\d{1,3}\.)\d{1,3}\.\d{1,3}$/.test(value.host)||octets.length!==4||octets[1]<64||octets[1]>127||octets.some(n=>n>255)||octets.map(String).join('.')!==value.host)throw Error('Use a literal Tailscale IPv4 address (100.64.0.0/10).');
 if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+ts\.net$/i.test(value.hostname)||value.hostname.length>253)throw Error('Use the machine’s Tailscale HTTPS hostname.');
 if(!Number.isInteger(value.port)||value.port<1024||value.port>65535)throw Error('Choose an unprivileged port between 1024 and 65535.');
 for(const path of [value.cert,value.key])if(!isAbsolute(path)||/[\x00-\x1f\x7f]/.test(path))throw Error('Certificate paths must be absolute and contain no control characters.');
 return value;
}
export function connectionEndpoint(value:SetupConnection){validateConnection(value);return `https://${value.hostname}:${value.port}`;}
export function validateEndpoint(value:string){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||! /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+ts\.net$/i.test(url.hostname))throw Error('Enter only a Tailscale HTTPS origin, e.g. https://machine.tailnet.ts.net:49158.');
 return url.origin;
}
export function verifyCertificate(connection:SetupConnection,uid=process.getuid?.()){
 validateConnection(connection);
 for(const path of [connection.cert,connection.key])if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw Error('TLS files must be regular files, not symlinks.');
 const keyStat=lstatSync(connection.key);
 if(uid!==undefined&&keyStat.uid!==uid||(keyStat.mode&0o077)!==0)throw Error('The TLS key must belong to this account and have owner-only permissions (chmod 600).');
 const cert=new X509Certificate(readFileSync(connection.cert));
 if(!cert.checkHost(connection.hostname)||Date.parse(cert.validFrom)>Date.now()||Date.parse(cert.validTo)<=Date.now())throw Error('The TLS certificate is expired, not yet valid, or belongs to another host. Renew/provision it before continuing.');
 const key=createPrivateKey(readFileSync(connection.key));
 if(!cert.publicKey.export({format:'der',type:'spki'}).equals(createPublicKey(key).export({format:'der',type:'spki'})))throw Error('TLS certificate and key do not match.');
}
export function systemdQuote(value:string){
 if(!value||/[\x00-\x1f\x7f]/.test(value))throw Error('Service arguments cannot be empty or contain control characters.');
 return '"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').replaceAll('$',()=> '$$')+'"';
}
export function setupUnitName(id:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw Error('Invalid backend identity.');return `bob-${id}.service`;}
export function renderSetupService(node:string,cli:string,state:string,id:string,connection:SetupConnection){
 validateConnection(connection);setupUnitName(id);
 for(const path of [node,cli,state])if(!isAbsolute(path))throw Error('Service executable and state paths must be absolute.');
 const args=[node,cli,'--state',state,'serve','--host',connection.host,'--port',String(connection.port),'--cert',connection.cert,'--key',connection.key];
 return `[Unit]\nDescription=Bob backend ${id}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUMask=0077\nExecStart=${args.map(systemdQuote).join(' ')}\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`;
}
/** Never replace a manually managed service or follow a unit-file symlink. */
export function checkSetupService(directory:string,name:string,content:string){
 if(!/^bob-[a-f0-9-]{36}\.service$/.test(name))throw Error('Invalid unit name.');
 const file=join(directory,name);
 if(existsSync(file)||(()=>{try{return lstatSync(file).isSymbolicLink();}catch{return false;}})()){
  if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()||readFileSync(file,'utf8')!==content)throw Error('An existing service differs; it was not overwritten. Use its existing maintenance procedure.');
  return {file,exists:true};
 }
 return {file,exists:false};
}
export function installSetupService(directory:string,name:string,content:string){
 const {file,exists}=checkSetupService(directory,name,content);if(exists)return {file,created:false};
 mkdirSync(dirname(file),{recursive:true,mode:0o700});writeFileSync(file,content,{flag:'wx',mode:0o600});return {file,created:true};
}
/** An impossible invitation probes Bob identity without creating a device grant.
 * Generated invitations use base64url, so this value can never redeem one. */
export function verifySetupEndpoint(endpoint:string,id:string,trust?:Pick<RequestOptions,'ca'|'lookup'>):Promise<void>{
 const origin=validateEndpoint(endpoint);setupUnitName(id);
 const body=JSON.stringify({backendId:id,invitation:'!'.repeat(43),name:'Setup readiness check'});
 return new Promise((resolve,reject)=>{
  const fail=()=>reject(Error('Could not verify this backend over trusted HTTPS. Check its service, Tailscale DNS, certificate and port; pairing was not issued.'));
  const req=request(new URL('/v1/pair',origin),{...trust,method:'POST',rejectUnauthorized:true,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)},signal:AbortSignal.timeout(8000)},res=>{
   let data='';res.setEncoding('utf8');res.on('data',chunk=>{data+=chunk;if(data.length>4096){res.destroy();fail();}});res.on('error',fail);
   res.on('end',()=>{try{if(res.statusCode===401&&JSON.parse(data).error==='Invalid or expired invitation'){resolve();return;}}catch{}fail();});
  });req.on('error',fail);req.end(body);
 });
}
