import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Text,Image,Linking,NativeModules,StyleSheet,ScrollView} from 'react-native';
import {CopyAction} from '../components/message-actions';
// Keep the actual Markdown parser, layout rules and clipboard action under test.
jest.mock('lucide-react-native',()=>({Copy:()=>null,Check:()=>null}));
jest.mock('../components/ui/button',()=>({Button:require('react-native').Pressable}));
import {ChatMarkdown} from '../components/chat-markdown';

const flatten=(value:any):string=>typeof value==='string'?value:Array.isArray(value)?value.map(flatten).join(''):value?.children?flatten(value.children):'';
test('assistant Markdown renders headings, emphasis, lists, code, links and tables as native content',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ChatMarkdown text={'# Heading\n\n**Bold** and *italic* with `code`\n\n- First\n- Second\n\n```ts\nconst n = 1;\n```\n\n[Website](https://example.com)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'}/>);});
 const text=flatten(tree.toJSON());
 for(const expected of ['Heading','Bold','italic','code','First','Second','const n = 1;','Website','A','B'])expect(text).toContain(expected);
 expect(text).not.toContain('**');expect(text).not.toContain('```');expect(text).not.toContain('[Website]');
 expect(tree.root.findAllByType(Text).length).toBeGreaterThan(5);
 await act(async()=>tree.unmount());
});
test('streaming partial Markdown is renderable and images never load remotely',async()=>{
 const open=jest.spyOn(Linking,'openURL').mockResolvedValue(undefined);
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ChatMarkdown text={'**Still streaming\n\n![private](https://example.com/tracker.png)'}/>);});
 expect(flatten(tree.toJSON())).toContain('Still streaming');
 expect(tree.root.findAllByType(Image)).toHaveLength(0);
 expect(open).not.toHaveBeenCalled();
 await act(async()=>tree.update(<ChatMarkdown text={'**Still streaming, now complete**'}/>));
 expect(flatten(tree.toJSON())).toContain('Still streaming, now complete');
 expect(flatten(tree.toJSON())).not.toContain('**');
 await act(async()=>tree.unmount());open.mockRestore();
});

const nodes=(tree:Renderer.ReactTestRenderer,id:string)=>tree.root.findAll(node=>node.props.testID===id&&!node.children.some(child=>typeof child!=='string'&&child.props.testID===id));
test('table sections stack inside one scroll child and share fixed column widths across differently sized rows',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const markdown='| Area | Result |\n| :--- | ---: |\n| Repository visibility | Private |\n| Tags | A much longer result that wraps onto multiple lines without shifting any other columns |\n| **Commit** | `main` |';
 await act(async()=>{tree=Renderer.create(<ChatMarkdown text={markdown}/>);});
 const grid=nodes(tree,'markdown-table-grid')[0];
 expect(StyleSheet.flatten(grid.props.style).flexDirection).toBe('column');
 expect(grid.children.map(child=>(child as Renderer.ReactTestInstance).props.testID)).toEqual(['markdown-thead','markdown-tbody']);
 expect(nodes(tree,'markdown-tr')).toHaveLength(4);
 const headers=nodes(tree,'markdown-th'),cells=nodes(tree,'markdown-td');
 expect(headers).toHaveLength(2);expect(cells).toHaveLength(6);
 const widths=headers.map(cell=>StyleSheet.flatten(cell.props.style).width);
 for(let index=0;index<cells.length;index++){
  expect(StyleSheet.flatten(cells[index].props.style).width).toBe(widths[index%2]);
  expect(StyleSheet.flatten(cells[index].props.style).flexShrink).toBe(0);
 }
 const rightAligned=cells[1].findAllByType(Text).find(text=>text.props.selectable);
 expect(StyleSheet.flatten(rightAligned!.props.style).textAlign).toBe('right');
 expect(tree.root.findAllByType(ScrollView)[0].props.horizontal).toBe(true);
 // Actual parent width, not the device width, controls layout; width changes rebuild columns.
 await act(async()=>tree.root.findByProps({testID:'markdown-content'}).props.onLayout({nativeEvent:{layout:{width:265}}}));
 const narrow=StyleSheet.flatten(nodes(tree,'markdown-table-grid')[0].props.style).width;
 expect(narrow).toBeGreaterThan(265);expect(flatten(tree.toJSON())).toContain('Swipe horizontally');
 await act(async()=>tree.root.findByProps({testID:'markdown-content'}).props.onLayout({nativeEvent:{layout:{width:900}}}));
 expect(StyleSheet.flatten(nodes(tree,'markdown-table-grid')[0].props.style).width).toBeCloseTo(900);
 expect(flatten(tree.toJSON())).not.toContain('Swipe horizontally');
 await act(async()=>tree.unmount());
});
test('separate tables have independent column counts and Markdown inside cells remains formatted',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ChatMarkdown text={'| A |\n| --- |\n| **Bold** |\n\n| X | Y | Z |\n| --- | --- | --- |\n| 1 | *two* | `three` |'}/>);});
 expect(nodes(tree,'markdown-table-grid')).toHaveLength(2);
 expect(nodes(tree,'markdown-th')).toHaveLength(4);expect(nodes(tree,'markdown-td')).toHaveLength(4);
 const output=flatten(tree.toJSON());expect(output).toContain('Bold');expect(output).not.toContain('**');
 expect(output).toContain('three');expect(output).not.toContain('`three`');
 await act(async()=>tree.unmount());
});
test('fenced and indented code preserve whitespace, scroll long lines and copy raw code without fences',async()=>{
 const source='function hello() {\n\treturn "<not HTML> & **not Markdown**";\n}\n'+ 'x'.repeat(220)+'\n';
 NativeModules.BobPlatform={copyText:jest.fn().mockResolvedValue(undefined)};
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ChatMarkdown text={'```typescript\n'+source+'```\n\n    indented code\n    second line\n'}/>);});
 expect(nodes(tree,'markdown-code-block')).toHaveLength(2);
 const code=tree.root.findAllByType(Text).filter(text=>text.props.selectable);
 expect(code[0].props.children).toBe(source.replace(/\n$/,''));
 expect(StyleSheet.flatten(code[0].props.style).fontFamily).toBe('monospace');
 expect(StyleSheet.flatten(code[0].props.style).flexShrink).toBe(0);
 expect(flatten(tree.toJSON())).toContain('typescript');
 const copies=tree.root.findAllByType(CopyAction);expect(copies[0].props.text).toBe(source);
 expect(copies[1].props.text).toBe('indented code\nsecond line\n');
 expect(tree.root.findAllByType(ScrollView).every(scroll=>scroll.props.horizontal)).toBe(true);
 await act(async()=>tree.root.findAllByProps({accessibilityLabel:'Copy code'}).find(node=>typeof node.props.onPress==='function')!.props.onPress());
 expect(NativeModules.BobPlatform.copyText).toHaveBeenCalledWith(source);
 await act(async()=>tree.unmount());
});
test('headings, nested/started lists, quotes, breaks and inline formatting retain their structure',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const markdown='# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\n3. Third\n4. Fourth\n   - Nested\n\n> A quote with **bold** and [link](https://example.com)\n\n~~Removed~~ and `inline_code`  \nNew line\n\n---';
 await act(async()=>{tree=Renderer.create(<ChatMarkdown text={markdown}/>);});
 const output=flatten(tree.toJSON());
 for(const expected of ['One','Two','Three','Four','Five','Six','3.','4.','Third','Fourth','Nested','A quote with','Removed','inline_code','New line'])expect(output).toContain(expected);
 expect(output).not.toContain('~~');expect(output).not.toContain('**');
 const styles=tree.root.findAllByType(Text).map(text=>StyleSheet.flatten(text.props.style)||{});
 expect(styles.some(style=>style.fontWeight==='700')).toBe(true);
 expect(styles.some(style=>style.textDecorationLine==='line-through')).toBe(true);
 expect(styles.some(style=>style.fontFamily==='monospace'&&style.padding===0)).toBe(true);
 await act(async()=>tree.unmount());
});
test('links only open HTTP(S) on an explicit tap and incomplete tables/fences remain renderable',async()=>{
 const open=jest.spyOn(Linking,'openURL').mockResolvedValue(undefined);
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ChatMarkdown text={'[Site](https://example.com) [File](file:///private) [Mail](mailto:test@example.com)\n\n| A | B |\n| --- | --- |\n| Partial |\n\n```js\n  const unfinished = "'}/>);});
 expect(open).not.toHaveBeenCalled();
 const links=tree.root.findAllByType(Text).filter(node=>typeof node.props.onPress==='function');
 for(const link of links)await act(async()=>link.props.onPress());
 expect(open).toHaveBeenCalledTimes(1);expect(open).toHaveBeenCalledWith('https://example.com');
 expect(flatten(tree.toJSON())).toContain('const unfinished');
 expect(nodes(tree,'markdown-td')).toHaveLength(2);
 await act(async()=>tree.unmount());open.mockRestore();
});
