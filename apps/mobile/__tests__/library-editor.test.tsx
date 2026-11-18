import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {useLibraryDrafts,useLibraryOperations,type LibraryValue} from '../use-library-editor';
let tree:Renderer.ReactTestRenderer|undefined,first:ReturnType<typeof useLibraryOperations>,second:ReturnType<typeof useLibraryOperations>,draft:ReturnType<typeof useLibraryDrafts>;
let sequence=0;
const initial:LibraryValue={instructions:'Original',templates:{keep:'Keep'},skills:{example:{description:'Example',markdown:'Original skill',enabled:true}}};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};}
function Probe({backend,scope='A',observer='first'}:{backend:string;scope?:string;observer?:string}){const value=useLibraryOperations(backend,scope);if(observer==='first')first=value;else second=value;draft=useLibraryDrafts(`${backend}:${scope}`);return null;}
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=undefined;});
async function mount(two=false){const backend=`library-test-${++sequence}`;await act(async()=>{tree=Renderer.create(<><Probe backend={backend}/>{two&&<Probe backend={backend} scope="B" observer="second"/>}</>);});return backend;}

test('duplicate saves across two retained observers admit one write and reject a read started while pending',async()=>{
 await mount(true);await act(async()=>{await first.read(async()=>initial);await second.read(async()=>initial);});
 const transport=deferred<unknown>(),write=jest.fn(()=>transport.promise),load=jest.fn(async()=>({...initial,instructions:'New'})),observe=jest.fn();
 const change={field:'instructions' as const,expected:'Original',value:'New'};
 let pending!:Promise<boolean>;await act(async()=>{pending=first.mutate(change,write,load,observe);});
 expect(first.pending).toBe(true);expect(second.blocked).toBe(true);
 await act(async()=>{expect(await second.mutate(change,write,load,observe)).toBe(false);});expect(write).toHaveBeenCalledTimes(1);
 const stale=deferred<LibraryValue>();let read!:Promise<unknown>;await act(async()=>{read=second.read(()=>stale.promise);});
 await act(async()=>{transport.resolve({});expect(await pending).toBe(true);});expect(observe).toHaveBeenCalledWith({...initial,instructions:'New'});
 await act(async()=>{stale.resolve(initial);await read;});expect(second.blocked).toBe(true);
 await act(async()=>{await second.read(load);});expect(second.blocked).toBe(false);expect(write).toHaveBeenCalledTimes(1);
});

test('lost response uses ordered authoritative readback, not a resend or hopeful success',async()=>{
 await mount();await act(async()=>{await first.read(async()=>initial);});
 const write=jest.fn(async()=>{throw Error('lost response');}),load=jest.fn(async()=>({...initial,instructions:'New'}));
 await act(async()=>{expect(await first.mutate({field:'instructions',expected:'Original',value:'New'},write,load,jest.fn())).toBe(true);});
 expect(write).toHaveBeenCalledTimes(1);expect(load).toHaveBeenCalledTimes(1);expect(first.message).toBe('Saved and checked.');
});

test('failed readback retains uncertainty and blocks writes until a fresh successful read',async()=>{
 await mount();await act(async()=>{await first.read(async()=>initial);});
 const write=jest.fn(async()=>{}),change={field:'instructions' as const,expected:'Original',value:'New'};
 await act(async()=>{expect(await first.mutate(change,write,async()=>{throw Error('offline');},jest.fn())).toBe(false);});
 expect(first.blocked).toBe(true);expect(first.message).toContain('not confirmed');
 await act(async()=>{expect(await first.mutate(change,write,async()=>initial,jest.fn())).toBe(false);});expect(write).toHaveBeenCalledTimes(1);
 await act(async()=>{await first.read(async()=>initial);});expect(first.blocked).toBe(false);
});

test('successful transport with mismatched readback is not called saved',async()=>{
 await mount();await act(async()=>{await first.read(async()=>initial);});
 await act(async()=>{expect(await first.mutate({field:'instructions',expected:'Original',value:'New'},async()=>{},async()=>initial,jest.fn())).toBe(false);});
 expect(first.message).toContain('does not match');expect(first.message).not.toBe('Saved and checked.');
});

test('late mutation readback cannot replace a newly selected scope',async()=>{
 const backend=await mount();await act(async()=>{await first.read(async()=>initial);});
 const transport=deferred<unknown>(),observe=jest.fn();let pending!:Promise<boolean>;
 await act(async()=>{pending=first.mutate({field:'instructions',expected:'Original',value:'New'},()=>transport.promise,async()=>({...initial,instructions:'New'}),observe);});
 await act(async()=>tree!.update(<Probe backend={backend} scope="new"/>));
 await act(async()=>{transport.resolve({});await pending;});expect(observe).not.toHaveBeenCalled();expect(first.message).not.toBe('Saved and checked.');expect(first.blocked).toBe(true);
});

test('draft refresh, acknowledgement and scope round trips preserve unsaved fields and newer typing',async()=>{
 const backend=await mount();await act(async()=>draft.observe(initial));await act(async()=>{draft.setInstructions('Submitted');draft.editTemplate('one','First');draft.editSkill('example',initial.skills.example);});
 await act(async()=>draft.setInstructions('Typed while saving'));
 await act(async()=>{draft.observe({...initial,instructions:'Remote'});draft.acknowledgeInstructions('Submitted');});
 expect(draft.instructions).toBe('Typed while saving');expect(draft.instructionBase).toBe('Submitted');expect(draft.instructionsDirty).toBe(true);
 await act(async()=>{draft.editTemplate('two','Second');draft.acknowledgeTemplate('one','Old completion');draft.newSkill();draft.setSkillText('New unsaved skill');draft.acknowledgeSkill('example',initial.skills.example);});
 expect(draft.templateText).toBe('Second');expect(draft.templateBase?.name).toBe('two');expect(draft.skillBase).toBeUndefined();expect(draft.skillText).toBe('New unsaved skill');
 await act(async()=>tree!.update(<Probe backend={backend} scope="other"/>));expect(draft.instructions).toBe('');expect(draft.templateText).toBe('');
 await act(async()=>tree!.update(<Probe backend={backend} scope="A"/>));expect(draft.instructions).toBe('Typed while saving');expect(draft.templateText).toBe('Second');expect(draft.skillText).toBe('New unsaved skill');
});


test('unsaved library draft survives retained-view eviction and remount in the same workstation scope',async()=>{
 const backend=await mount();await act(async()=>{draft.observe(initial);draft.setInstructions('Keep across eviction');draft.setTemplateText('Unsent template');});
 await act(async()=>tree!.unmount());tree=undefined;
 await act(async()=>{tree=Renderer.create(<Probe backend={backend}/>);});
 expect(draft.instructions).toBe('Keep across eviction');expect(draft.templateText).toBe('Unsent template');
 await act(async()=>draft.observe(initial));expect(draft.instructions).toBe('Keep across eviction');
});
