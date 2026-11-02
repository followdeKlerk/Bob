import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert,Modal,PanResponder,StyleSheet} from 'react-native';
import {DrawingEditor} from '../components/drawing-editor';
import {colors} from '../theme';

const mockExport=jest.fn();
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:'SafeAreaView'}));
jest.mock('lucide-react-native',()=>({RotateCcw:()=>null,RotateCw:()=>null}));
jest.mock('react-native-svg',()=>{
 const {forwardRef,useImperativeHandle,createElement:mockElement}=require('react');
 return {__esModule:true,default:forwardRef((props:any,ref:any)=>{useImperativeHandle(ref,()=>({toDataURL:mockExport}));return mockElement('Svg',props,props.children);}),Path:'Path'};
});
const find=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
const canvas=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(node=>node.props.accessibilityLabel==='Drawing canvas'&&typeof node.props.onLayout==='function')[0];
const ink=(tree:Renderer.ReactTestRenderer)=>tree.root.findAllByType('Path' as any).filter(node=>node.props.stroke);
let tree:Renderer.ReactTestRenderer;
async function mount(onAdd=jest.fn().mockResolvedValue(undefined),onCancel=jest.fn()){
 await act(async()=>{tree=Renderer.create(<DrawingEditor visible onCancel={onCancel} onAdd={onAdd}/>);});
 await act(async()=>canvas(tree).props.onLayout({nativeEvent:{layout:{width:320,height:180}}}));
 return {onAdd,onCancel};
}
async function draw(x=10,y=20){await act(async()=>canvas(tree).props.onTouchStart({nativeEvent:{locationX:x,locationY:y}}));}
async function resize(width:number,height:number){await act(async()=>canvas(tree).props.onLayout({nativeEvent:{layout:{width,height}}}));}
const svg=()=>tree.root.findByType('Svg' as any);
beforeEach(()=>{
 mockExport.mockReset().mockImplementation((callback:(value:string)=>void)=>callback('png'));
 jest.spyOn(PanResponder,'create').mockImplementation((config:any)=>({panHandlers:{onTouchStart:config.onPanResponderGrant,onTouchMove:config.onPanResponderMove,onTouchEnd:config.onPanResponderRelease}} as any));
});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());jest.restoreAllMocks();jest.useRealTimers();});

test('warm safe-area chrome and flexible canvas retain white paper and actual ink, with 48dp controls and disabled history',async()=>{
 await mount();
 expect(StyleSheet.flatten(tree.root.findByType('SafeAreaView' as any).props.style).backgroundColor).toBe(colors.background);
 expect(StyleSheet.flatten(canvas(tree).props.style)).toMatchObject({flex:1,minHeight:0,width:'100%',backgroundColor:colors.surface});
 for(const label of ['Cancel drawing','Add drawing','Undo','Redo','Eraser','Black','Red','Blue','Green','Pen width 3','Pen width 5','Pen width 8']){
  const style=StyleSheet.flatten(find(tree,label).props.style);
  expect(style.minHeight??style.height).toBeGreaterThanOrEqual(48);
  expect(style.minWidth??style.width).toBeGreaterThanOrEqual(48);
 }
 expect(tree.root.findAllByType('Path' as any)[0].props.fill).toBe('#ffffff');
 expect(find(tree,'Undo').props.accessibilityState.disabled).toBe(true);
 expect(find(tree,'Redo').props.accessibilityState.disabled).toBe(true);
 expect(find(tree,'Add drawing').props.disabled).toBe(true);
 await draw();expect(ink(tree)[0].props.stroke).toBe('#111111');expect(ink(tree)[0].props.d).toContain('l0.01,0');
 expect(find(tree,'Undo').props.disabled).toBe(false);
 await act(async()=>find(tree,'Undo').props.onPress());
 expect(ink(tree)).toHaveLength(0);expect(find(tree,'Redo').props.disabled).toBe(false);
 await act(async()=>find(tree,'Redo').props.onPress());expect(ink(tree)).toHaveLength(1);
 await act(async()=>find(tree,'Red').props.onPress());await draw();expect(ink(tree)[1].props.stroke).toBe('#e53935');
});

test('Cancel and Android Back share dirty confirmation, including an undone drawing',async()=>{
 const alert=jest.spyOn(Alert,'alert');const {onCancel}=await mount();
 await act(async()=>tree.root.findByType(Modal).props.onRequestClose());expect(onCancel).toHaveBeenCalledTimes(1);
 await draw();await act(async()=>find(tree,'Cancel drawing').props.onPress());
 expect(alert).toHaveBeenCalledTimes(1);expect(onCancel).toHaveBeenCalledTimes(1);
 const buttons=alert.mock.calls[0][2]!;
 await act(async()=>buttons[0].onPress?.());expect(ink(tree)).toHaveLength(1);
 await act(async()=>find(tree,'Undo').props.onPress());
 await act(async()=>tree.root.findByType(Modal).props.onRequestClose());
 expect(alert).toHaveBeenCalledTimes(2);
 await act(async()=>alert.mock.calls[1][2]![1].onPress?.());expect(onCancel).toHaveBeenCalledTimes(2);
});

test('rapid Add and duplicate SVG callbacks admit once and lock editing/back until asynchronous save finishes',async()=>{
 let resolve!:()=>void;
 const onAdd=jest.fn(()=>new Promise<void>(done=>{resolve=done;}));
 const {onCancel}=await mount(onAdd);await draw();
 mockExport.mockImplementation(callback=>{callback('png');callback('duplicate');});
 const press=find(tree,'Add drawing').props.onPress;
 await act(async()=>{press();press();});
 expect(mockExport).toHaveBeenCalledTimes(1);expect(mockExport.mock.calls[0][1]).toEqual({width:320,height:180});
 expect(onAdd).toHaveBeenCalledTimes(1);expect(onAdd).toHaveBeenCalledWith('data:image/png;base64,png');
 expect(find(tree,'Add drawing').props.accessibilityState.busy).toBe(true);
 expect(find(tree,'Undo').props.disabled).toBe(true);
 await act(async()=>tree.root.findByType(Modal).props.onRequestClose());expect(onCancel).not.toHaveBeenCalled();
 await draw();expect(ink(tree)).toHaveLength(1);
 await act(async()=>resolve());await act(async()=>press());expect(onAdd).toHaveBeenCalledTimes(1);
});

test('save rejection retains strokes, reports the failure and allows an explicit retry',async()=>{
 const onAdd=jest.fn().mockRejectedValueOnce(Error('Storage full')).mockResolvedValueOnce(undefined);
 await mount(onAdd);await draw();
 await act(async()=>find(tree,'Add drawing').props.onPress());
 expect(ink(tree)).toHaveLength(1);expect(find(tree,'Add drawing').props.disabled).toBe(false);
 expect(tree.root.findAll(node=>node.props.accessibilityRole==='alert')[0].props.children.join('')).toContain('Storage full');
 await act(async()=>find(tree,'Add drawing').props.onPress());expect(onAdd).toHaveBeenCalledTimes(2);
});

test.each(['empty','throw','missing'] as const)('%s SVG export reports a recoverable failure without calling onAdd',async mode=>{
 const {onAdd}=await mount();await draw();
 if(mode==='empty')mockExport.mockImplementation(callback=>callback(''));
 if(mode==='throw')mockExport.mockImplementation(()=>{throw Error('Native export failed');});
 if(mode==='missing')await act(async()=>canvas(tree).props.onLayout({nativeEvent:{layout:{width:0,height:0}}}));
 await act(async()=>find(tree,'Add drawing').props.onPress());
 expect(onAdd).not.toHaveBeenCalled();expect(ink(tree)).toHaveLength(1);
 expect(find(tree,'Add drawing').props.disabled).toBe(false);
 expect(tree.root.findAll(node=>node.props.accessibilityRole==='alert').length).toBeGreaterThan(0);
});

test('timed-out export ignores late/duplicate callbacks even after an explicit retry',async()=>{
 jest.useFakeTimers();const {onAdd}=await mount();await draw();
 let late!:(value:string)=>void;
 mockExport.mockImplementation(callback=>{late=callback;});
 await act(async()=>find(tree,'Add drawing').props.onPress());
 await act(async()=>jest.advanceTimersByTime(10000));
 expect(onAdd).not.toHaveBeenCalled();expect(find(tree,'Add drawing').props.disabled).toBe(false);expect(ink(tree)).toHaveLength(1);
 mockExport.mockImplementation(callback=>callback('retry'));
 await act(async()=>find(tree,'Add drawing').props.onPress());
 await act(async()=>{late('late');late('again');});
 expect(onAdd).toHaveBeenCalledTimes(1);expect(onAdd).toHaveBeenCalledWith('data:image/png;base64,retry');
});

test('closing the editor cancels pending export and ignores its late callback',async()=>{
 let callback!:(value:string)=>void;const {onAdd,onCancel}=await mount();await draw();
 mockExport.mockImplementation(value=>{callback=value;});
 await act(async()=>find(tree,'Add drawing').props.onPress());
 await act(async()=>tree.update(<DrawingEditor visible={false} onCancel={onCancel} onAdd={onAdd}/>));
 await act(async()=>callback('late'));expect(onAdd).not.toHaveBeenCalled();
 await act(async()=>tree.update(<DrawingEditor visible onCancel={onCancel} onAdd={onAdd}/>));
 expect(ink(tree)).toHaveLength(0);expect(find(tree,'Add drawing').props.disabled).toBe(true);
});

test('feedback shrink, failed save and rotation preserve logical paper, bottom strokes and retry export; touches map through letterboxing',async()=>{
 const onAdd=jest.fn().mockRejectedValueOnce(Error('Storage full')).mockResolvedValueOnce(undefined);
 await mount(onAdd);await draw(300,170);
 const bottomPath=ink(tree)[0].props.d;
 let exported!:(value:string)=>void;
 mockExport.mockImplementation(callback=>{exported=callback;});
 await act(async()=>find(tree,'Add drawing').props.onPress());
 // Model the layout caused by the new Saving feedback before the native export completes.
 await resize(320,90);
 expect(svg().props).toMatchObject({viewBox:'0 0 320 180',width:160,height:90,preserveAspectRatio:'xMidYMid meet',style:{left:80,top:0}});
 expect(ink(tree)[0].props.d).toBe(bottomPath);
 expect(tree.root.findAllByType('Path' as any)[0].props.d).toBe('M0 0 H320 V180 H0 Z');
 await act(async()=>exported('first'));
 expect(find(tree,'Add drawing').props.disabled).toBe(false);
 // A multiline error can consume even more vertical space. It must still fit, not crop.
 await resize(320,60);
 expect(svg().props.viewBox).toBe('0 0 320 180');
 expect(svg().props.height).toBe(60);expect(svg().props.width).toBeCloseTo(320/3);
 expect(ink(tree)[0].props.d).toBe(bottomPath);
 // Rotate to a tall viewport: fixed paper is centered with top/bottom letterboxing.
 await resize(180,320);
 expect(svg().props).toMatchObject({viewBox:'0 0 320 180',width:180,height:101.25,style:{left:0,top:109.375}});
 expect(ink(tree)[0].props.d).toBe(bottomPath);
 await draw(90,205);expect(ink(tree)[1].props.d).toBe('M160,170 l0.01,0');
 await act(async()=>canvas(tree).props.onTouchMove({nativeEvent:{locationX:135,locationY:199.375}}));
 expect(ink(tree)[1].props.d).toBe('M160,170 L240,160');expect(ink(tree)[1].props.strokeWidth).toBe(5);
 // Letterbox touches cannot create a stroke or append to the previous stroke.
 await draw(10,10);
 await act(async()=>canvas(tree).props.onTouchMove({nativeEvent:{locationX:90,locationY:205}}));
 expect(ink(tree)).toHaveLength(2);expect(ink(tree)[1].props.d).toBe('M160,170 L240,160');
 await act(async()=>find(tree,'Undo').props.onPress());expect(ink(tree)[0].props.d).toBe(bottomPath);
 await act(async()=>find(tree,'Redo').props.onPress());expect(ink(tree)[1].props.d).toBe('M160,170 L240,160');
 mockExport.mockImplementation(callback=>callback('retry'));
 await act(async()=>find(tree,'Add drawing').props.onPress());
 expect(mockExport.mock.calls.map(call=>call[1])).toEqual([{width:320,height:180},{width:320,height:180}]);
 expect(onAdd).toHaveBeenCalledTimes(2);expect(onAdd).toHaveBeenLastCalledWith('data:image/png;base64,retry');
});


test('drawing keeps Cancel left and primary Add right with standard control chrome while paper stays unoutlined',async()=>{
 await mount();
 const cancel=find(tree,'Cancel drawing'),add=find(tree,'Add drawing');
 const header=cancel.parent!;
 expect(header.findAll(node=>typeof node.props.onPress==='function'&&node.props.accessibilityLabel).map(node=>node.props.accessibilityLabel)).toEqual(['Cancel drawing','Add drawing']);
 expect(StyleSheet.flatten(header.props.style)).toMatchObject({paddingHorizontal:20,paddingTop:20,paddingBottom:16,flexDirection:'row',flexWrap:'wrap'});
 for(const label of ['Cancel drawing','Undo','Redo','Eraser','Red','Pen width 3']){
  expect(StyleSheet.flatten(find(tree,label).props.style)).toMatchObject({borderRadius:14,borderWidth:1,borderColor:colors.border});
 }
 expect(StyleSheet.flatten(add.props.style)).toMatchObject({borderRadius:14,borderWidth:1,borderColor:colors.accent,backgroundColor:colors.accent});
 expect(StyleSheet.flatten(canvas(tree).props.style).borderWidth).toBeUndefined();
 expect(tree.root.findAllByType('Path' as any)[0].props.fill).toBe('#ffffff');
 await act(async()=>find(tree,'Eraser').props.onPress());
 expect(StyleSheet.flatten(find(tree,'Eraser').props.style)).toMatchObject({borderRadius:14,borderColor:colors.selectedBorder,backgroundColor:colors.selectedSurface});
});
