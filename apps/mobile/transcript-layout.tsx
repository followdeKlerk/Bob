import React,{createContext,useContext,useMemo} from 'react';
import {View} from 'react-native';
import {withLiveResponse,type ReplyEntry} from './chat-replies';
import type {ImageAttachmentRow} from './image-attachment-rows';
import {chatEntryGap} from './chat-presentation';
import {CHAT_CONTENT_GAP} from './tool-presentation';

/** Keep list data and spacing stable through unrelated composer/keyboard updates.
 * Generation changes still flow immediately; never throttle or delay new text. */
export function useTranscriptLayout(output:readonly ImageAttachmentRow[],raw:readonly ReplyEntry[],live:Parameters<typeof withLiveResponse>[2]){
 return useMemo(()=>{
  const response=withLiveResponse([...output].reverse(),raw,live);
  const entries=response.entries.reverse() as ImageAttachmentRow[];
  // Separators receive only the leading row in the inverted display order.
  const gaps=new Map(entries.map((entry,index)=>{
   const next=entries[index+1];
   return [entry.id,entry.inlineSurfaceId||next?.inlineSurfaceId?CHAT_CONTENT_GAP:chatEntryGap(entry,next)];
  }));
  return {entries,gaps,legacyLive:response.legacyLive};
 },[output,raw,live]);
}
const GapContext=createContext<ReadonlyMap<number,number>>(new Map());
export const TranscriptGaps=GapContext.Provider;
/** A stable component type prevents FlatList remounting all visible separators
 * on each app render. Context updates spacing without replacing native views. */
export function TranscriptSeparator({leadingItem}:{leadingItem?:ReplyEntry}){
 const gaps=useContext(GapContext);
 return <View testID="chat-entry-separator" style={{height:leadingItem?gaps.get(leadingItem.id)??CHAT_CONTENT_GAP:CHAT_CONTENT_GAP}}/>;
}
