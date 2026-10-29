/** Local topic extraction: no extra inference call, latency, or title-service dependency. */
export function isPlaceholderTitle(title:string|undefined):boolean {
 return !title?.trim()||/^(?:new (?:chat|conversation)|untitled|conversation|chat)$/i.test(title.trim());
}
export function conversationTitle(text:string):string|undefined {
 const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!/^User attachment available at\s/i.test(line));
 let topic=lines.find(line=>!/^https?:\/\/\S+$/.test(line))??lines[0];
 if(!topic)return undefined;
 topic=topic.replace(/^#{1,6}\s+/,'').replace(/\[(.*?)\]\([^)]*\)/g,'$1').replace(/[*`_]/g,'').replace(/\s+/g,' ').trim();
 topic=topic.replace(/^(?:please\s+)?(?:can|could|would) you\s+(?:please\s+)?/i,'').replace(/^please\s+/i,'');
 // Keep the opening subject rather than an unrelated second paragraph/sentence.
 topic=topic.split(/(?<=[.!?])\s+(?=[A-Z])/u)[0];
 const words=topic.split(' '),short=words.slice(0,10).join(' ');
 const chars=Array.from(short);let title=chars.slice(0,72).join('').replace(/[\s,;:]+$/,'');
 if(words.length>10||chars.length>72)title+='…';
 if(!title)return undefined;
 return title[0].toLocaleUpperCase()+title.slice(1);
}
