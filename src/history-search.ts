import type {ConversationId,EntryRecord} from '@earendil-works/pi-durable';
import {ChatMeta} from './documents.js';
import type {State} from './state.js';
import type {Runtime} from './runtime.js';
import {ctx} from './runtime.js';

const MAX_QUERY=160,MAX_RESULTS=8,SCAN_PAGES=4,SCAN_SIZE=50,MAX_ENTRIES=30,MAX_SNIPPET=240;
type Match={id:number;title:string;timestamp:number;score:number;kind:string;snippet:string;role:string};
const textFrom=(value:unknown):string=>{
 if(typeof value==='string')return value;
 if(Array.isArray(value))return value.map(textFrom).join(' ');
 if(value&&typeof value==='object'){
  const o=value as Record<string,unknown>;
  if(typeof o.text==='string')return o.text;
  if(typeof o.content==='string'||Array.isArray(o.content))return textFrom(o.content);
 }
 return '';
};
function terms(q:string){return q.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>1).slice(0,12);}
function excerpt(text:string,queryTerms:string[]){
 const clean=text.replace(/\s+/g,' ').trim();if(clean.length<=MAX_SNIPPET)return clean.slice(0,MAX_SNIPPET);
 const lower=clean.toLocaleLowerCase();let at=-1;for(const term of queryTerms){at=lower.indexOf(term);if(at>=0)break;}
 if(at<0)return clean.slice(0,MAX_SNIPPET-1)+'…';
 const start=Math.max(0,at-85),end=Math.min(clean.length,start+MAX_SNIPPET);
 return ((start?'…':'')+clean.slice(start,end)+(end<clean.length?'…':'')).slice(0,MAX_SNIPPET);
}
function entryTexts(entry:EntryRecord){
 const record=entry as EntryRecord&{model?:Array<{role?:string;content?:unknown}>;data?:unknown};
 const result:string[]=[];
 for(const m of record.model??[])if(m.role==='user'||m.role==='assistant'){
  const t=textFrom(m.content);if(t.trim())result.push(t);
 }
 if(entry.kind==='bob.user'&&record.data&&typeof record.data==='object'){
  const t=textFrom((record.data as Record<string,unknown>).text);if(t.trim())result.push(t);
 }
 return result;
}
function score(text:string,queryTerms:string[]){
 const lower=text.toLocaleLowerCase();let hits=0;
 for(const term of queryTerms)if(lower.includes(term))hits++;
 return hits/queryTerms.length;
}
export async function searchHistory(runtime:Runtime,_state:State,input:{query?:string;limit?:number;conversationId?:number}){
 if(!input.query?.trim())throw new Error('Provide a short search query. Empty searches are not allowed.');
 const query=input.query.trim().slice(0,MAX_QUERY),qterms=terms(query);
 if(!qterms.length)throw new Error('Enter a search phrase with at least two letters or digits.');
 const limit=Math.min(input.limit??5,MAX_RESULTS),latest=new Map<number,Match>();
 let cursor:import('@earendil-works/pi-durable').Cursor|undefined;
 for(let pageNo=0;pageNo<SCAN_PAGES;pageNo++){
  const page=await runtime.harness.commit(tx=>tx.scanConversations({order:'descending'},SCAN_SIZE,cursor),ctx);
  for(const c of page.items){
   if(c.id===runtime.library.id||(input.conversationId!==undefined&&Number(c.id)!==input.conversationId))continue;
   const [meta,chat]=await Promise.all([runtime.harness.snapshot(ChatMeta,c.id,ctx),runtime.harness.conversation(c.id,ctx)]);
   if(!chat)continue;
   const entries=await chat.entries({order:'descending'},MAX_ENTRIES,undefined,ctx);
   let best:Match|undefined;
   for(const entry of entries.items as EntryRecord[]){
    for(const text of entryTexts(entry)){
     const s=score(text,qterms);if(s<=0)continue;
     const candidate:Match={id:Number(c.id),title:String(meta?.title??'Conversation'),timestamp:Number((entry as any).timestamp??0),score:s,kind:entry.kind,snippet:excerpt(text,qterms),role:entry.kind==='bob.user'?'user':'message'};
     if(!best||candidate.score>best.score||candidate.timestamp>best.timestamp)best=candidate;
    }
   }
   const title=String(meta?.title??'Conversation'),titleScore=score(title,qterms);
   if(titleScore>0&&(!best||titleScore>best.score))best={id:Number(c.id),title,timestamp:best?.timestamp??0,score:titleScore,kind:'title',snippet:excerpt(title,qterms),role:'title'};
   if(best)latest.set(best.id,best);
  }
  cursor=page.next;if(!cursor)break;
 }
 const results=[...latest.values()].sort((a,b)=>b.score-a.score||b.timestamp-a.timestamp||b.id-a.id).slice(0,limit);
 return {mode:'bounded-discovery',query,results,scannedConversationLimit:SCAN_PAGES*SCAN_SIZE,entriesPerConversationLimit:MAX_ENTRIES,limit,moreMayExist:!!cursor,detail:'Snippets only; call conversation_history with mode="page", a matching conversationId, and a narrow query to inspect committed history.'};
}
