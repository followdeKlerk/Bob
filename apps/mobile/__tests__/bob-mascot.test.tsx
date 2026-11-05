const mockSharedValues:Array<{value:number}>=[];
jest.mock('react-native-reanimated',()=>({
 __esModule:true,default:{createAnimatedComponent:(component:any)=>component},
 ReduceMotion:{System:'system'},Easing:{linear:(value:number)=>value},
 cancelAnimation:jest.fn(),
 useSharedValue:(value:number)=>{const ref=require('react').useRef(null);if(!ref.current){ref.current={value};mockSharedValues.push(ref.current);}return ref.current;},
 useAnimatedProps:(fn:any,_deps:any,adapter:any)=>({...fn(),__evaluate:fn,__adapt:adapter}),
 withTiming:jest.fn((value:number)=>value),
 withRepeat:jest.fn((value:number)=>value),
 interpolate:(value:number,inputs:number[],outputs:number[])=>{
  let i=0;while(i<inputs.length-2&&value>inputs[i+1])i++;
  return outputs[i]+(value-inputs[i])/(inputs[i+1]-inputs[i])*(outputs[i+1]-outputs[i]);
 },
}));
jest.mock('react-native-svg',()=>{const create=require('react').createElement;const component=(name:string)=>(props:any)=>create(name,props,props.children);return{__esModule:true,default:component('Svg'),Path:component('Path'),Circle:component('Circle'),G:component('G')};});
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AccessibilityInfo,AppState,Platform} from 'react-native';
import {cancelAnimation,withRepeat,withTiming} from 'react-native-reanimated';
import {BobMascot,type BobMascotState} from '../components/bob-mascot';

const states:BobMascotState[]=['idle','tap','open','working','done','attention'];
const expected={
 idle:['M39 44 Q30 48 26 59 M41 44 Q51 48 54 58','M40 64 L32 81 M40 64 L49 81','M35 29 Q40 32 45 29',-5,0],
 tap:['M38 45 L27 39 L23 30 M42 45 L53 38 L57 29','M40 64 L30 76 L25 77 M40 64 L50 76 L55 77','M35 28 Q40 35 45 28',6,0],
 open:['M38 45 L28 52 L23 49 M42 45 L54 46 L61 39','M40 64 L34 81 M40 64 L50 80','M35 29 Q40 33 45 28',10,1],
 working:['M38 45 L27 56 L40 59 M42 45 L51 44 L49 31','M40 64 L33 81 M40 64 L48 81','M37 30 L43 29',-9,-1],
 done:['M38 45 L29 52 L26 59 M42 45 L53 35 L53 20','M40 64 L32 81 M40 64 L48 81','M35 28 Q40 34 45 28',7,0],
 attention:['M38 45 L28 51 L20 43 M42 45 L52 51 L60 43','M40 64 L32 81 M40 64 L48 81','M36 31 Q40 28 44 31',-7,0],
} as const;
let tree:Renderer.ReactTestRenderer|undefined;
let lifecycle:Record<string,(value?:any)=>void>;
let motion:(value:boolean)=>void;
let removals:jest.Mock[];
const host=(type:string,id?:string)=>tree!.root.findAll(node=>node.type===type as any&&(!id||node.props.testID===id));
const shape=(id:string)=>host('Path',`bob-mascot-${id}`)[0];
const group=(id:string)=>host('G',`bob-mascot-${id}`)[0];
const matrix=(id:string)=>group(id).props.animatedProps.__evaluate().transform as number[];
async function mount(state:BobMascotState='idle',animated=true,insideModal=false){await act(async()=>{tree=Renderer.create(<BobMascot state={state} animated={animated} insideModal={insideModal}/>);});}
async function update(state:BobMascotState,animated=true,insideModal=false){await act(async()=>tree!.update(<BobMascot state={state} animated={animated} insideModal={insideModal}/>));}
function clearMotion(){(withRepeat as jest.Mock).mockClear();(withTiming as jest.Mock).mockClear();(cancelAnimation as jest.Mock).mockClear();}
beforeEach(()=>{
 jest.clearAllMocks();mockSharedValues.length=0;lifecycle={};removals=[];
 jest.replaceProperty(Platform,'OS','android');
 AppState.currentState='active';
 jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);
 jest.spyOn(AccessibilityInfo,'addEventListener').mockImplementation((_event,listener)=>{motion=listener;const remove=jest.fn();removals.push(remove);return{remove};});
 jest.spyOn(AppState,'addEventListener').mockImplementation((event,listener)=>{lifecycle[event]=listener as (value?:any)=>void;const remove=jest.fn();removals.push(remove);return{remove};});
});
afterEach(async()=>{if(tree){await act(async()=>tree!.unmount());tree=undefined;}jest.restoreAllMocks();});

test.each(states)('%s renders the actual approved pose on one decorative 40×48 SVG',async state=>{
 await mount(state,false);
 const svg=host('Svg');expect(svg).toHaveLength(1);
 expect(svg[0].props).toMatchObject({width:40,height:48,viewBox:'0 0 80 96',fill:'none',pointerEvents:'none',accessible:false,accessibilityElementsHidden:true,importantForAccessibility:'no-hide-descendants'});
 expect(svg[0].props.x).toBeUndefined();expect(svg[0].props.y).toBeUndefined();
 expect(group('figure').props).toMatchObject({stroke:'#e8e0d2',strokeWidth:3,strokeLinecap:'round',strokeLinejoin:'round'});
 const [arms,legs,mouth,tilt,eye]=expected[state];
 expect(['left','right'].map(side=>shape(`${side}-arm-path`).props.d).join(' ')).toBe(arms);expect(shape('legs').props.d).toBe(legs);expect(shape('mouth').props.d).toBe(mouth);
 expect(shape('body').props.d).toBe(`M40 39 Q${state==='working'?37:40} 52 40 64`);
 expect(group('head').props.transform).toBe(`rotate(${tilt} 40 24)`);
 expect(host('Circle').map(node=>({cx:node.props.cx,cy:node.props.cy,r:node.props.r}))).toEqual([{cx:40,cy:24,r:14},{cx:35+eye,cy:23,r:1.65},{cx:45+eye,cy:23,r:1.65}]);
 expect(host('Circle')[0].props.fill).toBe('none');
 expect(host('Path','bob-mascot-brows')).toHaveLength(state==='attention'?1:0);
 expect(tree!.root.findAll(node=>node.props.onPress||node.props.accessibilityLabel||node.props.accessibilityLiveRegion)).toHaveLength(0);
 expect(withTiming).not.toHaveBeenCalled();expect(withRepeat).not.toHaveBeenCalled();
});

test('stays still until preference resolves, then breathes and blinks on the UI thread',async()=>{
 let resolve!:(value:boolean)=>void;
 (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockReturnValue(new Promise<boolean>(done=>{resolve=done;}));
 await mount();expect(withTiming).not.toHaveBeenCalled();
 await act(async()=>resolve(false));
 expect((withTiming as jest.Mock).mock.calls.map(call=>call[1].duration)).toEqual([3600,5300]);
 expect((withRepeat as jest.Mock).mock.calls.map(call=>call[1])).toEqual([-1,-1]);
 mockSharedValues[0].value=.5;mockSharedValues[1].value=.88;
 expect(matrix('figure')[3]).toBeCloseTo(1.035);expect(matrix('eyes')[3]).toBeCloseTo(.08);
 const props=group('figure').props.animatedProps;
 const adapted={...props.__evaluate()};props.__adapt(adapted);
 expect(adapted.matrix).toEqual(matrix('figure'));expect(adapted.transform).toBeUndefined();
 // Mutating shared phase does not schedule React renders or new animations.
 expect(withTiming).toHaveBeenCalledTimes(2);
});

test.each(['open','working','attention'] as const)('%s runs one slow repeating phase with the approved gesture',async state=>{
 await mount(state);
 expect(withRepeat).toHaveBeenCalledTimes(1);expect(withRepeat).toHaveBeenCalledWith(1,-1,false,undefined,'system');
 expect(withTiming).toHaveBeenCalledWith(1,expect.objectContaining({duration:{open:2600,working:3200,attention:3000}[state],reduceMotion:'system'}));
 mockSharedValues[0].value=0;const rest=matrix(state==='working'?'head':'figure');
 mockSharedValues[0].value={open:.25,working:.5,attention:.5}[state];
 const gesture=matrix(state==='working'?'head':'figure');expect(gesture).not.toEqual(rest);
 if(state==='attention')expect(gesture[5]).toBeCloseTo(-1.8);
 if(state==='working')expect(gesture[1]).toBeCloseTo(Math.sin(-17*Math.PI/180));
});

test('tap pops once; done waves twice then remains neutral, with no visibility-triggered replay',async()=>{
 await mount('tap');expect(withTiming).toHaveBeenCalledTimes(1);expect(withRepeat).not.toHaveBeenCalled();
 expect(withTiming).toHaveBeenCalledWith(1,expect.objectContaining({duration:650}));
 mockSharedValues[0].value=.22;expect(matrix('figure')[0]).toBeCloseTo(1.1);expect(matrix('figure')[3]).toBeCloseTo(.8);
 mockSharedValues[0].value=1;expect(matrix('figure')).toEqual([1,0,-0,1,0,0]);
 clearMotion();act(()=>lifecycle.blur());act(()=>lifecycle.focus());
 expect(withTiming).not.toHaveBeenCalled();expect(withRepeat).not.toHaveBeenCalled();
 await update('done');expect(withTiming).toHaveBeenCalledTimes(1);
 expect(withRepeat).toHaveBeenCalledWith(1,2,false,undefined,'system');
 mockSharedValues[0].value=1;expect(matrix('figure')).toEqual([1,0,-0,1,0,0]);
 clearMotion();act(()=>motion(true));act(()=>motion(false));await update('done',false);await update('done',true);
 expect(withTiming).not.toHaveBeenCalled();
 await update('idle');clearMotion();await update('tap');expect(withTiming).toHaveBeenCalledTimes(1);
});

test('animated=false, background/inactive, Android blur and reduced motion cancel every loop without hiding the art',async()=>{
 await mount();
 const stop=(event:()=>void)=>{clearMotion();act(event);expect(cancelAnimation).toHaveBeenCalled();expect(withTiming).not.toHaveBeenCalled();expect(withRepeat).not.toHaveBeenCalled();expect(mockSharedValues.map(value=>value.value)).toEqual([0,0]);expect(host('Svg')).toHaveLength(1);};
 stop(()=>lifecycle.blur());
 await update('open');expect(withTiming).not.toHaveBeenCalled();
 act(()=>lifecycle.focus());expect(withTiming).toHaveBeenCalledTimes(1);
 stop(()=>lifecycle.change('background'));
 // A focus event cannot bypass the active-state gate.
 act(()=>lifecycle.focus());expect(withTiming).not.toHaveBeenCalled();
 act(()=>lifecycle.change('active'));expect(withTiming).toHaveBeenCalledTimes(1);
 stop(()=>lifecycle.change('inactive'));act(()=>lifecycle.change('active'));
 stop(()=>motion(true));await update('working');expect(withTiming).not.toHaveBeenCalled();
 act(()=>motion(false));expect(withTiming).toHaveBeenCalledTimes(1);
 clearMotion();await update('working',false);expect(withTiming).not.toHaveBeenCalled();expect(cancelAnimation).toHaveBeenCalled();
 await update('attention',false);expect(withTiming).not.toHaveBeenCalled();
 await update('attention',true);expect(withTiming).toHaveBeenCalledTimes(1);
});

test.each(states)('%s stays static when the fetched reduce-motion preference is enabled',async state=>{
 (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
 await mount(state);expect(withTiming).not.toHaveBeenCalled();expect(withRepeat).not.toHaveBeenCalled();
 expect(mockSharedValues.map(value=>value.value)).toEqual([0,0]);
});

test('a dynamic reduce-motion event wins over a stale fetch; failures stay static',async()=>{
 let resolve!:(value:boolean)=>void;
 (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockReturnValue(new Promise<boolean>(done=>{resolve=done;}));
 await mount();act(()=>motion(true));await act(async()=>resolve(false));expect(withTiming).not.toHaveBeenCalled();
 act(()=>motion(false));expect(withTiming).toHaveBeenCalledTimes(2);
 await act(async()=>tree!.unmount());tree=undefined;clearMotion();
 (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockRejectedValue(new Error('unavailable'));
 await mount();expect(withTiming).not.toHaveBeenCalled();
});

test('starts static when already backgrounded and removes every listener / animation on unmount',async()=>{
 AppState.currentState='background';await mount();expect(withTiming).not.toHaveBeenCalled();
 act(()=>lifecycle.change('active'));expect(withRepeat).toHaveBeenCalledTimes(2);
 clearMotion();await act(async()=>tree!.unmount());tree=undefined;
 expect(cancelAnimation).toHaveBeenCalledTimes(2);expect(removals).toHaveLength(4);removals.forEach(remove=>expect(remove).toHaveBeenCalledTimes(1));
});

test('modal art ignores Activity focus but still pauses for AppState, visibility and reduced motion',async()=>{
 await mount('open',true,true);
 expect(Object.keys(lifecycle)).toEqual(['change']);expect(withRepeat).toHaveBeenCalledTimes(1);
 clearMotion();act(()=>lifecycle.change('background'));
 expect(cancelAnimation).toHaveBeenCalled();expect(withTiming).not.toHaveBeenCalled();expect(mockSharedValues.map(value=>value.value)).toEqual([0,0]);
 act(()=>lifecycle.change('active'));expect(withRepeat).toHaveBeenCalledTimes(1);
 clearMotion();act(()=>lifecycle.change('inactive'));expect(withTiming).not.toHaveBeenCalled();
 act(()=>lifecycle.change('active'));expect(withRepeat).toHaveBeenCalledTimes(1);
 clearMotion();await update('open',false,true);expect(cancelAnimation).toHaveBeenCalled();expect(withTiming).not.toHaveBeenCalled();
 await update('open',true,true);expect(withRepeat).toHaveBeenCalledTimes(1);
 clearMotion();act(()=>motion(true));expect(cancelAnimation).toHaveBeenCalled();expect(withTiming).not.toHaveBeenCalled();
 act(()=>motion(false));expect(withRepeat).toHaveBeenCalledTimes(1);
 expect(host('Svg')).toHaveLength(1);expect(Object.keys(lifecycle)).toEqual(['change']);
 await act(async()=>tree!.unmount());tree=undefined;
 expect(removals).toHaveLength(2);removals.forEach(remove=>expect(remove).toHaveBeenCalledTimes(1));
});

test('switching an already blurred copy into a modal releases the Activity focus gate and listeners',async()=>{
 await mount('open');act(()=>lifecycle.blur());clearMotion();
 await update('open',true,true);
 expect(withRepeat).toHaveBeenCalledTimes(1);
 // The preference and lifecycle listeners remain; both Activity listeners leave.
 expect(removals[0]).not.toHaveBeenCalled();expect(removals[1]).not.toHaveBeenCalled();
 expect(removals[2]).toHaveBeenCalledTimes(1);expect(removals[3]).toHaveBeenCalledTimes(1);
});

test('does not subscribe to Android-only focus events on iOS',async()=>{
 jest.replaceProperty(Platform,'OS','ios');await mount('open');
 expect(Object.keys(lifecycle)).toEqual(['change']);expect(withRepeat).toHaveBeenCalledTimes(1);
});

// Sample the real M/L/Q path geometry, including quadratic bends and stroke.
function pathPoints(d:string):number[][]{
 const tokens=d.match(/[MLQ]|-?\d+(?:\.\d+)?/g)!;const result:number[][]=[];let point=[0,0],i=0;
 while(i<tokens.length){
  const command=tokens[i++],next=[Number(tokens[i++]),Number(tokens[i++])];
  if(command==='Q'){
   const end=[Number(tokens[i++]),Number(tokens[i++])];
   for(let t=0;t<=1;t+=.05)result.push(point.map((n,axis)=>(1-t)**2*n+2*(1-t)*t*next[axis]+t*t*end[axis]));
   point=end;result.push(end);
  }else{point=next;result.push(point);}
 }
 return result;
}
const apply=(m:number[],p:number[])=>[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]];
test.each(states)('%s stays inside the actual viewport through the entire motion, including strokes',async state=>{
 await mount(state);
 const bodyPoints=['body','legs'].flatMap(id=>pathPoints(shape(id).props.d).flatMap(p=>[-1.5,1.5].flatMap(dx=>[-1.5,1.5].map(dy=>[p[0]+dx,p[1]+dy]))));
 // Head's circular envelope includes the face and its rotated stroke.
 const armPoints=['left','right'].map(side=>({side,points:pathPoints(shape(`${side}-arm-path`).props.d).flatMap(p=>[-1.5,1.5].flatMap(dx=>[-1.5,1.5].map(dy=>[p[0]+dx,p[1]+dy])))}));
 const headPoints=Array.from({length:72},(_,i)=>[40+15.5*Math.cos(i*Math.PI/36),24+15.5*Math.sin(i*Math.PI/36)]);
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(let step=0;step<=1000;step++){
  mockSharedValues[0].value=step/1000;
  const figure=matrix('figure'),head=matrix('head');
  const limbs=armPoints.flatMap(({side,points})=>{const arm=matrix(`${side}-arm`);return points.map(p=>apply(arm,p));});
  const points=[...bodyPoints,...limbs,...headPoints.map(p=>apply(head,p))].map(p=>apply(figure,p));
  for(const [x,y] of points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
 }
 expect(minX).toBeGreaterThan(0);expect(maxX).toBeLessThan(80);expect(minY).toBeGreaterThan(0);expect(maxY).toBeLessThan(96);
});

// These sample geometry across repeated cycles, not Reanimated/native drawing.
// A rendered native recording remains necessary to verify actual frame delivery.
test.each(['idle','open','working','attention'] as const)('%s visibly articulates across three cycles without a long frozen hold',async state=>{
 await mount(state);
 const duration={idle:3600,open:2600,working:3200,attention:3000}[state];
 const tip={idle:[54,58],open:[61,39],working:[49,31],attention:[60,43]}[state];
 const trace=Array.from({length:73},(_,step)=>{
  mockSharedValues[0].value=(step%24)/24;
  return apply(matrix('figure'),apply(matrix('right-arm'),tip)).map(n=>n/2);
 });
 const spread=(points:number[][])=>Math.max(...[0,1].map(axis=>Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis]))));
 for(let cycle=0;cycle<3;cycle++)expect(spread(trace.slice(cycle*24,cycle*24+24))).toBeGreaterThan({idle:.7,open:4,working:1,attention:2.5}[state]);
 const window=Math.ceil(800/duration*24)+1;
 for(let start=0;start+window<=trace.length;start++)expect(spread(trace.slice(start,start+window))).toBeGreaterThan(.15);
 // The cycle wraps smoothly, and pausing motion retains the approved base pose.
 mockSharedValues[0].value=1;const end=matrix('right-arm');
 mockSharedValues[0].value=0;const start=matrix('right-arm');
 end.forEach((n,i)=>expect(n).toBeCloseTo(start[i],8));
 await update(state,false);matrix('right-arm').forEach((n,i)=>expect(n).toBeCloseTo([1,0,0,1,0,0][i],8));
});

test('done articulates the raised arm as a finite wave rather than only tipping the whole figure',async()=>{
 await mount('done');mockSharedValues[0].value=.25;expect(matrix('right-arm')[1]).toBeCloseTo(Math.sin(18*Math.PI/180));
 mockSharedValues[0].value=.75;expect(matrix('right-arm')[1]).toBeCloseTo(Math.sin(-18*Math.PI/180));
 mockSharedValues[0].value=1;matrix('right-arm').forEach((n,i)=>expect(n).toBeCloseTo([1,0,0,1,0,0][i],8));
 expect(withRepeat).toHaveBeenCalledWith(1,2,false,undefined,'system');
});
