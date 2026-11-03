import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {StyleSheet,Text} from 'react-native';
import {ChevronDown,ChevronRight,SquareTerminal} from 'lucide-react-native';
import {CompactActivityRow} from '../components/compact-activity-row';
import {colors} from '../theme';

jest.mock('lucide-react-native',()=>({SquareTerminal:()=>null,ChevronDown:()=>null,ChevronRight:()=>null}));

// NativeWind wraps native Pressable; query its explicit button props, not component identity.
const buttons=(root:Renderer.ReactTestInstance)=>root.findAll(node=>node.props.accessibilityRole==='button'&&typeof node.props.onPress==='function'&&!!node.props.style,{deep:false});

test.each([
 ['done','✓'],['ok','✓'],['completed','✓'],['Completed','✓'],
 ['failed','!'],['error','!'],['Failed','!'],
 ['running','…'],['pending','…'],['queued','…'],['processing','…'],
 ['cancelled','·'],['unknown','·'],['Status unavailable','·'],['surprising state','·'],[undefined,'·'],
])('status %s has a truthful accessible glyph',async(status,glyph)=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<CompactActivityRow title="Activity" status={status} accessibilityLabel="Activity details" expanded={false} onPress={()=>{}}/>);});
 const label=status??'Status unavailable';
 const statusText=tree.root.findAllByType(Text).find(node=>node.props.accessibilityLabel===label)!;
 expect(statusText.props.children).toBe(glyph);
 expect(buttons(tree.root)[0].props.accessibilityHint).toContain(label);
 await act(async()=>tree.unmount());
});

test('the shared header is unboxed, one line, scalable and exposes the contextual toggle action',async()=>{
 const onPress=jest.fn(),props={title:'Agent report',detail:'A very long agent name\nwith a second line',status:'received',accessibilityLabel:'Agent report · explicit name',onPress,count:12};
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<CompactActivityRow {...props} expanded={false}/>);});
 const header=buttons(tree.root)[0],style=StyleSheet.flatten(header.props.style);
 expect(style).toMatchObject({minHeight:48,paddingVertical:6,flexDirection:'row'});
 for(const constraint of ['height','maxHeight','borderWidth','backgroundColor'])expect(style[constraint]).toBeUndefined();
 const title=tree.root.findAllByType(Text).find(node=>node.props.children===props.title)!;
 const detail=tree.root.findAllByType(Text).find(node=>node.props.children===props.detail)!;
 expect(StyleSheet.flatten(title.props.style)).toMatchObject({fontSize:12,lineHeight:18,fontWeight:'600'});
 expect(StyleSheet.flatten(detail.props.style)).toMatchObject({fontSize:12,lineHeight:18,color:colors.muted});
 for(const text of [title,detail]){
  expect(text.props.numberOfLines).toBe(1);
  expect(text.props.ellipsizeMode).toBe('tail');
  expect(text.props.allowFontScaling).not.toBe(false);
  expect(text.props.maxFontSizeMultiplier).toBeUndefined();
 }
 expect(tree.root.findByType(SquareTerminal).props.size).toBe(15);
 expect(tree.root.findAllByType(ChevronRight)).toHaveLength(1);
 expect(header.props.accessibilityLabel).toBe(props.accessibilityLabel);
 expect(header.props.accessibilityState).toEqual({expanded:false});
 expect(header.props.accessibilityHint).toBe(`${props.detail} · received · 12 calls · Expand details`);
 act(()=>header.props.onPress());expect(onPress).toHaveBeenCalledTimes(1);
 await act(async()=>tree.update(<CompactActivityRow {...props} expanded/>));
 expect(header.props.accessibilityState).toEqual({expanded:true});
 expect(header.props.accessibilityHint).toContain('Collapse details');
 expect(tree.root.findAllByType(ChevronDown)).toHaveLength(1);
 await act(async()=>tree.unmount());
});
