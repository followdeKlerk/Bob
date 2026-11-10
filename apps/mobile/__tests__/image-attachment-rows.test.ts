import {imageAttachmentRows as project,type ImageAttachmentRow} from '../image-attachment-rows';
import {replyOutputPlacement,replyOutputRows,type ReplyEntry} from '../chat-replies';
const imageAttachmentRows=(entries:readonly ReplyEntry[],raw:readonly ReplyEntry[],files:Map<number,readonly ReplyEntry[]>,windows:readonly (readonly ReplyEntry[])[]=[raw],previous?:readonly ImageAttachmentRow[])=>project(entries,raw,files,windows,previous);
const image=(id:number,kind='bob.artifact',conversationId=7):ReplyEntry=>({id,kind,data:{id:`a841d08a-8b83-42cd-b8a7-${String(id).padStart(12,'0')}`,conversationId,name:`image-${id}.png`,mime:'image/png',size:20,sha256:'a'.repeat(64)}});
const text=(id:number):ReplyEntry=>({id,kind:'bob.user',data:{text:'Message boundary'}});
const file=(id:number,kind='bob.artifact'):ReplyEntry=>({...image(id,kind),data:{...image(id).data as object,name:'report.pdf',mime:'application/pdf'}});
const ids=(rows:ReturnType<typeof imageAttachmentRows>)=>rows.map(row=>[row.id,row.imageAttachments?.map(item=>item.name)]);
test('consecutive owner images become one stable row without changing source history',()=>{
 const entries=[image(1),image(2),image(3),text(4)],before=JSON.stringify(entries);
 const rows=imageAttachmentRows(entries,entries,new Map());
 expect(ids(rows)).toEqual([[1,['image-1.png','image-2.png','image-3.png']],[4,undefined]]);
 expect(JSON.stringify(entries)).toBe(before);expect(rows[1]).toBe(entries[3]);
 expect(imageAttachmentRows(entries,entries,new Map())[0]).toBe(rows[0]);
 const more=[...entries,text(5)];expect(imageAttachmentRows(more,more,new Map())[0]).toBe(rows[0]);
});
test('owner text, non-images, ownership, conversations and unknown/malformed rows are boundaries',()=>{
 for(const barrier of [text(2),file(2),image(2,'bob.file'),image(2,'bob.artifact',8),{id:2,kind:'bob.artifact',data:{name:'broken.png'}}]){
  const entries=[image(1),barrier,image(3)];expect(imageAttachmentRows(entries,entries,new Map())).toHaveLength(3);
 }
});
test('hidden original-history events still separate uploads even when filtered from display',()=>{
 const a=image(1),b=image(3),raw=[a,{id:2,kind:'pi.tool-result'},b];
 expect(imageAttachmentRows([a,b],raw,new Map())).toHaveLength(2);
});
test('generated images group beneath their proven answer without moving an intervening player or visual',()=>{
 const a=image(2,'bob.file'),b=image(3,'bob.file');
 const final:ReplyEntry={id:5,kind:'pi.assistant',mobileReply:{version:1,first:1,answer:5},model:[{role:'assistant',content:'Your images'}]};
 const raw=[text(1),a,b,final],files=replyOutputPlacement(raw,new Map()).files;
 const moved=replyOutputRows(raw,files),rows=imageAttachmentRows(moved,raw,files);
 expect(rows.map(item=>item.id)).toEqual([1,5,2]);expect(rows[2].imageAttachments).toHaveLength(2);
 const media=file(4,'bob.file');
 expect(imageAttachmentRows([final,a,media,b],raw,new Map([[5,[a,media,b]]])).map(item=>item.id)).toEqual([5,2,4,3]);
 const surface:ReplyEntry={id:-100,kind:'bob.inline-surface',inlineSurfaceId:'visual'};
 expect(imageAttachmentRows([final,a,surface,b],raw,files).find(item=>item===surface)).toBe(surface);
 expect(imageAttachmentRows([final,a,surface,b],raw,files)).toHaveLength(4);
});
test('unknown, conflicting or different generated answer ownership cannot create a deck',()=>{
 const entries=[image(1,'bob.file'),image(2,'bob.file')];
 for(const files of [new Map(),new Map([[5,[entries[0]]],[6,[entries[1]]]]),new Map([[5,entries],[6,[entries[1]]]])])expect(imageAttachmentRows(entries,entries,files)).toHaveLength(2);
});
test('duplicates are not silently swallowed and non-image injected projection fields are ignored',()=>{
 const a=image(1),duplicate={...a,id:2};expect(imageAttachmentRows([a,duplicate],[a,duplicate],new Map())).toHaveLength(2);
 const forged={...text(3),imageAttachments:[a.data]};expect(imageAttachmentRows([forged],[forged],new Map())[0]).not.toHaveProperty('imageAttachments');
});
test('appended images retain the original row key and metadata order, while single images use the same projection',()=>{
 const a=image(1),b=image(2),first=imageAttachmentRows([a],[a],new Map())[0],next=imageAttachmentRows([a,b],[a,b],new Map())[0];
 expect(next.id).toBe(first.id);expect(first.imageAttachments).toHaveLength(1);expect(next.imageAttachments?.map(item=>item.id)).toEqual([a.data,b.data].map((item:any)=>item.id));
 expect(first.imageAttachments).toHaveLength(1);
});

test('disjoint cached history and snapshot windows never bridge an unloaded middle',()=>{
 for(const kind of ['bob.artifact','bob.file']){
  const a=image(10,kind),b=image(1000,kind),files=new Map([[1001,[a,b]]]);
  expect(imageAttachmentRows([a,b],[a,b],files,[[a],[b]])).toHaveLength(2);
  expect(imageAttachmentRows([a,b],[a,b],files,[[a,b]])).toHaveLength(1);
 }
 const a=image(10),b=image(200),c=image(1000);
 expect(imageAttachmentRows([a,b,c],[a,b,c],new Map(),[[a,b],[b,c]])[0].imageAttachments).toHaveLength(3);
});
test('backward pagination retains an already displayed deck anchor while preserving image order',()=>{
 const a=image(1),b=image(2),c=image(3),prior=imageAttachmentRows([b,c],[b,c],new Map());
 const next=imageAttachmentRows([a,b,c],[a,b,c],new Map(),[[a,b,c]],prior);
 expect(next).toHaveLength(1);expect(next[0].id).toBe(2);expect(next[0].imageAttachments?.map(item=>item.name)).toEqual(['image-1.png','image-2.png','image-3.png']);
});
