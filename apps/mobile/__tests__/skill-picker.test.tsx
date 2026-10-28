import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Pressable,ScrollView,StyleSheet} from 'react-native';
import {SkillPicker} from '../components/skill-picker';
import {skillQuery,skillRequest,pickerSkills,filterSkills} from '../skill-picker';

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
 act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss skill suggestions'}).props.onPress());expect(onDismiss).toHaveBeenCalledTimes(1);await act(async()=>tree.unmount());
});
test('error is not an empty library and retry fetches again',async()=>{
 const loadLibrary=jest.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({skills:{}});
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<SkillPicker scope="a" query="" loadLibrary={loadLibrary} bottom={200} maxHeight={200} onSelect={()=>{}} onDismiss={()=>{}}/>);});
 expect(JSON.stringify(tree.toJSON())).toContain('Couldn’t load skills');expect(JSON.stringify(tree.toJSON())).not.toContain('No skills saved');
 await act(async()=>tree.root.findByProps({accessibilityLabel:'Retry loading skills'}).props.onPress());expect(loadLibrary).toHaveBeenCalledTimes(2);expect(JSON.stringify(tree.toJSON())).toContain('No skills saved');await act(async()=>tree.unmount());
});
test('old backend response cannot populate a new scope',async()=>{
 let resolve!:(value:unknown)=>void;const first=new Promise(r=>{resolve=r;});const loadLibrary=jest.fn().mockReturnValueOnce(first).mockResolvedValueOnce({skills:{}});
 const props={query:'',loadLibrary,bottom:200,maxHeight:200,onSelect:()=>{},onDismiss:()=>{}};
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<SkillPicker {...props} scope="backend-a:1"/>);});
 expect(JSON.stringify(tree.toJSON())).toContain('Loading skills');
 await act(async()=>tree.update(<SkillPicker {...props} scope="backend-b:1"/>));await act(async()=>resolve(library));
 expect(JSON.stringify(tree.toJSON())).toContain('No skills saved');expect(JSON.stringify(tree.toJSON())).not.toContain('minimal-skill-authoring');await act(async()=>tree.unmount());
});
