import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AccessibilityInfo,AppState} from 'react-native';
import {useChatFollow} from '../use-chat-follow';
let change:(state:string)=>void;
let follow:ReturnType<typeof useChatFollow<any>>;
function Harness({scope,inverted=false}:{scope:string;inverted?:boolean}){follow=useChatFollow(scope,inverted);return null;}
const event=(y:number)=>({nativeEvent:{contentOffset:{y},contentSize:{height:2000},layoutMeasurement:{height:600}}}) as any;
beforeEach(()=>{jest.useFakeTimers();jest.spyOn(AppState,'addEventListener').mockImplementation((_event,callback)=>{change=callback as any;return{remove:jest.fn()};});jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);jest.spyOn(AccessibilityInfo,'addEventListener').mockReturnValue({remove:jest.fn()} as any);});
afterEach(()=>{jest.useRealTimers();jest.restoreAllMocks();});
const flush=()=>act(()=>{jest.advanceTimersByTime(20);});
test('streaming follows immediately, dragging up pauses, returning to bottom resumes',async()=>{
 let tree!:Renderer.ReactTestRenderer;const end=jest.fn();await act(async()=>{tree=Renderer.create(<Harness scope="parent"/>);});(follow.list as any).current={scrollToEnd:end};flush();end.mockClear();
 act(()=>follow.props.onContentSizeChange());flush();expect(end).toHaveBeenCalledWith({animated:false});end.mockClear();
 act(()=>{follow.props.onScrollBeginDrag();follow.props.onScroll(event(800));});expect(follow.showJump).toBe(true);
 act(()=>follow.props.onContentSizeChange());flush();expect(end).not.toHaveBeenCalled();
 act(()=>{follow.props.onScrollEndDrag(event(800));follow.props.onMomentumScrollBegin();follow.props.onScroll(event(400));follow.props.onMomentumScrollEnd(event(400));});
 act(()=>follow.props.onContentSizeChange());flush();expect(end).not.toHaveBeenCalled();
 act(()=>{follow.props.onScrollBeginDrag();follow.props.onScroll(event(1400));follow.props.onScrollEndDrag(event(1400));jest.advanceTimersByTime(151);});
 act(()=>follow.props.onContentSizeChange(300,2300));flush();expect(end).toHaveBeenCalledWith({animated:false});expect(follow.showJump).toBe(false);
 await act(async()=>tree.unmount());
});
test('drag cancels a queued follow and release does not fight an upward fling',async()=>{
 let tree!:Renderer.ReactTestRenderer;const end=jest.fn();await act(async()=>{tree=Renderer.create(<Harness scope="one"/>);});(follow.list as any).current={scrollToEnd:end};flush();end.mockClear();
 act(()=>{follow.props.onContentSizeChange();follow.props.onScrollBeginDrag();});flush();expect(end).not.toHaveBeenCalled();
 act(()=>{follow.props.onScrollEndDrag(event(1399));follow.props.onContentSizeChange();});flush();expect(end).not.toHaveBeenCalled();
 act(()=>{follow.props.onMomentumScrollBegin();follow.props.onScroll(event(900));jest.advanceTimersByTime(200);follow.props.onContentSizeChange();});flush();expect(end).not.toHaveBeenCalled();
 await act(async()=>tree.unmount());
});
test('jump to latest follows explicitly, scope reset follows again, ordinary scroll events do not resume a paused reader',async()=>{
 let tree!:Renderer.ReactTestRenderer;const end=jest.fn();await act(async()=>{tree=Renderer.create(<Harness scope="one"/>);});(follow.list as any).current={scrollToEnd:end};flush();end.mockClear();
 act(()=>{follow.props.onScrollBeginDrag();follow.props.onScroll(event(500));follow.props.onScrollEndDrag(event(500));jest.advanceTimersByTime(151);follow.props.onScroll(event(1400));follow.props.onContentSizeChange();});flush();expect(end).not.toHaveBeenCalled();
 act(()=>follow.resume());flush();expect(end).toHaveBeenCalledWith({animated:true});end.mockClear();
 act(()=>follow.props.onMomentumScrollBegin());act(()=>follow.props.onContentSizeChange(300,2300));flush();expect(end).toHaveBeenCalled();
 act(()=>follow.pause());await act(async()=>tree.update(<Harness scope="two"/>));flush();expect(end).toHaveBeenCalledWith({animated:false});
 await act(async()=>tree.unmount());
});
test('reduced motion disables animated jump',async()=>{
 (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);let tree!:Renderer.ReactTestRenderer;const end=jest.fn();await act(async()=>{tree=Renderer.create(<Harness scope="one"/>);});(follow.list as any).current={scrollToEnd:end};flush();end.mockClear();act(()=>follow.resume());flush();expect(end).toHaveBeenCalledWith({animated:false});await act(async()=>tree.unmount());
});

const layout=(height:number)=>({nativeEvent:{layout:{height}}});
test.each([false,true])('background/foreground and repeated or zero geometry do not replay scrolling (paused: %s)',async(paused)=>{
 let tree!:Renderer.ReactTestRenderer;const end=jest.fn();await act(async()=>{tree=Renderer.create(<Harness scope="one"/>);});(follow.list as any).current={scrollToEnd:end};
 act(()=>{follow.props.onLayout(layout(600));follow.props.onContentSizeChange(300,2000);});flush();
 act(()=>{if(paused)follow.props.onScrollBeginDrag();follow.props.onScroll(event(paused?500:1400));follow.props.onMomentumScrollEnd(event(paused?500:1400));});end.mockClear();
 act(()=>{change('background');follow.props.onLayout(layout(0));follow.props.onContentSizeChange(300,0);follow.props.onScroll(event(0));});flush();expect(end).not.toHaveBeenCalled();
 act(()=>{change('active');follow.props.onLayout(layout(0));follow.props.onContentSizeChange(300,0);follow.props.onLayout(layout(600));follow.props.onContentSizeChange(300,2000);});flush();expect(end).not.toHaveBeenCalled();expect(follow.showJump).toBe(paused);
 await act(async()=>tree.unmount());
});
test.each(['before','during'])('real growth %s background is caught up just once on resume',async(when)=>{
 let tree!:Renderer.ReactTestRenderer;const end=jest.fn();await act(async()=>{tree=Renderer.create(<Harness scope="one"/>);});(follow.list as any).current={scrollToEnd:end};
 act(()=>{follow.props.onLayout(layout(600));follow.props.onContentSizeChange(300,2000);});flush();act(()=>follow.props.onScroll(event(1400)));end.mockClear();
 act(()=>{if(when==='before')follow.props.onContentSizeChange(300,2300);change('background');if(when==='during')follow.props.onContentSizeChange(300,2300);});flush();expect(end).not.toHaveBeenCalled();
 act(()=>{change('active');follow.props.onContentSizeChange(300,2300);follow.props.onLayout(layout(600));});flush();expect(end).toHaveBeenCalledTimes(1);expect(end).toHaveBeenCalledWith({animated:false});
 await act(async()=>tree.unmount());
});
test('new content received in the background does not unpause an older-message reader',async()=>{
 let tree!:Renderer.ReactTestRenderer;const end=jest.fn();await act(async()=>{tree=Renderer.create(<Harness scope="one"/>);});(follow.list as any).current={scrollToEnd:end};flush();
 act(()=>{follow.props.onLayout(layout(600));follow.props.onContentSizeChange(300,2000);follow.props.onScrollBeginDrag();follow.props.onScroll(event(500));follow.props.onMomentumScrollEnd(event(500));});end.mockClear();
 act(()=>{change('background');follow.props.onContentSizeChange(300,2500);change('active');});flush();expect(end).not.toHaveBeenCalled();expect(follow.showJump).toBe(true);
 act(()=>follow.resume());flush();expect(end).toHaveBeenCalledWith({animated:true});await act(async()=>tree.unmount());
});
test('follow uses the native content end, not FlatList last-cell estimates',async()=>{
 let tree!:Renderer.ReactTestRenderer;const estimate=jest.fn(),nativeEnd=jest.fn();await act(async()=>{tree=Renderer.create(<Harness scope="one"/>);});(follow.list as any).current={scrollToEnd:estimate,getScrollResponder:()=>({scrollToEnd:nativeEnd})};
 act(()=>{follow.props.onLayout(layout(600));follow.props.onContentSizeChange(300,2000);});flush();expect(nativeEnd).toHaveBeenCalledWith({animated:false});expect(estimate).not.toHaveBeenCalled();nativeEnd.mockClear();
 act(()=>follow.props.onScroll(event(1400)));act(()=>{follow.props.onLayout(layout(600));follow.props.onContentSizeChange(300,2000);});flush();expect(nativeEnd).not.toHaveBeenCalled();
 act(()=>follow.props.onContentSizeChange(300,2200));flush();expect(nativeEnd).toHaveBeenCalledTimes(1);expect(estimate).not.toHaveBeenCalled();await act(async()=>tree.unmount());
});

const invertedEvent=(offset:number,height=20000)=>({nativeEvent:{contentOffset:{y:offset},contentSize:{height},layoutMeasurement:{height:600}}}) as any;
test.each([1200,2000000])('bottom-anchored cold start has a constant latest offset, independent of content height %s',async(height)=>{
 let tree!:Renderer.ReactTestRenderer;const latest=jest.fn(),end=jest.fn();await act(async()=>{tree=Renderer.create(<Harness scope="first" inverted/>);});(follow.list as any).current={scrollToOffset:latest,scrollToEnd:end};flush();expect(latest).not.toHaveBeenCalled();expect(end).not.toHaveBeenCalled();
 act(()=>{follow.props.onLayout(layout(600));follow.props.onContentSizeChange(300,height);});flush();expect(latest).not.toHaveBeenCalled();expect(end).not.toHaveBeenCalled();
 act(()=>follow.props.onContentSizeChange(300,height+5000));flush();expect(latest).not.toHaveBeenCalled();expect(end).not.toHaveBeenCalled();await act(async()=>tree.unmount());
});
test('bottom-anchored manual reading pauses follow, and jump targets zero rather than the estimated end',async()=>{
 let tree!:Renderer.ReactTestRenderer;const latest=jest.fn(),end=jest.fn();await act(async()=>{tree=Renderer.create(<Harness scope="first" inverted/>);});(follow.list as any).current={scrollToOffset:latest,scrollToEnd:end};
 act(()=>{follow.props.onLayout(layout(600));follow.props.onContentSizeChange(300,20000);});flush();latest.mockClear();
 act(()=>{follow.props.onScrollBeginDrag();follow.props.onScroll(invertedEvent(500));follow.props.onMomentumScrollEnd(invertedEvent(500));});expect(follow.showJump).toBe(true);
 act(()=>follow.props.onContentSizeChange(300,30000));flush();expect(latest).not.toHaveBeenCalled();
 act(()=>follow.resume());flush();expect(latest).toHaveBeenCalledWith({offset:0,animated:true});expect(end).not.toHaveBeenCalled();await act(async()=>tree.unmount());
});
test('switching a bottom-anchored session resets to latest without an end-seeking scroll',async()=>{
 let tree!:Renderer.ReactTestRenderer;const latest=jest.fn(),end=jest.fn();await act(async()=>{tree=Renderer.create(<Harness scope="first" inverted/>);});(follow.list as any).current={scrollToOffset:latest,scrollToEnd:end};
 act(()=>{follow.props.onScrollBeginDrag();follow.props.onScroll(invertedEvent(10000));follow.props.onMomentumScrollEnd(invertedEvent(10000));});expect(follow.showJump).toBe(true);
 await act(async()=>tree.update(<Harness scope="second" inverted/>));flush();expect(follow.showJump).toBe(false);expect(latest).not.toHaveBeenCalled();expect(end).not.toHaveBeenCalled();
 act(()=>follow.props.onContentSizeChange(300,900000));flush();expect(latest).not.toHaveBeenCalled();expect(end).not.toHaveBeenCalled();await act(async()=>tree.unmount());
});
test('oldest-message navigation is deliberately the opposite end in bottom-anchored mode',async()=>{
 let tree!:Renderer.ReactTestRenderer;const latest=jest.fn(),end=jest.fn();await act(async()=>{tree=Renderer.create(<Harness scope="first" inverted/>);});(follow.list as any).current={scrollToOffset:latest,getScrollResponder:()=>({scrollToEnd:end})};
 act(()=>follow.oldest());expect(end).toHaveBeenCalledWith({animated:false});act(()=>follow.props.onScroll(invertedEvent(10000)));expect(follow.showJump).toBe(true);
 act(()=>follow.props.onContentSizeChange(300,900000));flush();expect(latest).not.toHaveBeenCalled();await act(async()=>tree.unmount());
});
