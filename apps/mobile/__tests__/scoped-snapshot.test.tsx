import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {useScopedSnapshot} from '../use-scoped-snapshot';
let current:ReturnType<typeof useScopedSnapshot<{id:number}>>;
function Harness({scope}:{scope:string}){current=useScopedSnapshot(scope);return null;}
test('a new conversation never renders the old snapshot while effects and network responses catch up',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<Harness scope="a"/>);});act(()=>current[1]({id:1}));expect(current[0]?.id).toBe(1);
 await act(async()=>tree.update(<Harness scope="b"/>));expect(current[0]).toBeUndefined();act(()=>current[1](previous=>{expect(previous).toBeUndefined();return{id:2};}));expect(current[0]?.id).toBe(2);
 await act(async()=>tree.unmount());
});
test('late old-scope callbacks and clears cannot overwrite the newly selected conversation',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<Harness scope="a"/>);});const old=current[1];act(()=>old({id:1}));
 await act(async()=>tree.update(<Harness scope="b"/>));act(()=>current[1]({id:2}));act(()=>{old({id:3});old(undefined);});expect(current[0]?.id).toBe(2);await act(async()=>tree.unmount());
});
