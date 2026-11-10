import React,{useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Animated,AppState,Image,PanResponder,Platform,Pressable,requireNativeComponent,StyleSheet,UIManager,View,type ImageSourcePropType,type NativeSyntheticEvent,type PanResponderCallbacks,type ViewProps} from 'react-native';
import {ChevronLeft,ChevronRight,Download,Info,ImageIcon} from 'lucide-react-native';
import {useChatMotion} from '../chat-motion';
import {themed,useTheme,useThemedValue} from '../theme';
import {Text} from './app-text';

export type ImageStackItem={id:string;name:string;source?:ImageSourcePropType};
type Props={images:readonly ImageStackItem[];onOpen:(image:ImageStackItem)=>void;onDetails?:(image:ImageStackItem)=>void;onSave?:(image:ImageStackItem)=>void;active?:boolean};
type GestureProps=ViewProps&{gestureEnabled?:boolean;trackDrag?:boolean;gestureKey?:number;onImageDrag?:(event:NativeSyntheticEvent<{translationX:number}>)=>void};
const NativeGestureStage=Platform.OS==='android'&&UIManager.getViewManagerConfig('BobImageGesture')?Animated.createAnimatedComponent(requireNativeComponent<GestureProps>('BobImageGesture')):undefined;
const GestureStage=NativeGestureStage??View;
const sourceKey=(image:ImageStackItem)=>JSON.stringify(image.source??null);
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(value,max));
const cardTop=[20,14,10] as const;

/** Presentation only. Native touch arbitration owns no file/backend authority. */
export function ImageAttachmentStack({images,onOpen,onDetails,onSave,active=true}:Props) {
 const styles=useThemedValue(stylesTheme),{colors}=useTheme(),chatMotion=useChatMotion();
 const [foreground,setForeground]=useState(AppState.currentState==='active');
 const motion=chatMotion&&active&&foreground;
 const [selectedId,setSelectedId]=useState(images[0]?.id),[settling,setSettling]=useState(false);
 const [width,setWidth]=useState(280),[ratios,setRatios]=useState<Record<string,{source:string;ratio:number}>>({});
 const index=Math.max(0,images.findIndex(image=>image.id===selectedId)),current=images[index];
 const revision=JSON.stringify(images.map(image=>[image.id,sourceKey(image)]));
 // The native guard gets only a cancellation epoch, never source URLs/headers.
 const geometryRevision=`${width}:${motion}:${revision}`,epoch=useRef({revision:geometryRevision,value:0});
 if(epoch.current.revision!==geometryRevision)epoch.current={revision:geometryRevision,value:epoch.current.value+1};
 const latest=useRef({images,currentId:current?.id,revision,active,foreground});latest.current={images,currentId:current?.id,revision,active,foreground};
 const alive=useRef(false),generation=useRef(0),busy=useRef(false),dragging=useRef(false),suppressTap=useRef(false),dragDistance=useRef(0);
 const handoff=useRef<{id:string;token:number}|undefined>(undefined);
 const animation=useRef<Animated.CompositeAnimation|undefined>(undefined),x=useRef(new Animated.Value(0)).current;
 const invalidate=useCallback(()=>{
  generation.current++;handoff.current=undefined;
  const previous=animation.current;animation.current=undefined;
  busy.current=false;dragging.current=false;dragDistance.current=0;
  previous?.stop();x.stopAnimation();x.setValue(0);
  if(alive.current)setSettling(false);
 },[x]);
 useLayoutEffect(()=>{alive.current=true;return ()=>{alive.current=false;invalidate();};},[invalidate]);
 useLayoutEffect(()=>{
  invalidate();if(!images.some(image=>image.id===selectedId))setSelectedId(images[0]?.id);
  // Identity, not array references or ordinary selection changes, invalidates a gesture.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[revision,width,active,foreground,motion,invalidate]);
 useLayoutEffect(()=>{
  const pending=handoff.current;
  if(!pending||pending.id!==selectedId||pending.token!==generation.current)return;
  // Reset only AFTER the incoming photo owns the front slot. Resetting before
  // React commits brings the outgoing photo back for a frame (the visible jump).
  handoff.current=undefined;x.setValue(0);busy.current=false;animation.current=undefined;setSettling(false);
 },[selectedId,x]);
 useEffect(()=>{
  if(!active)return;
  setForeground(AppState.currentState==='active');
  const subscription=AppState.addEventListener('change',state=>{if(state!=='active')invalidate();setForeground(state==='active');});
  return ()=>subscription.remove();
 },[active,invalidate]);
 const valid=()=>alive.current&&latest.current.active&&latest.current.foreground&&latest.current.revision===revision&&latest.current.currentId===current?.id;
 const actOn=(callback:((image:ImageStackItem)=>void)|undefined)=>{
  if(!callback||!current||!valid()||busy.current||dragging.current)return;
  const item=latest.current.images.find(image=>image.id===current.id);if(item)callback(item);
 };
 const navigate=(nextDirection:1|-1)=>{
  if(!valid()||busy.current||images.length<2)return;
  const next=images[(index+nextDirection+images.length)%images.length];
  if(!motion){x.setValue(0);setSelectedId(next.id);return;}
  const token=++generation.current;busy.current=true;setSettling(true);
  const duration=Math.round(Math.max(90,200*(1-Math.min(Math.abs(dragDistance.current)/width,0.8))));
  animation.current=Animated.timing(x,{toValue:-nextDirection*width,duration,useNativeDriver:true,isInteraction:false});
  animation.current.start(({finished})=>{
   if(!alive.current||generation.current!==token||latest.current.revision!==revision||!latest.current.active||!latest.current.foreground)return;
   if(!finished){busy.current=false;x.setValue(0);setSettling(false);return;}
   handoff.current={id:next.id,token};setSelectedId(next.id);
  });
 };
 const springBack=()=>{
  if(!valid())return;
  if(!motion){x.setValue(0);return;}
  const token=++generation.current;busy.current=true;setSettling(true);
  animation.current=Animated.spring(x,{toValue:0,stiffness:280,damping:30,mass:1,overshootClamping:true,useNativeDriver:true,isInteraction:false});
  animation.current.start(()=>{if(alive.current&&generation.current===token){busy.current=false;animation.current=undefined;x.setValue(0);setSettling(false);}});
 };
 const cardWidth=Math.max(0,width-32),ratio=current&&ratios[current.id]?.source===sourceKey(current)?ratios[current.id].ratio:1;
 const height=clamp(images.length>1?cardWidth:cardWidth/ratio,160,300);
 const horizontalIntent:NonNullable<PanResponderCallbacks['onMoveShouldSetPanResponder']>=(_event,gesture)=>valid()&&!busy.current&&images.length>1&&gesture.numberActiveTouches===1&&Math.abs(gesture.dx)>6&&Math.abs(gesture.dx)>Math.abs(gesture.dy)*1.2;
 const responder=useStackPanResponder({
  onStartShouldSetPanResponder:()=>false,
  onMoveShouldSetPanResponder:horizontalIntent,
  onMoveShouldSetPanResponderCapture:horizontalIntent,
  onPanResponderGrant:()=>{if(valid()&&!busy.current){dragging.current=true;suppressTap.current=true;dragDistance.current=0;}},
  onPanResponderMove:(_event,gesture)=>{
   if(!valid()||!dragging.current)return;
   if(gesture.numberActiveTouches!==1){dragging.current=false;springBack();return;}
   dragDistance.current=gesture.dx;
   // Android drives the value directly from its native touch event. Other
   // platforms retain the guarded responder fallback, without the old 45% stop.
   if(!NativeGestureStage&&motion)x.setValue(clamp(gesture.dx,-width,width));
  },
  onPanResponderRelease:(_event,gesture)=>{
   if(!valid()||!dragging.current)return;
   dragging.current=false;
   if(Math.abs(gesture.dx)>=Math.max(40,cardWidth*0.22)&&Math.abs(gesture.dx)>Math.abs(gesture.dy)*1.2)navigate(gesture.dx<0?1:-1);
   else springBack();
  },
  onPanResponderTerminationRequest:()=>!dragging.current,
  onPanResponderTerminate:()=>{if(valid()&&dragging.current){dragging.current=false;springBack();}},
  onShouldBlockNativeResponder:()=>true,
 });
 const nativeDrag=useMemo(()=>Animated.event([{nativeEvent:{translationX:x}}],{useNativeDriver:true}),[x]);
 const transforms=useMemo(()=>{
  const incoming=(depth:1|2)=>({
   // Select the correct neighbour on the native value's sign, including while
   // JS is busy. A per-move React direction update can reveal the wrong card.
   opacity:images.length===2?1:x.interpolate({inputRange:[-1,0,1],outputRange:depth===1?[1,1,0]:[0,1,1],extrapolate:'clamp'}),
   transform:[{rotate:x.interpolate({inputRange:[-width,0,width],outputRange:['0deg',depth===1?'-3deg':'3deg','0deg'],extrapolate:'clamp'})},{translateY:x.interpolate({inputRange:[-width,0,width],outputRange:[cardTop[0]-cardTop[depth],0,cardTop[0]-cardTop[depth]],extrapolate:'clamp'})},{scale:x.interpolate({inputRange:[-width,0,width],outputRange:[1,depth===1?0.98:0.95,1],extrapolate:'clamp'})}],
  });
  return {front:{transform:[{translateX:x},{rotate:x.interpolate({inputRange:[-width,0,width],outputRange:['-4deg','0deg','4deg'],extrapolate:'clamp'})}]},next:incoming(1),previous:incoming(2)};
 },[x,width,images.length]);
 const onRatio=useCallback((id:string,source:string,value:number)=>{
  if(!alive.current||latest.current.images.length!==1||!latest.current.images.some(image=>image.id===id&&sourceKey(image)===source))return;
  setRatios(previous=>previous[id]?.source===source&&previous[id]?.ratio===value?previous:{...previous,[id]:{source,ratio:value}});
 },[]);
 // Keep both neighbours loaded; swiping right must reveal the previous image,
 // not the next image followed by a last-frame replacement.
 const cards=useMemo(()=>[index,(index+1)%images.length,(index-1+images.length)%images.length].filter((value,i,all)=>all.indexOf(value)===i).map((at,depth)=>({image:images[at],depth})).reverse(),[images,index]);
 if(!current)return null;
 return <View testID="image-attachment-stack" style={styles.root} onLayout={event=>{const measured=event.nativeEvent.layout.width;if(Number.isFinite(measured)&&measured>0)setWidth(Math.min(280,measured));}}>
  <GestureStage testID="image-stack-stage" {...responder.panHandlers} style={[styles.stage,{height:height+40}]} {...(NativeGestureStage?{gestureEnabled:active&&foreground&&!settling&&images.length>1,trackDrag:motion,gestureKey:epoch.current.value,onImageDrag:nativeDrag}:{})}>
   {cards.map(({image,depth})=><Animated.View key={image.id} testID={`image-stack-card-${image.id}`} pointerEvents={depth===0?'auto':'none'} accessible={false} accessibilityElementsHidden={depth!==0} importantForAccessibility={depth===0?'auto':'no-hide-descendants'}
    style={[styles.cardPosition,{height,top:cardTop[depth],zIndex:3-depth},depth===0?transforms.front:depth===1?transforms.next:transforms.previous]}>
    <ImageCard image={image} front={depth===0} position={`Image ${index+1} of ${images.length}`} enabled={active&&foreground&&!settling} onRatio={onRatio}
     onPressIn={()=>{if(valid()&&!busy.current&&!dragging.current)suppressTap.current=false;}}
     onOpen={()=>{if(!suppressTap.current)actOn(onOpen);}} canRetry={()=>valid()&&!busy.current&&!dragging.current&&!suppressTap.current}/>
   </Animated.View>)}
  </GestureStage>
  <View testID="image-stack-footer" style={styles.footer}>
   {images.length>1&&<Pressable accessibilityRole="button" accessibilityLabel="Previous image" disabled={!active||!foreground||settling} accessibilityState={{disabled:!active||!foreground||settling}} style={styles.iconTarget} onPress={()=>{dragDistance.current=0;navigate(-1);}}><ChevronLeft size={18} color={colors.muted}/></Pressable>}
   {images.length>1&&<Pressable accessibilityRole="button" accessibilityLabel="Next image" disabled={!active||!foreground||settling} accessibilityState={{disabled:!active||!foreground||settling}} style={styles.iconTarget} onPress={()=>{dragDistance.current=0;navigate(1);}}><ChevronRight size={18} color={colors.muted}/></Pressable>}
   {onDetails&&<Pressable accessibilityRole="button" accessibilityLabel={`Attachment details: ${current.name}`} disabled={!active||!foreground||settling} style={styles.iconTarget} onPress={()=>actOn(onDetails)}><Info size={15} color={colors.muted}/></Pressable>}
   {onSave&&<Pressable accessibilityRole="button" accessibilityLabel={`Save ${current.name}`} disabled={!active||!foreground||settling} style={styles.iconTarget} onPress={()=>actOn(onSave)}><Download size={15} color={colors.muted}/></Pressable>}
  </View>
 </View>;
}

// Keep native touch tracking intact through load/layout rerenders; only the handlers update.
function useStackPanResponder(callbacks:PanResponderCallbacks) {
 const latest=useRef(callbacks);latest.current=callbacks;
 return useMemo(()=>PanResponder.create({
  onStartShouldSetPanResponder:(event,gesture)=>latest.current.onStartShouldSetPanResponder?.(event,gesture)??false,
  onMoveShouldSetPanResponder:(event,gesture)=>latest.current.onMoveShouldSetPanResponder?.(event,gesture)??false,
  onMoveShouldSetPanResponderCapture:(event,gesture)=>latest.current.onMoveShouldSetPanResponderCapture?.(event,gesture)??false,
  onPanResponderGrant:(event,gesture)=>latest.current.onPanResponderGrant?.(event,gesture),
  onPanResponderMove:(event,gesture)=>latest.current.onPanResponderMove?.(event,gesture),
  onPanResponderRelease:(event,gesture)=>latest.current.onPanResponderRelease?.(event,gesture),
  onPanResponderTerminationRequest:(event,gesture)=>latest.current.onPanResponderTerminationRequest?.(event,gesture)??true,
  onPanResponderTerminate:(event,gesture)=>latest.current.onPanResponderTerminate?.(event,gesture),
  onShouldBlockNativeResponder:(event,gesture)=>latest.current.onShouldBlockNativeResponder?.(event,gesture)??false,
 }),[]);
}

// A module-level, id-keyed child preserves native image identity as cards change depth.
function ImageCard({image,front,position,enabled,onOpen,onPressIn,canRetry,onRatio}:{image:ImageStackItem;front:boolean;position:string;enabled:boolean;onOpen:()=>void;onPressIn:()=>void;canRetry:()=>boolean;onRatio:(id:string,source:string,ratio:number)=>void}) {
 const styles=useThemedValue(stylesTheme),{colors}=useTheme();
 const [attempt,setAttempt]=useState(0),[result,setResult]=useState<{request:number;status:'loaded'|'failed'}>();
 const source=sourceKey(image),requestKey=`${source}:${attempt}`;
 const liveRequest=useRef({key:requestKey,serial:0}),alive=useRef(false);
 // A -> B -> A is a new native request too, not permission for an old A callback.
 if(liveRequest.current.key!==requestKey)liveRequest.current={key:requestKey,serial:liveRequest.current.serial+1};
 const request=liveRequest.current.serial;
 useLayoutEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
 const valid=()=>alive.current&&liveRequest.current.serial===request;
 const status=!image.source?'missing':result?.request===request?result.status:'loading';
 return <View style={styles.card}>
  <Pressable testID={front?'image-stack-front':undefined} style={styles.preview} accessible={front} accessibilityValue={front?{text:position}:undefined} accessibilityRole="button" accessibilityLabel={`Open ${image.name}`} accessibilityHint={status==='failed'||status==='missing'?'Preview unavailable. Opens the original image.':undefined} disabled={!front||!enabled} onPressIn={onPressIn} onPress={()=>{if(front&&enabled)onOpen();}}>
   {image.source&&<Image key={request} testID={`image-stack-image-${image.id}`} accessible={false} source={image.source} resizeMode="contain" resizeMethod="resize" style={[styles.image,status!=='loaded'&&styles.hiddenImage]}
    onLoad={event=>{
     if(!valid())return;
     setResult({request,status:'loaded'});
     const {width,height}=event.nativeEvent.source;
     if(Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0)onRatio(image.id,source,width/height);
    }} onError={()=>{if(valid())setResult({request,status:'failed'});}}/>}
   {status!=='loaded'&&<View pointerEvents="none" style={styles.fallback}>
    <ImageIcon size={26} color={colors.muted}/>
    <Text style={styles.fallbackText}>{status==='loading'?'Loading image…':'Preview unavailable'}</Text>
    {status!=='loading'&&<Text style={styles.fallbackText}>Tap to open</Text>}
   </View>}
  </Pressable>
  {front&&status==='failed'&&<Pressable accessibilityRole="button" accessibilityLabel={`Retry preview: ${image.name}`} disabled={!enabled} onPressIn={onPressIn} onPress={()=>{if(valid()&&canRetry())setAttempt(previous=>previous+1);}} style={styles.retry}><Text style={styles.retryText}>Retry preview</Text></Pressable>}
 </View>;
}

const stylesTheme=themed(({colors,menuChrome,shadows})=>StyleSheet.create({
 root:{width:'100%',maxWidth:280,overflow:'hidden'},
 stage:{width:'100%',position:'relative',overflow:'hidden'},
 // Shadow stays outside the clipping photo surface; insets also contain rear-card rotation.
 cardPosition:{...shadows.floating,borderRadius:menuChrome.card.borderRadius,position:'absolute',left:16,right:16},
 card:{...menuChrome.card,flex:1,overflow:'hidden',backgroundColor:colors.surface},
 preview:{flex:1},
 image:{width:'100%',height:'100%'},
 hiddenImage:{opacity:0},
 fallback:{position:'absolute',top:0,bottom:0,left:0,right:0,alignItems:'center',justifyContent:'center',padding:12,paddingBottom:48,gap:6},
 fallbackText:{fontSize:12,color:colors.muted,textAlign:'center'},
 footer:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'center'},
 iconTarget:{width:48,height:48,alignItems:'center',justifyContent:'center'},
 retry:{position:'absolute',bottom:0,left:0,right:0,minHeight:48,alignItems:'center',justifyContent:'center'},
 retryText:{fontSize:12,color:colors.foreground,padding:8,textAlign:'center'},
}));
