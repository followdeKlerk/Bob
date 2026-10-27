/** Empty transcript copy is not a history failure. Errors/retries live in the footer. */
export function emptyConversationMessage(history:{ready:boolean;loading:boolean;error?:string;page?:unknown}):string|undefined {
 if(!history.ready||history.loading)return 'Loading conversation…';
 if(history.error)return undefined;
 // Cache readiness alone does not establish that authoritative history loaded.
 if(!history.page)return 'Loading conversation…';
 return 'No messages yet.';
}
