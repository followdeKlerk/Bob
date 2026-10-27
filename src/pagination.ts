import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {Cursor} from '@earendil-works/pi-durable';
import {z} from 'zod';
import type {State} from './state.js';
import {HttpError} from './errors.js';
const Envelope=z.object({backendId:z.string().uuid(),resource:z.string(),cursor:z.record(z.string(),z.json())}).strict();
function key(state:State){let value=state.get<string>('paginationKey');if(!value){value=randomBytes(32).toString('hex');state.set('paginationKey',value);}return value;}
export function encodeCursor(state:State,resource:string,cursor:Cursor|undefined){
 if(!cursor)return undefined;
 const payload=Buffer.from(JSON.stringify({backendId:state.id,resource,cursor})).toString('base64url');
 return payload+'.'+createHmac('sha256',key(state)).update(payload).digest('base64url');
}
export function decodeCursor(state:State,resource:string,token:string|null|undefined):Cursor|undefined {
 if(!token)return undefined;
 try {
  if(token.length>4096)throw Error('length');
  const parts=token.split('.');if(parts.length!==2)throw Error('format');
  const expected=createHmac('sha256',key(state)).update(parts[0]).digest(),actual=Buffer.from(parts[1],'base64url');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error('signature');
  const envelope=Envelope.parse(JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8')));
  if(envelope.backendId!==state.id||envelope.resource!==resource)throw Error('scope');
  return envelope.cursor;
 }catch{throw new HttpError(400,'Invalid or wrong-scope pagination cursor');}
}
