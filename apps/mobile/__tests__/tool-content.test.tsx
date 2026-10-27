import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {ToolContent} from '../components/tool-content';
import {toolPresentation,toolResultPreview} from '../tool-presentation';

jest.mock('../components/message-actions',()=>({CopyAction:()=>null}));
jest.mock('lucide-react-native',()=>({ChevronDown:()=>null,ChevronRight:()=>null,SquareTerminal:()=>null}));
const flatten=(value:any):string=>typeof value==='string'?value:Array.isArray(value)?value.map(flatten).join(''):value?.children?flatten(value.children):'';
test('collapsed shell cards show the command and result excerpt while full arguments and output remain expandable',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const content=JSON.stringify({command:'npm test -- --runInBand',timeout:120});
 await act(async()=>{tree=Renderer.create(<ToolContent name="bash" content={content} result={{status:'done',content:[{type:'text',text:'Tests passed\nSummary complete\nFull result marker'}]}}/>);});
 expect(flatten(tree.toJSON())).toContain('Run tests');expect(flatten(tree.toJSON())).toContain('npm test -- --runInBand');
 expect(flatten(tree.toJSON())).toContain('Tests passed');expect(flatten(tree.toJSON())).not.toContain('Full result marker');expect(flatten(tree.toJSON())).not.toContain('"timeout"');
 await act(async()=>tree.root.findAllByProps({accessibilityLabel:'Tool details: bash'})[0].props.onPress());
 expect(flatten(tree.toJSON())).toContain('"timeout": 120');expect(flatten(tree.toJSON())).not.toContain('Full result marker');
 await act(async()=>tree.root.findAllByProps({accessibilityLabel:'Tool result: bash'})[0].props.onPress());
 expect(flatten(tree.toJSON())).toContain('Full result marker');
 await act(async()=>tree.root.findAllByProps({accessibilityLabel:'Tool details: bash'})[0].props.onPress());
 expect(flatten(tree.toJSON())).toContain('npm test');expect(flatten(tree.toJSON())).not.toContain('Full result marker');
 await act(async()=>tree.unmount());
});
test('failed cards show the actual error instead of a generic expand-for-details message',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ToolContent name="self_update" content={'{"action":"update","target":"android"}'} result={{status:'failed',isError:true,content:'Build failure'}}/>);});
 expect(flatten(tree.toJSON())).toContain('Update app');expect(flatten(tree.toJSON())).toContain('Build failure');expect(flatten(tree.toJSON())).not.toContain('expand details to inspect');expect(flatten(tree.toJSON())).not.toContain('"action"');
 await act(async()=>tree.unmount());
});
test('shell previews separate the working directory from the useful command',()=>{
 expect(toolPresentation('functions.bash',JSON.stringify({command:'cd /workspace/bob/apps/mobile && npx tsc --noEmit && npx jest --runInBand'}))).toEqual({title:'Run tests',detail:'In /workspace/bob/apps/mobile',command:'npx tsc --noEmit && npx jest --runInBand'});
 expect(toolPresentation('bash',JSON.stringify({command:"cd '/a folder/project' && python3 - <<'PY'\nprint('hello')\nPY"}))).toMatchObject({title:'Run python3',detail:"In '/a folder/project'"});
});
test('result previews prefer concrete errors or test counts over unhelpful output headers',()=>{
 expect(toolResultPreview('Loading project\nfile.ts(2,1): error TS2304: Cannot find name global\nCommand exited with code 1',true)).toContain('error TS2304');
 expect(toolResultPreview('Lots of build logs\nTest Suites: 7 passed, 7 total\nTests: 21 passed, 21 total')).toBe('Test Suites: 7 passed, 7 total\nTests: 21 passed, 21 total');
 expect(toolResultPreview(JSON.stringify({status:'queued',stage:'Queued'}))).toBe('Queued');
 expect(toolResultPreview(undefined)).toBeUndefined();
});
test('file cards expose paths, and output-only cards retain a useful excerpt',()=>{
 expect(toolPresentation('read',JSON.stringify({path:'/project/apps/mobile/components/updates.tsx'}))).toEqual({title:'Read updates.tsx',detail:'/project/apps/mobile/components/updates.tsx'});
 expect(toolPresentation('Result','ENOENT: File not found')).toEqual({title:'Tool result',detail:'ENOENT: File not found'});
});

test('quiet collapsed rows never grow a command or result preview as output arrives',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 const content=JSON.stringify({command:'printf ORIGINAL_ARGUMENT'});
 await act(async()=>{tree=Renderer.create(<ToolContent quiet name="bash" content={content}/>);});
 expect(flatten(tree.toJSON())).not.toContain('ORIGINAL_ARGUMENT');
 await act(async()=>tree.update(<ToolContent quiet name="bash" content={content} result={{status:'done',content:'ORIGINAL_RESULT'}}/>));
 expect(flatten(tree.toJSON())).not.toContain('ORIGINAL_ARGUMENT');expect(flatten(tree.toJSON())).not.toContain('ORIGINAL_RESULT');
 await act(async()=>tree.root.findAllByProps({accessibilityLabel:'Tool details: bash'})[0].props.onPress());
 expect(flatten(tree.toJSON())).toContain('ORIGINAL_ARGUMENT');expect(flatten(tree.toJSON())).toContain('ORIGINAL_RESULT');
 await act(async()=>tree.unmount());
});
