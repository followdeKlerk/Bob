import {activateSession,EMPTY_SESSION_DECK,removeBackendSessions,sessionKey,SessionDeck,SessionTarget} from '../retained-sessions';

// Synthetic backend identities; the shared chat number is intentional.
const backendA='11111111-1111-4111-8111-111111111111';
const backendB='22222222-2222-4222-8222-222222222222';
const a:SessionTarget={backendId:backendA,chat:1};
const b:SessionTarget={backendId:backendB,chat:1};
const c:SessionTarget={backendId:backendA,chat:2};
const emptyA:SessionTarget={backendId:backendA};
const emptyB:SessionTarget={backendId:backendB};
const select=(...targets:SessionTarget[])=>targets.reduce(activateSession,EMPTY_SESSION_DECK);

function freeze(deck:SessionDeck):SessionDeck {
 deck.targets.forEach(Object.freeze);
 Object.freeze(deck.targets);
 return Object.freeze(deck);
}

test('keys distinguish the same numeric chat on different backends and empty browsers',()=>{
 expect(sessionKey(a)).toBe(`${backendA}:1`);
 expect(sessionKey(b)).not.toBe(sessionKey(a));
 expect(sessionKey(emptyA)).toBe(`${backendA}:empty`);
 expect(new Set([a,b,c,emptyA,emptyB].map(sessionKey)).size).toBe(5);
 expect(sessionKey({backendId:backendA,chat:Number.MAX_SAFE_INTEGER})).not.toBe('');
 // Extra display/connection metadata cannot influence identity.
 const renamed={...a,name:'Example workstation',alias:'Example',endpoint:'https://example.invalid'};
 expect(sessionKey(renamed)).toBe(sessionKey(a));
});

test('A → B → A keeps both mounted objects and promotes A to most recent',()=>{
 const first=freeze(select(a));
 const second=freeze(activateSession(first,b));
 const third=activateSession(second,{...a});
 expect(first.targets).toEqual([a]);
 expect(second.targets).toEqual([a,b]);
 expect(third.targets).toEqual([b,a]);
 expect(third.targets[0]).toBe(b);
 expect(third.targets[1]).toBe(a);
 expect(third.active).toBe(sessionKey(a));
 expect(second.active).toBe(sessionKey(b));
});

test('reselecting an unchanged conversation or empty browser preserves deck and target identity',()=>{
 const chats=freeze(select(a,b));
 expect(activateSession(chats,{...b})).toBe(chats);
 const browser=freeze(activateSession(chats,emptyA));
 expect(activateSession(browser,{...emptyA})).toBe(browser);
 expect(browser.targets[2]).toBe(emptyA);
});

test('a third conversation evicts only the least recently used conversation',()=>{
 const previous=freeze(select(a,b,{...a}));
 const next=activateSession(previous,c);
 expect(next.targets).toEqual([a,c]);
 expect(next.targets[0]).toBe(a);
 expect(next.active).toBe(sessionKey(c));
 expect(previous.targets).toEqual([b,a]);
});

test('empty workstation browsers never evict either retained conversation',()=>{
 const chats=freeze(select(a,b));
 const first=freeze(activateSession(chats,emptyA));
 const second=activateSession(first,emptyB);
 expect(first.targets).toEqual([a,b,emptyA]);
 expect(second.targets).toEqual([a,b,emptyB]);
 expect(second.targets[0]).toBe(a);
 expect(second.targets[1]).toBe(b);
 expect(second.targets[2]).toBe(emptyB);
 expect(second.active).toBe(sessionKey(emptyB));
 expect(select(emptyA,emptyB).targets).toEqual([emptyB]);
});

test('selecting a conversation removes the stale browser without changing conversation LRU rules',()=>{
 expect(select(a,b,emptyA,{...a}).targets).toEqual([b,a]);
 expect(select(a,b,emptyA,c).targets).toEqual([b,c]);
 expect(select(emptyA,a).targets).toEqual([a]);
});

test.each([0,-1,1.5,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1,'1',null])('rejects malformed chat %p rather than aliasing an empty browser',chat=>{
 const target={backendId:backendA,chat} as SessionTarget;
 const deck=freeze(select(a,b));
 expect(sessionKey(target)).toBe('');
 expect(activateSession(deck,target)).toBe(deck);
});

test.each(['',' ',` ${backendA}`,`${backendA}\n`,'a:b','https://example.invalid','a/b','a.b','x'.repeat(129),null,123])('rejects malformed backend identity %p without creating a session',backendId=>{
 const target={backendId,chat:1} as SessionTarget;
 expect(sessionKey(target)).toBe('');
 expect(activateSession(EMPTY_SESSION_DECK,target)).toBe(EMPTY_SESSION_DECK);
});

test('missing targets are rejected defensively and an explicit undefined chat is an empty browser',()=>{
 for(const target of [null,undefined,{}] as SessionTarget[]){
  expect(sessionKey(target)).toBe('');
  expect(activateSession(EMPTY_SESSION_DECK,target)).toBe(EMPTY_SESSION_DECK);
 }
 expect(sessionKey({...emptyA,chat:undefined})).toBe(sessionKey(emptyA));
});

test('retention does not read clocks or schedule timers and does not expire with elapsed time',()=>{
 jest.useFakeTimers();
 const now=jest.spyOn(Date,'now');
 const timeout=jest.spyOn(globalThis,'setTimeout');
 const interval=jest.spyOn(globalThis,'setInterval');
 try{
  const deck=select(a,b,emptyA);
  expect(now).not.toHaveBeenCalled();
  expect(timeout).not.toHaveBeenCalled();
  expect(interval).not.toHaveBeenCalled();
  jest.advanceTimersByTime(365*24*60*60*1000);
  const next=activateSession(deck,{...a});
  expect(next.targets).toEqual([b,a]);
  expect(next.targets[1]).toBe(a);
 }finally{
  now.mockRestore();timeout.mockRestore();interval.mockRestore();
  jest.useRealTimers();
 }
});

test('backend removal preserves surviving identities and selects the newest survivor when necessary',()=>{
 const deck=freeze(select(a,b,emptyA));
 expect(removeBackendSessions(deck,'unpaired-backend')).toBe(deck);
 const removed=removeBackendSessions(deck,backendA);
 expect(removed.targets).toEqual([b]);
 expect(removed.targets[0]).toBe(b);
 expect(removed.active).toBe(sessionKey(b));
 const inactiveRemoved=removeBackendSessions(deck,backendB);
 expect(inactiveRemoved.targets).toEqual([a,emptyA]);
 expect(inactiveRemoved.active).toBe(deck.active);
 expect(removeBackendSessions(removed,backendB)).toBe(EMPTY_SESSION_DECK);
 expect(EMPTY_SESSION_DECK).toEqual({active:'',targets:[]});
});
