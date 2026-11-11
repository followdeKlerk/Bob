import {useMemo} from 'react';
/** Recorded-history projections need live tool state and exact call identities,
 * not the prose/thinking tokens of the current generation. Keep the full live
 * document on the rendering path; this is only a narrower projection input. */
export function useTranscriptLiveTools(live:any){
 const content=live?.generation?.message?.content;
 const ids=JSON.stringify(Array.isArray(content)?content.filter(block=>block?.type==='toolCall'&&typeof block.id==='string').map(block=>block.id):[]);
 return useMemo(()=>({tools:live?.tools,nestedTools:live?.nestedTools,generation:{message:{content:(JSON.parse(ids) as string[]).map(id=>({type:'toolCall',id}))}}}),[live?.tools,live?.nestedTools,ids]);
}
