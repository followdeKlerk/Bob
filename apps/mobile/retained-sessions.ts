export type SessionTarget={backendId:string;chat?:number};
export type SessionDeck={active:string;targets:SessionTarget[]};

export const EMPTY_SESSION_DECK:SessionDeck={active:'',targets:[]};

/** Stable backend identity only: never a display label or an endpoint.
 * Accept opaque ASCII IDs (including UUIDs); reject whitespace and key delimiters.
 * Invalid input has no key; in particular an invalid chat is not an empty browser.
 */
export function sessionKey(target:SessionTarget):string {
 if(!target||typeof target.backendId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(target.backendId))return '';
 if(target.chat!==undefined&&(!Number.isSafeInteger(target.chat)||target.chat<=0))return '';
 return `${target.backendId}:${target.chat===undefined?'empty':target.chat}`;
}

/** Oldest-to-newest MRU. Only conversations consume the two retained slots.
 * An empty browser is retained only while selected, and replaces any old browser.
 * All transitions are immutable; reselecting the active target is a true no-op.
 */
export function activateSession(deck:SessionDeck,target:SessionTarget):SessionDeck {
 const active=sessionKey(target);
 if(!active)return deck;
 const retained=deck.targets.find(item=>sessionKey(item)===active)??target;
 const conversations=deck.targets.filter(item=>item.chat!==undefined&&sessionKey(item)!==active);
 const targets=retained.chat===undefined
  ?[...conversations.slice(-2),retained]
  :[...conversations.slice(-1),retained];
 if(deck.active===active&&targets.length===deck.targets.length&&targets.every((item,index)=>item===deck.targets[index]))return deck;
 return {active,targets};
}

/** Removing the active backend selects the most recently used surviving target. */
export function removeBackendSessions(deck:SessionDeck,backendId:string):SessionDeck {
 const targets=deck.targets.filter(target=>target.backendId!==backendId);
 if(targets.length===deck.targets.length)return deck;
 if(!targets.length)return EMPTY_SESSION_DECK;
 const active=targets.some(target=>sessionKey(target)===deck.active)?deck.active:sessionKey(targets[targets.length-1]);
 return {active,targets};
}
