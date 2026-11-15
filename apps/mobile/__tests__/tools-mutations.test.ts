import {ToolsMutationOwner,toolsMutationOwner} from '../tools-mutations';
const deferred=()=>{let resolve!:(value:unknown)=>void,reject!:(error:Error)=>void;const promise=new Promise<unknown>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test.each(['resolve','reject'] as const)('raw %s settles ownership but only a subsequent read reconciles it',async outcome=>{
 const owner=new ToolsMutationOwner(),raw=deferred(),reservation=owner.reserve(0)!;
 const write=owner.send(reservation,()=>raw.promise);const caught=write.catch(()=>undefined),pendingRead=owner.beginRead();
 expect(owner.reserve(1)).toBeUndefined();expect(owner.acceptRead(pendingRead)).toBe(false);
 if(outcome==='resolve')raw.resolve({});else raw.reject(Error('Transport timeout; remote outcome unknown'));
 await caught;expect(owner.getSnapshot().phase).toBe('reconcile');expect(owner.acceptRead(pendingRead)).toBe(false);expect(owner.reserve(1)).toBeUndefined();
 const fresh=owner.beginRead();expect(owner.acceptRead(fresh)).toBe(true);expect(owner.getSnapshot().phase).toBe('idle');expect(owner.reserve(1)).toBeDefined();
});
test('every read begun before a newer write is stale, even when that write has already settled',async()=>{
 const owner=new ToolsMutationOwner(),before=owner.beginRead(),first=owner.reserve(0)!;
 await owner.send(first,async()=>({}));expect(owner.acceptRead(before)).toBe(false);
 const after=owner.beginRead();expect(owner.acceptRead(after)).toBe(true);const second=owner.reserve(1)!;await owner.send(second,async()=>({}));
 expect(owner.acceptRead(after)).toBe(false);expect(owner.getSnapshot()).toEqual({phase:'reconcile',revision:2});expect(owner.acceptRead(owner.beginRead())).toBe(true);
});
test('unsent preflight can release, but cancellation never releases a sent pending write',async()=>{
 const owner=new ToolsMutationOwner(),first=owner.reserve(0)!;owner.cancel(first);expect(owner.getSnapshot().phase).toBe('idle');
 const second=owner.reserve(owner.getSnapshot().revision)!,raw=deferred(),write=owner.send(second,()=>raw.promise);owner.cancel(second);owner.cancel(first);
 expect(owner.getSnapshot().phase).toBe('pending');expect(owner.reserve(owner.getSnapshot().revision)).toBeUndefined();raw.resolve({});await write;
});
test('failed/aborted read is not acceptance; transport rejection is not proof that the remote write failed',async()=>{
 const owner=new ToolsMutationOwner(),reservation=owner.reserve(0)!;await expect(owner.send(reservation,async()=>{throw Error('Deadline');})).rejects.toThrow('Deadline');
 owner.beginRead(); // Caller never accepts an errored, malformed or aborted read.
 expect(owner.getSnapshot().phase).toBe('reconcile');expect(owner.reserve(1)).toBeUndefined();
});
test('connection admission is shared across chats but module selection and other backends are independent',()=>{
 const connection=toolsMutationOwner('owner-unit-a','connections',1);
 expect(toolsMutationOwner('owner-unit-a','connections',2)).toBe(connection);
 const module1=toolsMutationOwner('owner-unit-a','modules',1),module2=toolsMutationOwner('owner-unit-a','modules',2),other=toolsMutationOwner('owner-unit-b','connections');
 const reservation=connection.reserve(0)!;expect(module1.reserve(0)).toBeDefined();expect(module2.reserve(0)).toBeDefined();expect(other.reserve(0)).toBeDefined();connection.cancel(reservation);
});
test('unsubscribing and elapsed time do not evict unresolved process ownership',async()=>{
 jest.useFakeTimers();try{
  const owner=toolsMutationOwner('owner-retained','connections'),listener=jest.fn(),unsubscribe=owner.subscribe(listener),raw=deferred(),reservation=owner.reserve(0)!;
  const write=owner.send(reservation,()=>raw.promise);unsubscribe();jest.advanceTimersByTime(30*24*60*60*1000);
  expect(toolsMutationOwner('owner-retained','connections')).toBe(owner);expect(owner.getSnapshot().phase).toBe('pending');expect(owner.reserve(1)).toBeUndefined();expect(listener).toHaveBeenCalledTimes(2);
  raw.resolve({});await write;expect(listener).toHaveBeenCalledTimes(2);expect(owner.getSnapshot().phase).toBe('reconcile');
 }finally{jest.useRealTimers();}
});
test('subscribers observe reservation, actual settlement and ordered reconciliation',async()=>{
 const owner=new ToolsMutationOwner(),phases:string[]=[],unsubscribe=owner.subscribe(()=>phases.push(owner.getSnapshot().phase));
 await owner.send(owner.reserve(0)!,async()=>({}));owner.acceptRead(owner.beginRead());unsubscribe();
 expect(phases).toEqual(['reserved','pending','reconcile','idle']);
});
