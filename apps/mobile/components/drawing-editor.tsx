import {Text} from './app-text';
import React,{useEffect,useMemo,useState} from 'react';
import {Modal,PanResponder,Pressable,ScrollView,StyleSheet,View,useWindowDimensions} from 'react-native';
import Svg,{Path} from 'react-native-svg';
import {RotateCcw,RotateCw} from 'lucide-react-native';
import {colors} from '../theme';

type Stroke={color:string;width:number;points:{x:number;y:number}[]};
const palette=[{label:'Black',value:'#111111'},{label:'Red',value:'#e53935'},{label:'Blue',value:'#246bfe'},{label:'Green',value:'#23935b'}];
function pathFor(stroke:Stroke){return stroke.points.map((point,index)=>`${index?'L':'M'}${point.x},${point.y}`).join(' ');}
export function DrawingEditor({visible,onCancel,onAdd}:{visible:boolean;onCancel:()=>void;onAdd:(pngDataUri:string)=>void}){
 const {width:screenWidth,height:screenHeight}=useWindowDimensions();
 const [strokes,setStrokes]=useState<Stroke[]>([]),[redo,setRedo]=useState<Stroke[]>([]),[color,setColor]=useState('#111111'),[penWidth,setPenWidth]=useState(5),[erasing,setErasing]=useState(false);
 const [canvas,setCanvas]=useState({width:1,height:1});
 const svgRef=React.useRef<any>(null),[hasContent,setHasContent]=useState(false);
 useEffect(()=>{if(!visible){setStrokes([]);setRedo([]);setColor('#111111');setPenWidth(5);setErasing(false);setHasContent(false);}},[visible]);
 const responder=useMemo(()=>PanResponder.create({onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:()=>true,onPanResponderGrant:event=>{const {locationX:x,locationY:y}=event.nativeEvent;setStrokes(previous=>[...previous,{color:erasing?'#ffffff':color,width:erasing?penWidth*4:penWidth,points:[{x,y}]}]);setHasContent(true);setRedo([]);},onPanResponderMove:event=>{const {locationX:x,locationY:y}=event.nativeEvent;setStrokes(previous=>{if(!previous.length)return previous;const updated=[...previous];const last=updated[updated.length-1];updated[updated.length-1]={...last,points:[...last.points,{x,y}]};return updated;});}}),[color,penWidth,erasing]);
 const undo=()=>{if(strokes.length){setRedo(previous=>[...previous,strokes[strokes.length-1]]);const next=strokes.slice(0,-1);setStrokes(next);setHasContent(next.some(stroke=>stroke.points.length>0));}};
 const redoLast=()=>{if(redo.length){setStrokes(previous=>[...previous,redo[redo.length-1]]);setRedo(previous=>previous.slice(0,-1));setHasContent(true);}};
 function add(){const node=svgRef.current;if(!node||!hasContent)return;try{node.toDataURL((base64:string)=>{if(base64)onAdd(`data:image/png;base64,${base64}`);}, {width:canvas.width,height:canvas.height});}catch{}}
 const height=Math.max(300,screenHeight-270),width=Math.min(screenWidth-24,680);
 return <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
  <View style={s.root}><View style={s.header}><Pressable accessibilityRole="button" accessibilityLabel="Cancel drawing" onPress={onCancel} style={s.headerButton}><Text style={s.headerText}>Cancel</Text></Pressable><Text style={s.title}>Drawing</Text><Pressable accessibilityRole="button" accessibilityLabel="Add drawing" accessibilityState={{disabled:!hasContent}} disabled={!hasContent} onPress={add} style={s.headerButton}><Text style={[s.headerText,s.addText,!hasContent&&{opacity:0.45}]}>Add</Text></Pressable></View>
   <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={s.tools}><Pressable accessibilityRole="button" accessibilityLabel="Undo" onPress={undo} style={s.tool}><RotateCcw size={21} color={colors.foreground}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Redo" onPress={redoLast} style={s.tool}><RotateCw size={21} color={colors.foreground}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Eraser" accessibilityState={{selected:erasing}} onPress={()=>setErasing(!erasing)} style={[s.pill,erasing&&s.selected]}><Text style={s.toolText}>Eraser</Text></Pressable>{palette.map(item=><Pressable key={item.value} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{selected:color===item.value&&!erasing}} onPress={()=>{setColor(item.value);setErasing(false);}} style={[s.pill,color===item.value&&!erasing&&s.selected]}><Text style={s.toolText}>{item.label}</Text></Pressable>)}</View></ScrollView>
   <View style={s.widthRow}><Text style={s.widthLabel}>Width</Text>{[3,5,8].map(value=><Pressable key={value} accessibilityRole="button" accessibilityLabel={`Pen width ${value}`} accessibilityState={{selected:penWidth===value}} onPress={()=>setPenWidth(value)} style={[s.widthChoice,penWidth===value&&s.widthChoiceSelected]}><View style={{width:value+5,height:value+5,borderRadius:12,backgroundColor:colors.foreground}}/></Pressable>)}</View>
   <View onLayout={event=>setCanvas({width:event.nativeEvent.layout.width,height:event.nativeEvent.layout.height})} style={[s.canvas,{width,height}]} {...responder.panHandlers} accessibilityLabel="Drawing canvas" accessibilityRole="image">
    <Svg ref={svgRef} width={canvas.width} height={canvas.height} viewBox={`0 0 ${canvas.width} ${canvas.height}`}>
     <Path d={`M0 0 H${canvas.width} V${canvas.height} H0 Z`} fill="#ffffff"/>
     {strokes.map((stroke,index)=>stroke.points.length>0&&<Path key={index} d={pathFor(stroke)} stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" fill="none"/>)}
    </Svg>
   </View>
  </View>
 </Modal>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#050621',paddingTop:20},header:{height:64,paddingHorizontal:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},headerButton:{minWidth:72,minHeight:48,justifyContent:'center'},headerText:{fontSize:17,color:colors.foreground},title:{fontSize:20,fontWeight:'600',color:colors.foreground},addText:{color:'#8eb4ff',textAlign:'right'},tools:{height:70,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:14},tool:{height:46,width:46,borderRadius:23,alignItems:'center',justifyContent:'center',backgroundColor:'#12213f',borderWidth:1,borderColor:'#283a5b'},pill:{minHeight:42,paddingHorizontal:12,justifyContent:'center',borderRadius:22,borderWidth:1,borderColor:'#505066'},selected:{borderColor:'#4182ff',backgroundColor:'#162b54'},toolText:{fontSize:14,color:colors.foreground},widthRow:{height:52,flexDirection:'row',alignItems:'center',justifyContent:'space-around',paddingHorizontal:10},widthLabel:{fontSize:16,color:colors.foreground},widthChoice:{width:44,height:40,alignItems:'center',justifyContent:'center',borderRadius:20},widthChoiceSelected:{backgroundColor:'#263b62'},canvas:{alignSelf:'center',backgroundColor:'#ffffff',overflow:'hidden'},});