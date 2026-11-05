import {Text} from './app-text';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Alert,Modal,PanResponder,Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Svg,{Path} from 'react-native-svg';
import {RotateCcw,RotateCw} from 'lucide-react-native';
import {themed,useTheme,useThemedValue} from '../theme';
import {SectionHeading,SectionAction} from './section-ui';

type Size={width:number;height:number};
type Stroke={color:string;width:number;points:{x:number;y:number}[]};
function fitPaper(viewport:Size,paper:Size){
 const scale=paper.width>0&&paper.height>0?Math.min(viewport.width/paper.width,viewport.height/paper.height):0;
 return {scale,width:paper.width*scale,height:paper.height*scale,left:(viewport.width-paper.width*scale)/2,top:(viewport.height-paper.height*scale)/2};
}
const palette=[{label:'Black',value:'#111111'},{label:'Red',value:'#e53935'},{label:'Blue',value:'#246bfe'},{label:'Green',value:'#23935b'}];
const exportTimeoutMs=10000;
function pathFor(stroke:Stroke){const path=stroke.points.map((point,index)=>`${index?'L':'M'}${point.x},${point.y}`).join(' ');return stroke.points.length===1?`${path} l0.01,0`:path;}
export function DrawingEditor({visible,onCancel,onAdd}:{visible:boolean;onCancel:()=>void;onAdd:(pngDataUri:string)=>Promise<void>}){
 const {colors}=useTheme();
 const s=useThemedValue(sTheme);

 const [strokes,setStrokes]=useState<Stroke[]>([]),[redo,setRedo]=useState<Stroke[]>([]),[color,setColor]=useState('#111111'),[penWidth,setPenWidth]=useState(5),[erasing,setErasing]=useState(false);
 const [canvas,setCanvas]=useState<Size>({width:0,height:0}),[paper,setPaper]=useState<Size|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState('');
 // Lock document coordinates on the first stroke, not to transient feedback/rotation layouts.
 const viewport=useRef(canvas),documentSize=useRef<Size|null>(null),drawing=useRef(false);
 const svgRef=useRef<any>(null),inFlight=useRef(false),active=useRef(false),operation=useRef(0),cancelExport=useRef<(()=>void)|null>(null),confirming=useRef(false);
 const hasContent=strokes.length>0;
 useEffect(()=>{
  active.current=visible;
  if(!visible){inFlight.current=false;setSaving(false);setError('');setStrokes([]);setRedo([]);setColor('#111111');setPenWidth(5);setErasing(false);setPaper(null);documentSize.current=null;drawing.current=false;confirming.current=false;}
  return()=>{active.current=false;operation.current++;cancelExport.current?.();cancelExport.current=null;};
 },[visible]);
 const responder=useMemo(()=>{
  function point(location:{locationX:number;locationY:number},clamp=false){
   const size=documentSize.current??{width:Math.round(viewport.current.width),height:Math.round(viewport.current.height)};
   const fit=fitPaper(viewport.current,size);
   if(fit.scale<=0)return null;
   const x=(location.locationX-fit.left)/fit.scale,y=(location.locationY-fit.top)/fit.scale;
   if(!clamp&&(x<0||y<0||x>size.width||y>size.height))return null;
   return {x:Math.max(0,Math.min(size.width,x)),y:Math.max(0,Math.min(size.height,y))};
  }
  return PanResponder.create({onStartShouldSetPanResponder:()=>!inFlight.current,onMoveShouldSetPanResponder:()=>!inFlight.current,onPanResponderGrant:event=>{
   drawing.current=false;if(inFlight.current)return;
   const start=point(event.nativeEvent);if(!start)return;
   if(!documentSize.current){documentSize.current={width:Math.round(viewport.current.width),height:Math.round(viewport.current.height)};setPaper(documentSize.current);}
   drawing.current=true;setStrokes(previous=>[...previous,{color:erasing?'#ffffff':color,width:erasing?penWidth*4:penWidth,points:[start]}]);setError('');setRedo([]);
  },onPanResponderMove:event=>{
   if(inFlight.current||!drawing.current)return;
   const next=point(event.nativeEvent,true);if(!next)return;
   setStrokes(previous=>{if(!previous.length)return previous;const updated=[...previous];const last=updated[updated.length-1];updated[updated.length-1]={...last,points:[...last.points,next]};return updated;});
  },onPanResponderRelease:()=>{drawing.current=false;},onPanResponderTerminate:()=>{drawing.current=false;}});
 },[color,penWidth,erasing]);
 function undo(){if(inFlight.current||!strokes.length)return;setRedo(previous=>[...previous,strokes[strokes.length-1]]);setStrokes(strokes.slice(0,-1));setError('');}
 function redoLast(){if(inFlight.current||!redo.length)return;setStrokes(previous=>[...previous,redo[redo.length-1]]);setRedo(previous=>previous.slice(0,-1));setError('');}
 function requestCancel(){
  if(inFlight.current||confirming.current)return;
  if(!strokes.length&&!redo.length){onCancel();return;}
  confirming.current=true;
  Alert.alert('Discard drawing?','Your drawing has not been added.',[
   {text:'Keep drawing',style:'cancel',onPress:()=>{confirming.current=false;}},
   {text:'Discard',style:'destructive',onPress:()=>{confirming.current=false;if(active.current&&!inFlight.current)onCancel();}},
  ],{cancelable:true,onDismiss:()=>{confirming.current=false;}});
 }
 async function add(){
  if(inFlight.current||!active.current||!hasContent)return;
  inFlight.current=true;const token=++operation.current;setSaving(true);setError('');
  try{
   const node=svgRef.current;
   const size=documentSize.current;
   if(!node||!size||canvas.width<=0||canvas.height<=0)throw Error('The drawing canvas is not ready. Please try again.');
   const base64=await new Promise<string>((resolve,reject)=>{
    let settled=false;
    const finish=(value?:string,failure?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);cancelExport.current=null;if(failure)reject(failure);else if(!value?.trim())reject(Error('The drawing export was empty. Please try again.'));else resolve(value);};
    const timer=setTimeout(()=>finish(undefined,Error('The drawing export timed out. Please try again.')),exportTimeoutMs);
    cancelExport.current=()=>finish(undefined,Error('Drawing closed'));
    try{node.toDataURL((value:string)=>finish(value),{width:size.width,height:size.height});}catch(e){finish(undefined,e instanceof Error?e:Error('Could not export the drawing. Please try again.'));}
   });
   if(!active.current||token!==operation.current)return;
   await onAdd(`data:image/png;base64,${base64}`);
   // Stay locked after success until the parent closes the editor: never add twice.
  }catch(e){
   if(active.current&&token===operation.current){inFlight.current=false;setSaving(false);setError(e instanceof Error?e.message:'Could not add drawing. Please try again.');}
  }
 }
 const undoDisabled=saving||!strokes.length,redoDisabled=saving||!redo.length;
 const size=paper??canvas,fit=fitPaper(canvas,size);
 return <Modal visible={visible} animationType="slide" onRequestClose={requestCancel} statusBarTranslucent>
  <SafeAreaView style={s.root}>
   <View style={{marginHorizontal:-12}}><SectionHeading title="Drawing" leading={<SectionAction label="Cancel drawing" text="Cancel" disabled={saving} onPress={requestCancel}/>}><SectionAction label="Add drawing" text="Add" primary busy={saving} disabled={!hasContent||saving} onPress={()=>void add()}/></SectionHeading></View>
   <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.toolbar}><View style={s.tools}><Pressable accessibilityRole="button" accessibilityLabel="Undo" accessibilityState={{disabled:undoDisabled}} disabled={undoDisabled} onPress={undo} style={[s.tool,undoDisabled&&s.disabled]}><RotateCcw size={21} color={colors.foreground}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Redo" accessibilityState={{disabled:redoDisabled}} disabled={redoDisabled} onPress={redoLast} style={[s.tool,redoDisabled&&s.disabled]}><RotateCw size={21} color={colors.foreground}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Eraser" accessibilityState={{selected:erasing,disabled:saving}} disabled={saving} onPress={()=>setErasing(!erasing)} style={[s.pill,erasing&&s.selected]}><Text style={s.toolText}>Eraser</Text></Pressable>{palette.map(item=><Pressable key={item.value} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{selected:color===item.value&&!erasing,disabled:saving}} disabled={saving} onPress={()=>{setColor(item.value);setErasing(false);}} style={[s.pill,color===item.value&&!erasing&&s.selected]}><Text style={s.toolText}>{item.label}</Text></Pressable>)}</View></ScrollView>
   <View style={s.widthRow}><Text style={s.widthLabel}>Width</Text>{[3,5,8].map(value=><Pressable key={value} accessibilityRole="button" accessibilityLabel={`Pen width ${value}`} accessibilityState={{selected:penWidth===value,disabled:saving}} disabled={saving} onPress={()=>setPenWidth(value)} style={[s.widthChoice,penWidth===value&&s.selected]}><View style={{width:value+5,height:value+5,borderRadius:12,backgroundColor:colors.foreground}}/></Pressable>)}</View>
   {saving&&<Text accessibilityLiveRegion="polite" style={s.feedback}>Adding drawing…</Text>}
   {!!error&&<Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.feedback}>{error} Your drawing is still here.</Text>}
   <View onLayout={event=>{const layout=event.nativeEvent.layout;viewport.current={width:layout.width,height:layout.height};setCanvas(viewport.current);}} style={s.canvas} {...responder.panHandlers} accessibilityLabel="Drawing canvas" accessibilityRole="image">
    <Svg ref={svgRef} pointerEvents="none" width={fit.width} height={fit.height} style={{position:'absolute',left:fit.left,top:fit.top}} viewBox={`0 0 ${Math.max(1,size.width)} ${Math.max(1,size.height)}`} preserveAspectRatio="xMidYMid meet">
     <Path d={`M0 0 H${size.width} V${size.height} H0 Z`} fill="#ffffff"/>
     {strokes.map((stroke,index)=><Path key={index} d={pathFor(stroke)} stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" fill="none"/>)}
    </Svg>
   </View>
  </SafeAreaView>
 </Modal>;
}
const sTheme=themed(({colors,menuChrome})=>StyleSheet.create({root:{flex:1,backgroundColor:colors.background,paddingHorizontal:12},toolbar:{flexGrow:0,flexShrink:0},tools:{minHeight:64,flexDirection:'row',alignItems:'center',gap:8,paddingVertical:8},tool:{...menuChrome.control,height:48,width:48,alignItems:'center',justifyContent:'center'},pill:{...menuChrome.control,minHeight:48,minWidth:48,paddingHorizontal:12,justifyContent:'center'},selected:{...menuChrome.selected},disabled:{opacity:0.4},toolText:{fontSize:14,color:colors.foreground},widthRow:{minHeight:56,flexShrink:0,flexDirection:'row',alignItems:'center',justifyContent:'space-around'},widthLabel:{fontSize:16,color:colors.foreground},widthChoice:{...menuChrome.control,width:48,height:48,alignItems:'center',justifyContent:'center'},feedback:{fontSize:14,lineHeight:20,color:colors.foreground,paddingBottom:8},canvas:{flex:1,minHeight:0,width:'100%',maxWidth:680,alignSelf:'center',marginBottom:12,backgroundColor:colors.surface,overflow:'hidden'}}));
