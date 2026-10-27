import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Text,Image,Linking} from 'react-native';
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
