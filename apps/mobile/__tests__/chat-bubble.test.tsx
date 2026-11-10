import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {StyleSheet,Text,View} from 'react-native';
import {ChatBubble,needsWideBubble} from '../components/chat-bubble';
import {ThemeContext,tokens} from '../theme-context';

test.each(['light','dark'] as const)('%s chat distinguishes outgoing, incoming and unboxed activity',async scheme=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><View><ChatBubble variant="owner"><Text>My message</Text></ChatBubble><ChatBubble><Text>Bob reply</Text></ChatBubble><ChatBubble variant="activity"><Text>Tool result</Text></ChatBubble><ChatBubble variant="upload"><Text>My upload</Text></ChatBubble></View></ThemeContext.Provider>);});
 const style=(id:string)=>StyleSheet.flatten(tree.root.findByProps({testID:id}).props.style);
 expect(style('chat-bubble-owner')).toMatchObject({alignSelf:'flex-end',maxWidth:'90%',backgroundColor:tokens[scheme].colors.ownerBubble,borderBottomRightRadius:6});
 expect(style('chat-bubble-assistant')).toMatchObject({alignSelf:'stretch',marginRight:12,backgroundColor:tokens[scheme].colors.assistantBubble,borderBottomLeftRadius:6});
 expect(style('chat-bubble-activity').backgroundColor).toBeUndefined();
 expect(style('chat-bubble-upload')).toMatchObject({alignSelf:'flex-end',maxWidth:'100%'});
 expect(style('chat-bubble-upload').backgroundColor).toBeUndefined();
 for(const id of ['chat-bubble-owner','chat-bubble-assistant','chat-bubble-activity']){
  expect(style(id).boxShadow).toBeUndefined();expect(style(id).elevation).toBeUndefined();expect(style(id).height).toBeUndefined();expect(style(id).overflow).toBeUndefined();expect(style(id).minWidth).toBe(0);
 }
 await act(async()=>tree.unmount());
});

test('theme changes preserve message children, and wide replies reclaim the side gutter',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const render=(scheme:'light'|'dark',wide=false)=><ThemeContext.Provider value={tokens[scheme]}><ChatBubble wide={wide}><Text selectable>Retained content</Text></ChatBubble></ThemeContext.Provider>;
 await act(async()=>{tree=Renderer.create(render('dark'));});const text=tree.root.findByType(Text),bubble=tree.root.findByProps({testID:'chat-bubble-assistant'});
 await act(async()=>tree.update(render('light',true)));
 expect(tree.root.findByType(Text)).toBe(text);expect(tree.root.findByProps({testID:'chat-bubble-assistant'})).toBe(bubble);
 expect(StyleSheet.flatten(bubble.props.style)).toMatchObject({marginRight:0,backgroundColor:tokens.light.colors.assistantBubble});
 await act(async()=>tree.unmount());
});

test.each(['```python\nprint(1)\n```','~~~js\nconst value=1\n~~~','| Name | Price |\n| --- | --- |\n| Item | 20 |','Name | Price\n--- | ---\nItem | 20'])('code/table replies use the wider reading column: %s',text=>{
 expect(needsWideBubble(text)).toBe(true);
});
test.each(['A normal answer.','Use `inline code` here.','Here is a longer paragraph\nwith another line.'])('ordinary prose keeps messenger alignment: %s',text=>expect(needsWideBubble(text)).toBe(false));

test.each(['light','dark'] as const)('%s filled bubbles scope secondary ink without changing flat rows or child identity',async scheme=>{
 const Probe=()=>{const theme=React.useContext(ThemeContext);return <Text testID="secondary-copy" style={{color:theme.colors.muted}}>Secondary text</Text>;};
 let tree!:Renderer.ReactTestRenderer;
 const render=(variant:'assistant'|'owner'|'activity'|'upload')=><ThemeContext.Provider value={tokens[scheme]}><ChatBubble variant={variant}><Probe/></ChatBubble></ThemeContext.Provider>;
 await act(async()=>{tree=Renderer.create(render('assistant'));});const child=tree.root.findByProps({testID:'secondary-copy'});
 for(const variant of ['assistant','owner','activity','upload'] as const){
  await act(async()=>tree.update(render(variant)));
  expect(tree.root.findByProps({testID:'secondary-copy'})).toBe(child);
  expect(StyleSheet.flatten(child.props.style).color).toBe(variant==='assistant'||variant==='owner'?tokens[scheme].colors.bubbleMuted:tokens[scheme].colors.muted);
 }
 await act(async()=>tree.unmount());
});
