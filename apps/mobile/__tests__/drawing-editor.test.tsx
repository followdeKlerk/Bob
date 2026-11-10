import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert,Modal,PanResponder,StyleSheet} from 'react-native';
import {DrawingEditor} from '../components/drawing-editor';
import {SectionHeading,SectionActions} from '../components/section-ui';
import {colors} from '../theme';

const mockExport=jest.fn();
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:'SafeAreaView'}));
jest.mock('lucide-react-native',()=>({RotateCcw:()=>null,RotateCw:()=>null}));
jest.mock('react-native-svg',()=>{
 const {forwardRef,useImperativeHandle,createElement:mockElement}=require('react');
 return {__esModule:true,default:forwardRef((props:any,ref:any)=>{useImperativeHandle(ref,()=>({toDataURL:mockExport}));return mockElement('Svg',props,props.children);}),Path:'Path',Defs:'Defs',LinearGradient:'LinearGradient',Rect:'Rect',Stop:'Stop'};
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
const svg=()=>tree.root.findAllByType('Svg' as any).find(node=>node.props.viewBox)!;
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


test('drawing keeps Cancel left and primary Add right in a separate bottom footer with borderless controls while paper stays unoutlined',async()=>{
 await mount();
 const cancel=find(tree,'Cancel drawing'),add=find(tree,'Add drawing');
 const header=tree.root.findByType(SectionHeading);
 expect(header.props.title).toBe('Drawing');
 expect(header.findAllByProps({accessibilityLabel:'Cancel drawing'})).toHaveLength(0);
 const footer=tree.root.findByType(SectionActions);
 expect(header.props.children).toBeUndefined();
 expect(canvas(tree).findAllByProps({testID:'section-footer'})).toHaveLength(0);
 expect(StyleSheet.flatten(canvas(tree).props.style)).toMatchObject({flex:1,minHeight:0});
 const host=canvas(tree).parent!;
 let footerBranch=footer;while(footerBranch.parent&&footerBranch.parent!==host)footerBranch=footerBranch.parent;
 expect(footerBranch.parent).toBe(host);
 expect(host.children.indexOf(canvas(tree))).toBeLessThan(host.children.indexOf(footerBranch));
 for(const label of ['Undo','Redo','Eraser','Pen width 3'])expect(footer.findAllByProps({accessibilityLabel:label})).toHaveLength(0);
 expect(footer.findByProps({testID:'section-footer-leading'}).findAll(node=>node.props.accessibilityLabel==='Cancel drawing').length).toBeGreaterThan(0);
 expect(footer.findByProps({testID:'section-footer-actions'}).findAll(node=>node.props.accessibilityLabel==='Add drawing').length).toBeGreaterThan(0);
 expect(StyleSheet.flatten(header.findAllByType(require('react-native').View)[0].props.style)).toMatchObject({paddingHorizontal:16,paddingTop:28,paddingBottom:8});
 for(const label of ['Cancel drawing','Undo','Redo','Eraser','Red','Pen width 3']){
  expect(StyleSheet.flatten(find(tree,label).props.style)).toMatchObject({minHeight:48,minWidth:48});
 }
 expect(StyleSheet.flatten(add.props.style)).toMatchObject({minHeight:48,minWidth:48,backgroundColor:colors.surface,borderRadius:999,borderWidth:1});
 expect(StyleSheet.flatten(canvas(tree).props.style).borderWidth).toBeUndefined();
 expect(tree.root.findAllByType('Path' as any)[0].props.fill).toBe('#ffffff');
 await act(async()=>find(tree,'Eraser').props.onPress());
 expect(StyleSheet.flatten(find(tree,'Eraser').props.style)).toMatchObject({borderRadius:999,backgroundColor:colors.selectedSurface});
});


test('non-scroll drawing paper stays outside measured controls while its strokes and canvas identity survive footer wrapping',async()=>{
 await mount();await draw();
 const paper=canvas(tree),before=ink(tree)[0].props.d,overlay=tree.root.findByProps({testID:'section-footer-overlay'});
 act(()=>overlay.props.onLayout({nativeEvent:{layout:{height:176}}}));
 expect(StyleSheet.flatten(paper.props.style).marginBottom).toBe(196);
 expect(canvas(tree)===paper).toBe(true);expect(ink(tree)[0].props.d).toBe(before);
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'section-footer'}).props.style)).toMatchObject({backgroundColor:'transparent',borderTopWidth:0});
 expect(StyleSheet.flatten(overlay.props.style)).toMatchObject({position:'absolute',bottom:0});
});

test('one horizontally reachable toolbar contains history, ink and widths; reflow preserves selected ink and logical coordinates',async()=>{
 await mount();
 const toolbar=tree.root.findByProps({testID:'drawing-toolbar'});
 expect(toolbar.props.horizontal).toBe(true);expect(StyleSheet.flatten(toolbar.props.style)).toMatchObject({flexGrow:0,flexShrink:0});
 for(const label of ['Undo','Redo','Eraser','Black','Red','Blue','Green','Pen width 3','Pen width 5','Pen width 8'])expect(toolbar.findAllByProps({accessibilityLabel:label}).length).toBeGreaterThan(0);
 await act(async()=>find(tree,'Blue').props.onPress());await act(async()=>find(tree,'Pen width 8').props.onPress());await draw(300,170);
 const paper=canvas(tree),path=ink(tree)[0].props.d;
 act(()=>tree.root.findByProps({testID:'section-footer-overlay'}).props.onLayout({nativeEvent:{layout:{height:224}}}));
 await resize(337,100);
 expect(canvas(tree)).toBe(paper);expect(ink(tree)[0].props).toMatchObject({d:path,stroke:'#246bfe',strokeWidth:8});
 expect(find(tree,'Blue').props.accessibilityState.selected).toBe(true);expect(find(tree,'Pen width 8').props.accessibilityState.selected).toBe(true);
 await act(async()=>find(tree,'Eraser').props.onPress());await draw(168.5,50);
 expect(ink(tree)[1].props).toMatchObject({stroke:'#ffffff',strokeWidth:32});
 expect(svg().props.viewBox).toBe('0 0 320 180');
 expect(tree.root.findAllByType(require('../components/app-text').Text).every(node=>node.props.typography==='ui')).toBe(true);
});


test('top edge fade never overlays the non-scrolling paper or its ink',async()=>{
 const {EdgeFade}=require('../components/edge-fade');let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<DrawingEditor visible onCancel={()=>{}} onAdd={async()=>{}}/>);});
 try{
  expect(tree.root.findAllByType(EdgeFade).map(node=>node.props.edge)).toEqual(['bottom']);
  const host=canvas(tree);const before=host;
  act(()=>tree.root.findByProps({testID:'section-footer-overlay'}).props.onLayout({nativeEvent:{layout:{height:160}}}));
  expect(canvas(tree)===before).toBe(true);expect(StyleSheet.flatten(host.props.style).marginBottom).toBe(180);
 }finally{await act(async()=>tree.unmount());}
});
