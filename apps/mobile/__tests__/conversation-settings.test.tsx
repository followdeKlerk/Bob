import React,{useState} from 'react';
import Renderer,{act} from 'react-test-renderer';
import {StyleSheet,Text,TextInput} from 'react-native';
import {ConversationSettings,type ConversationChange,type SavedConversationSettings} from '../components/conversation-settings';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
let tree:Renderer.ReactTestRenderer|undefined;
const press=(label:string)=>tree!.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
const field=(label:string)=>tree!.root.findByProps({accessibilityLabel:label});
const load=jest.fn<Promise<SavedConversationSettings>,[]>();
const save=jest.fn<Promise<SavedConversationSettings>,[ConversationChange]>();
function Harness(){
 const [instructions,setInstructions]=useState('Be concise'),[folder,setFolder]=useState('/workspace'),[inherited,setInherited]=useState(false);
 return <ConversationSettings instructions={instructions} folder={folder} inherited={inherited} onInstructionsChange={setInstructions} onFolderChange={setFolder} onLoad={async()=>{const result=await load();setInstructions(result.instructions??'');setInherited(result.instructions===null);setFolder(result.cwd);return result;}} onSave={async change=>{
  const result=await save(change);
  if('instructions' in change){setInstructions(result.instructions??'');setInherited(result.instructions===null);}
  if('cwd' in change)setFolder(result.cwd);
  return result;
 }}/>;
}
beforeEach(()=>{save.mockReset();load.mockReset().mockResolvedValue({instructions:'Be concise',cwd:'/workspace'});});
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=undefined;});
async function mount(){await act(async()=>{tree=Renderer.create(<Harness/>);});await act(async()=>press('Instructions & folder').props.onPress());}
test('compact disclosure has separate labelled fields, accessible save actions and path typing settings',async()=>{
 await act(async()=>{tree=Renderer.create(<Harness/>);});
 expect(tree!.root.findAllByType(TextInput)).toHaveLength(0);
 expect(load).not.toHaveBeenCalled();
 await act(async()=>press('Instructions & folder').props.onPress());
 expect(press('Instructions & folder').props.accessibilityState.expanded).toBe(true);
 expect(field('Conversation instructions').props.multiline).toBe(true);
 expect(field('Backend working directory').props).toMatchObject({autoCapitalize:'none',autoCorrect:false,spellCheck:false});
 expect(press('Save conversation override').props.disabled).toBe(true);
 expect(press('Set conversation folder').props.disabled).toBe(true);
 expect(StyleSheet.flatten(press('Use backend default instructions').props.style).minHeight).toBe(48);
});
test('save runs once, locks controls, confirms success and preserves the unsaved folder',async()=>{
 let finish!:(value:SavedConversationSettings)=>void;
 save.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await mount();
 act(()=>field('Conversation instructions').props.onChangeText('New instructions'));
 act(()=>field('Backend working directory').props.onChangeText('/draft-folder'));
 act(()=>{const action=press('Save conversation override').props.onPress;action();action();});
 expect(save).toHaveBeenCalledTimes(1);expect(save).toHaveBeenCalledWith({instructions:'New instructions'});
 expect(field('Conversation instructions').props.editable).toBe(false);
 expect(press('Set conversation folder').props.disabled).toBe(true);
 await act(async()=>finish({instructions:'New instructions',cwd:'/workspace'}));
 expect(field('Backend working directory').props.value).toBe('/draft-folder');
 expect(press('Set conversation folder').props.disabled).toBe(false);
 expect(tree!.root.findAllByType(Text).some(node=>node.props.children==='Instructions saved.')).toBe(true);
 expect(press('Save conversation override').props.disabled).toBe(true);
});
test('using defaults sends null rather than blank instructions and keeps a folder draft',async()=>{
 save.mockResolvedValue({instructions:null,cwd:'/workspace'});await mount();
 act(()=>field('Backend working directory').props.onChangeText('/project-draft'));
 await act(async()=>press('Use backend default instructions').props.onPress());
 expect(save).toHaveBeenCalledWith({instructions:null});
 expect(field('Conversation instructions').props.value).toBe('');
 expect(field('Backend working directory').props.value).toBe('/project-draft');
 expect(press('Use backend default instructions').props.disabled).toBe(true);
 expect(tree!.root.findAllByType(Text).some(node=>node.props.children==='Using backend default.')).toBe(true);
});
test('saving a folder does not overwrite unsaved instructions',async()=>{
 save.mockResolvedValue({instructions:'Be concise',cwd:'/project'});await mount();
 act(()=>field('Conversation instructions').props.onChangeText('Unsaved instruction draft'));
 act(()=>field('Backend working directory').props.onChangeText('/project'));
 await act(async()=>press('Set conversation folder').props.onPress());
 expect(save).toHaveBeenCalledWith({cwd:'/project'});
 expect(field('Conversation instructions').props.value).toBe('Unsaved instruction draft');
 expect(press('Save conversation override').props.disabled).toBe(false);
 expect(press('Set conversation folder').props.disabled).toBe(true);
});
test('save errors are inline, keep input and do not retry automatically',async()=>{
 save.mockRejectedValue(Error('Working directory must be an existing absolute backend directory'));await mount();
 act(()=>field('Backend working directory').props.onChangeText('/missing'));
 await act(async()=>press('Set conversation folder').props.onPress());
 expect(save).toHaveBeenCalledTimes(1);
 expect(field('Backend working directory').props.value).toBe('/missing');
 expect(press('Set conversation folder').props.disabled).toBe(false);
 expect(tree!.root.findAllByType(Text).some(node=>String(node.props.children).includes('existing absolute backend directory'))).toBe(true);
});

test('only the fetching row spins; rapid collapse/reopen shares one load and keeps fields hidden until ready',async()=>{
 let finish!:(value:SavedConversationSettings)=>void;
 load.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await act(async()=>{tree=Renderer.create(<Harness/>);});
 expect(load).not.toHaveBeenCalled();
 act(()=>press('Instructions & folder').props.onPress());
 expect(load).toHaveBeenCalledTimes(1);
 expect(press('Instructions & folder').props.accessibilityState.busy).toBe(true);
 expect(tree!.root.findAllByProps({testID:'conversation-settings-loading'}).length).toBeGreaterThan(0);
 expect(tree!.root.findAllByType(TextInput)).toHaveLength(0);
 act(()=>press('Instructions & folder').props.onPress());act(()=>press('Instructions & folder').props.onPress());
 expect(load).toHaveBeenCalledTimes(1);
 await act(async()=>finish({instructions:'Fresh backend values',cwd:'/fresh'}));
 expect(tree!.root.findAllByProps({testID:'conversation-settings-loading'})).toHaveLength(0);
 expect(field('Conversation instructions').props.value).toBe('Fresh backend values');
 expect(field('Backend working directory').props.value).toBe('/fresh');
 expect(press('Save conversation override').props.disabled).toBe(true);
});
test('collapse/reopen after loading preserves unsaved edits without another fetch',async()=>{
 await mount();act(()=>field('Conversation instructions').props.onChangeText('Keep this draft'));
 act(()=>press('Instructions & folder').props.onPress());await act(async()=>press('Instructions & folder').props.onPress());
 expect(load).toHaveBeenCalledTimes(1);expect(field('Conversation instructions').props.value).toBe('Keep this draft');
});
test('load errors and explicit retry stay inside the panel, never showing editable stale values',async()=>{
 load.mockRejectedValueOnce(Error('Offline')).mockResolvedValueOnce({instructions:null,cwd:'/retry'});
 await mount();
 expect(tree!.root.findAllByType(TextInput)).toHaveLength(0);
 expect(tree!.root.findAllByProps({testID:'conversation-settings-loading'})).toHaveLength(0);
 expect(tree!.root.findAllByType(Text).some(node=>node.props.children==='Offline')).toBe(true);
 expect(load).toHaveBeenCalledTimes(1);
 await act(async()=>press('Retry loading instructions and folder').props.onPress());
 expect(load).toHaveBeenCalledTimes(2);
 expect(field('Backend working directory').props.value).toBe('/retry');
 expect(field('Conversation instructions').props.value).toBe('');
 expect(tree!.root.findAllByProps({accessibilityLabel:'Retry loading instructions and folder'})).toHaveLength(0);
});
