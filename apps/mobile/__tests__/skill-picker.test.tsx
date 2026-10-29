import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Pressable,ScrollView,StyleSheet} from 'react-native';
import {SkillPicker} from '../components/skill-picker';
import {skillQuery,skillRequest,pickerSkills,filterSkills,pickerEntries,pickerRequest} from '../skill-picker';

const library={skills:{'minimal-skill-authoring':{description:'Create small useful skills',enabled:true},'bob-application-guide':{description:'Read Bob documentation',enabled:true},'disabled-skill':{description:'Not enabled',enabled:false}}};
test('slash detection avoids URLs, paths, prose and completed commands',()=>{
 expect(skillQuery('/')).toBe('');expect(skillQuery('/MiNi')).toBe('mini');
 for(const text of ['hello /','https://example.com','/home/file','/skill more','/skill\n',''])expect(skillQuery(text)).toBeNull();
 expect(filterSkills(pickerSkills(library),'SMALL').map(s=>s.name)).toEqual(['minimal-skill-authoring']);
 expect(skillRequest('minimal-skill-authoring')).toBe('Use the skill "minimal-skill-authoring". ');
});
test('picker grows upwards above composer, loads once while filtering and selects without submission',async()=>{
 const loadLibrary=jest.fn(async()=>library),onSelect=jest.fn(),onDismiss=jest.fn();
 const props={scope:'backend:1',query:'',loadLibrary,bottom:400,maxHeight:220,onSelect,onDismiss};
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<SkillPicker {...props}/>);});
 const popup=StyleSheet.flatten(tree.root.findByProps({testID:'skill-picker'}).props.style);expect(popup).toMatchObject({position:'absolute',bottom:400,maxHeight:220});
 expect(tree.root.findByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
 const disabled=tree.root.findByProps({accessibilityLabel:'Use skill disabled-skill (disabled)'});expect(disabled.props.disabled).toBe(true);
 await act(async()=>tree.update(<SkillPicker {...props} query="mini"/>));expect(loadLibrary).toHaveBeenCalledTimes(1);
 expect(tree.root.findAllByProps({accessibilityLabel:'Use skill bob-application-guide'})).toHaveLength(0);expect(tree.root.findByProps({accessibilityLabel:'Use skill minimal-skill-authoring'})).toBeDefined();
 act(()=>tree.root.findByProps({accessibilityLabel:'Use skill minimal-skill-authoring'}).props.onPress());expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({name:'minimal-skill-authoring'}));expect(onDismiss).not.toHaveBeenCalled();
 act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss command suggestions'}).props.onPress());expect(onDismiss).toHaveBeenCalledTimes(1);await act(async()=>tree.unmount());
});
test('error is not an empty library and retry fetches again',async()=>{
 const loadLibrary=jest.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({skills:{}});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<SkillPicker scope="a" query="" loadLibrary={loadLibrary} bottom={200} maxHeight={200} onSelect={()=>{}} onDismiss={()=>{}}/>);});
 expect(JSON.stringify(tree.toJSON())).toContain('Couldn’t load commands and skills');expect(JSON.stringify(tree.toJSON())).not.toContain('No commands or skills available');
 await act(async()=>tree.root.findByProps({accessibilityLabel:'Retry loading commands and skills'}).props.onPress());expect(loadLibrary).toHaveBeenCalledTimes(2);expect(JSON.stringify(tree.toJSON())).toContain('No commands or skills available');await act(async()=>tree.unmount());
});
test('old backend response cannot populate a new scope',async()=>{
 let resolve!:(value:unknown)=>void;const first=new Promise(r=>{resolve=r;});const loadLibrary=jest.fn().mockReturnValueOnce(first).mockResolvedValueOnce({skills:{}});
 const props={query:'',loadLibrary,bottom:200,maxHeight:200,onSelect:()=>{},onDismiss:()=>{}};
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<SkillPicker {...props} scope="backend-a:1"/>);});
 expect(JSON.stringify(tree.toJSON())).toContain('Loading commands and skills');
 await act(async()=>tree.update(<SkillPicker {...props} scope="backend-b:1"/>));await act(async()=>resolve({...library,commands:[{name:'delegation',description:'Choose models or profiles for subagents.'}]}));
 expect(JSON.stringify(tree.toJSON())).toContain('No commands or skills available');expect(JSON.stringify(tree.toJSON())).not.toContain('minimal-skill-authoring');expect(tree.root.findAllByProps({accessibilityLabel:'Insert command delegation'})).toHaveLength(0);await act(async()=>tree.unmount());
});

test('Bro and the native Delegation command are discoverable without inventing commands on legacy backends',()=>{
 const current={...library,skills:{...library.skills,bro:{description:'Say it more simply',enabled:true}},commands:[{name:'delegation',description:'Choose models or profiles for subagents.'}]};
 const entries=pickerEntries(current);
 expect(filterSkills(entries,'bro')).toEqual([{kind:'skill',name:'bro',description:'Say it more simply',enabled:true}]);
 const delegation=filterSkills(entries,'delegation')[0];
 expect(delegation).toMatchObject({kind:'command',name:'delegation',enabled:true});
 expect(filterSkills(entries,'profiles')).toContainEqual(delegation);
 expect(pickerRequest(delegation)).toBe('/delegation ');
 expect(skillQuery(pickerRequest(delegation))).toBeNull();
 expect(pickerRequest(filterSkills(entries,'bro')[0])).toBe('Use the skill "bro". ');
 expect(pickerEntries(library).some(entry=>entry.kind==='command')).toBe(false);
 expect(pickerEntries({skills:{bro:{description:'Simplify',enabled:false}},commands:current.commands}).find(entry=>entry.name==='bro')?.enabled).toBe(false);
});

test('command metadata is validated and native command names cannot be shadowed or duplicated',()=>{
 const entries=pickerEntries({skills:{delegation:{description:'Same-name skill',enabled:false},bro:{description:'Simplify',enabled:true}},commands:[
  {name:'delegation',description:'Actual command'}, {name:'delegation',description:'Duplicate'},
  {name:'bad command',description:'No'}, {name:'../../file',description:'No'}, {name:'/delegation',description:'No'},
  {name:'new-line\n',description:'No'}, {name:'missing-description'}, {name:'large',description:'x'.repeat(501)},null,
 ]});
 expect(entries.map(entry=>[entry.kind,entry.name])).toEqual([['skill','bro'],['command','delegation']]);
 expect(entries.find(entry=>entry.name==='delegation')).toMatchObject({description:'Actual command',enabled:true});
 expect(()=>pickerEntries({skills:{},commands:'invalid'})).toThrow('Invalid command menu response');
});

test('native command rows filter and select like skills without submitting or changing skill enablement',async()=>{
 const onSelect=jest.fn(),loadLibrary=jest.fn(async()=>({skills:{bro:{description:'Simplify the last answer',enabled:true}},commands:[{name:'delegation',description:'Choose models and profiles'}]}));
 const props={scope:'backend:command',query:'',loadLibrary,bottom:320,maxHeight:180,onSelect,onDismiss:()=>{}};
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<SkillPicker {...props}/>);});
 expect(JSON.stringify(tree.toJSON())).toContain('Commands & skills');
 expect(tree.root.findByProps({accessibilityLabel:'Use skill bro'})).toBeDefined();
 const command=tree.root.findByProps({accessibilityLabel:'Insert command delegation'});
 expect(command.props.disabled).toBe(false);
 act(()=>command.props.onPress());
 expect(onSelect).toHaveBeenCalledWith({kind:'command',name:'delegation',description:'Choose models and profiles',enabled:true});
 await act(async()=>tree.update(<SkillPicker {...props} query="bro"/>));
 expect(tree.root.findAllByProps({accessibilityLabel:'Insert command delegation'})).toHaveLength(0);
 expect(loadLibrary).toHaveBeenCalledTimes(1);
 await act(async()=>tree.unmount());
});
