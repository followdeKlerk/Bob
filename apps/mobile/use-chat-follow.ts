import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AccessibilityInfo,AppState,type FlatList,type NativeSyntheticEvent,type NativeScrollEvent} from 'react-native';
import {ChatFollow} from './chat-follow';
export function useChatFollow<T>(scope:string,inverted=false){
 const list=useRef<FlatList<T>>(null),policy=useRef(new ChatFollow(inverted));
 const frame=useRef<number|undefined>(undefined),release=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const positioned=useRef(false),autoScrolling=useRef(false),reduceMotion=useRef(false),bottom=useRef(true),following=useRef(true);
 const [isFollowing,setIsFollowing]=useState(true);
 const foreground=useRef(AppState.currentState!=='background'&&AppState.currentState!=='inactive'),pendingFollow=useRef(false);
 const layout=useRef({content:0,viewport:0}),metrics=useRef({offset:0,content:0,viewport:0}),[atBottom,setAtBottom]=useState(true);
 const updateBottom=(value:boolean)=>{if(bottom.current!==value){bottom.current=value;setAtBottom(value);}};
 const syncFollowing=()=>{if(following.current!==policy.current.following){following.current=policy.current.following;setIsFollowing(following.current);}};
 const cancelFollow=()=>{if(frame.current!==undefined)cancelAnimationFrame(frame.current);frame.current=undefined;};
 useEffect(()=>{
  let alive=true;void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(alive)reduceMotion.current=value;}).catch(()=>{});
  const subscription=AccessibilityInfo.addEventListener('reduceMotionChanged',value=>{reduceMotion.current=value;});
  return()=>{alive=false;subscription.remove();};
 },[]);
 const follow=(smooth=false,force=false)=>{
  if(!policy.current.following||policy.current.interacting)return;
  if(!foreground.current){pendingFollow.current=true;return;}
  const m=metrics.current;
  if(!force&&positioned.current&&(inverted?Math.max(0,m.offset)<=1:m.content>0&&m.viewport>0&&Math.abs(Math.max(0,m.content-m.viewport)-m.offset)<=1)){pendingFollow.current=false;return;}
  cancelFollow();
  frame.current=requestAnimationFrame(()=>{
   frame.current=undefined;
   if(!foreground.current){pendingFollow.current=true;return;}
   if(policy.current.following&&!policy.current.interacting&&list.current){
    const animated=smooth&&positioned.current&&!reduceMotion.current;autoScrolling.current=animated;
    // Inverted chat starts natively at the newest end (offset zero). It never
    // needs the height of older messages to discover where the latest one is.
    if(inverted)list.current.scrollToOffset({offset:0,animated});
    else{
     const native=list.current.getScrollResponder?.();
     if(native?.scrollToEnd)native.scrollToEnd({animated});else list.current.scrollToEnd({animated});
    }
    positioned.current=true;pendingFollow.current=false;
   }
  });
 };
 useEffect(()=>{
  const subscription=AppState.addEventListener('change',state=>{
   const active=state==='active';
   if(!active){
    // A pending real change may be caught up once, but returning by itself is
    // not a reason to scroll or to reset a reader's follow/paused choice.
    if(frame.current!==undefined&&policy.current.following)pendingFollow.current=true;
    foreground.current=false;cancelFollow();clearTimeout(release.current);policy.current.end();autoScrolling.current=false;
   }else if(!foreground.current){foreground.current=true;if(pendingFollow.current)follow();}
  });
  return()=>subscription.remove();
 },[inverted]);
 useLayoutEffect(()=>{
  policy.current=new ChatFollow(inverted);syncFollowing();positioned.current=inverted;autoScrolling.current=false;pendingFollow.current=false;
  layout.current={content:0,viewport:0};metrics.current={offset:0,content:0,viewport:0};updateBottom(true);if(!inverted)follow();
  return()=>{cancelFollow();clearTimeout(release.current);};
 },[scope,inverted]);
 const scroll=(event:NativeSyntheticEvent<NativeScrollEvent>)=>{
  const {contentOffset,contentSize,layoutMeasurement}=event.nativeEvent;
  // Detach/background callbacks can report zero geometry. They must not erase
  // the real offset or masquerade as a deliberate scroll to the top.
  if(!foreground.current||layoutMeasurement.height<=0||contentSize.height<=0)return;
  metrics.current={offset:contentOffset.y,content:contentSize.height,viewport:layoutMeasurement.height};
  updateBottom(inverted?contentOffset.y<=48:contentSize.height-layoutMeasurement.height-contentOffset.y<=48);
  policy.current.scroll(contentOffset.y,contentSize.height,layoutMeasurement.height);syncFollowing();
 };
 const oldest=()=>{
  policy.current.following=false;syncFollowing();pendingFollow.current=false;cancelFollow();
  if(inverted){const native=list.current?.getScrollResponder?.();if(native?.scrollToEnd)native.scrollToEnd({animated:false});else list.current?.scrollToEnd({animated:false});}
  else list.current?.scrollToOffset({offset:0,animated:false});
 };
 return {list,follow,oldest,atBottom,following:isFollowing,showJump:!atBottom&&!isFollowing,pause:()=>{policy.current.following=false;syncFollowing();pendingFollow.current=false;cancelFollow();},resume:()=>{clearTimeout(release.current);policy.current.following=true;syncFollowing();policy.current.end();follow(true,true);},props:{
  onContentSizeChange:(_width?:number,height?:number)=>{
   if(height!==undefined){
    if(!Number.isFinite(height)||height<=0||height===layout.current.content)return;
    layout.current.content=height;metrics.current.content=height;
    if(foreground.current){const m=metrics.current;updateBottom(inverted?m.offset<=48:m.content-m.viewport-m.offset<=48);}
   }
   // Streamed content still follows, but repeated resume measurements do not.
   follow(false);
  },
  onLayout:(event?:any)=>{
   const height=event?.nativeEvent?.layout?.height;
   if(height!==undefined){
    if(!Number.isFinite(height)||height<=0||height===layout.current.viewport)return;
    layout.current.viewport=height;metrics.current.viewport=height;
   }
   follow();
  },scrollEventThrottle:32,
  onScroll:scroll,
  onScrollBeginDrag:()=>{if(!foreground.current)return;clearTimeout(release.current);cancelFollow();pendingFollow.current=false;autoScrolling.current=false;policy.current.following=false;syncFollowing();policy.current.begin();},
  onScrollEndDrag:(event:NativeSyntheticEvent<NativeScrollEvent>)=>{if(!foreground.current)return;scroll(event);clearTimeout(release.current);release.current=setTimeout(()=>policy.current.end(),150);},
  onMomentumScrollBegin:()=>{if(!foreground.current)return;clearTimeout(release.current);if(!autoScrolling.current)policy.current.begin();},
  onMomentumScrollEnd:(event:NativeSyntheticEvent<NativeScrollEvent>)=>{if(!foreground.current)return;if(!autoScrolling.current)scroll(event);policy.current.end();autoScrolling.current=false;},
 }};
}
