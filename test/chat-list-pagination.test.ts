import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

// Execute the endpoint's actual transaction callback with a bounded native-scan
// adapter. This isolates pagination without creating thousands of real chats.
const source=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
const callback=source.split('let cursor=requested;const visible=[];')[1]?.split('},ctx);')[0];
assert.ok(callback,'chat-list callback must be present');
const page=new (Object.getPrototypeOf(async function(){}).constructor)('requested','tx','runtime','let cursor=requested;const visible=[];'+callback);
type Row={id:number;owner?:{kind:string}};
async function traverse(rows:Row[]){
 const ids:number[]=[],sizes:number[]=[];let cursor:unknown;
 do{
  let scans=0;
  const result=await page(cursor,{scanConversations:async(order:unknown,limit:number,offset=0)=>{
   assert.deepEqual(order,{order:'descending'});assert.ok(limit>0&&limit<=100);assert.ok(++scans<=10);
   const items=rows.slice(offset,offset+limit);return {items,next:offset+items.length<rows.length?offset+items.length:undefined};
  }},{library:{id:1}});
  sizes.push(result.items.length);assert.ok(result.items.length<=100);ids.push(...result.items.map((row:Row)=>row.id));
  if(result.next!==undefined)assert.notEqual(result.next,cursor,'each bounded page must advance');
  cursor=result.next;
 }while(cursor!==undefined);
 assert.deepEqual(ids,rows.filter(row=>row.id!==1&&row.owner===undefined).map(row=>row.id));
 assert.equal(new Set(ids).size,ids.length);return sizes;
}
test('chat pagination preserves every eligible row when a second raw batch exceeds remaining capacity',async()=>{
 for(const total of [200,241])await traverse(Array.from({length:total},(_,i)=>({id:total+1-i,...(i===0?{owner:{kind:'task'}}:{})})));
});
test('bounded sparse and empty filtered chat pages retain continuation and exclude the library',async()=>{
 const child=(id:number):Row=>({id,owner:{kind:'task'}});
 const rows=[...Array.from({length:1001},(_,i)=>child(2000-i)),...Array.from({length:99},(_,i)=>({id:900-i})),...Array.from({length:20},(_,i)=>child(800-i)),{id:2},{id:1}];
 const sizes=await traverse(rows);assert.equal(sizes[0],0);assert.ok(sizes.includes(99));
});
