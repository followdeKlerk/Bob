import {MenuReadCache} from '../menu-read-cache';
const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
test('cached reopen and simultaneous readers issue one request, then expire deliberately',async()=>{
 let time=0;const cache=new MenuReadCache(()=>time),pending=deferred<object>(),read=jest.fn(()=>pending.promise);
 const one=cache.read('backend:endpoint:revision','library',read),two=cache.read('backend:endpoint:revision','library',read);
 expect(one).toBe(two);await Promise.resolve();expect(read).toHaveBeenCalledTimes(1);
 const value={instructions:'Synthetic',skills:{}};pending.resolve(value);expect(await one).toBe(value);
 expect(cache.peek('backend:endpoint:revision','library')).toBe(value);
 expect(await cache.read('backend:endpoint:revision','library',read)).toBe(value);expect(read).toHaveBeenCalledTimes(1);
 time=30000;expect(cache.peek('backend:endpoint:revision','library')).toBeUndefined();await cache.read('backend:endpoint:revision','library',read);expect(read).toHaveBeenCalledTimes(2);
});
test('backend, endpoint, pairing revision and resource are isolated, entries bounded',async()=>{
 const cache=new MenuReadCache(Date.now,2),read=jest.fn(async()=>({}));
 for(const scope of ['A:endpoint:0','B:endpoint:0','A:new-endpoint:0','A:new-endpoint:1'])await cache.read(scope,'models',read);
 expect(read).toHaveBeenCalledTimes(4);expect(cache.peek('A:endpoint:0','models')).toBeUndefined();
 await cache.read('A:new-endpoint:1','library',read);expect(read).toHaveBeenCalledTimes(5);expect(cache.peek('B:endpoint:0','models')).toBeUndefined();
});
test('mutation invalidates completed and in-flight reads, including reads during uncertain writes',async()=>{
 const cache=new MenuReadCache(),old=deferred<string>(),load=jest.fn(async()=>'fresh');
 const stale=cache.read('A','library',()=>old.promise);await Promise.resolve();
 const settle=cache.beginMutation('A','library');old.resolve('stale');await stale;expect(cache.peek('A','library')).toBeUndefined();
 expect(await cache.read('A','library',load)).toBe('fresh');expect(cache.peek('A','library')).toBeUndefined();
 settle();await cache.read('A','library',load);expect(load).toHaveBeenCalledTimes(2);
 const finish=cache.beginMutation('A','library');expect(cache.peek('A','library')).toBeUndefined();finish();
 await cache.read('A','library',load);expect(load).toHaveBeenCalledTimes(3);
});
test('offline errors are not cached; explicit refresh supersedes an older read without poisoning retry',async()=>{
 const cache=new MenuReadCache(),old=deferred<string>(),read=jest.fn(async()=>'retried');
 await expect(cache.read('A','library',async()=>{throw Error('offline');})).rejects.toThrow('offline');
 const stale=cache.read('A','library',()=>old.promise);await Promise.resolve();cache.invalidate('A','library');
 expect(await cache.read('A','library',read)).toBe('retried');old.resolve('obsolete');await stale;
 expect(cache.peek('A','library')).toBe('retried');expect(read).toHaveBeenCalledTimes(1);
});
