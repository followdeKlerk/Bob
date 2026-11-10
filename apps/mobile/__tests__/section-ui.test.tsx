import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {ActivityIndicator,Pressable,StyleSheet,Text,TextInput,ScrollView,View} from 'react-native';
import {Bell,Plus} from 'lucide-react-native';
import {RoundAction,SectionHeading,SectionActions,SectionBody,SectionSegments,SettingsGroup,SettingsRow} from '../components/section-ui';
import {Button} from '../components/ui/button';
import {Tabs,TabsList,TabsTrigger} from '../components/ui/tabs';
import {colors} from '../theme';
import {APP_UI_FONT_FAMILY} from '../typography';
import {EdgeFade} from '../components/edge-fade';
import {ThemeContext,tokens} from '../theme-context';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
test('settings toggles expose state with a full-size row and concise visible label',async()=>{
 const toggle=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<SettingsGroup title="Notifications"><SettingsRow title="Reply notifications" label="Last reply notifications: off" icon={Bell} checked={false} onPress={toggle}/></SettingsGroup>);});
 const row=tree.root.findAll(node=>node.props.accessibilityRole==='switch'&&typeof node.props.onPress==='function')[0];
 expect(row.props.accessibilityRole).toBe('switch');expect(row.props.accessibilityState).toMatchObject({checked:false,disabled:false});
 expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(48);
 act(()=>row.props.onPress());expect(toggle).toHaveBeenCalledTimes(1);
 await act(async()=>tree.update(<SettingsRow title="Reply notifications" label="Last reply notifications: on" icon={Bell} checked disabled onPress={toggle}/>));
 expect(tree.root.findAll(node=>node.props.accessibilityRole==='switch'&&typeof node.props.onPress==='function')[0].props).toMatchObject({disabled:true,accessibilityState:{checked:true,disabled:true}});
 await act(async()=>tree.unmount());
});
test('shared headings wrap text and icon actions keep accessible labels and 48-point targets',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<View><SectionHeading title="Notes"/><SectionActions><RoundAction label="Create note" icon={Plus} primary onPress={()=>{}}/></SectionActions></View>);});
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'section-heading'}).props.style).paddingTop).toBe(28);
 const heading=tree.root.findAllByType(Text).find(node=>node.props.accessibilityRole==='header')!;
 expect(heading.props.numberOfLines).toBeUndefined();
 const button=tree.root.findAll(node=>node.props.accessibilityLabel==='Create note'&&typeof node.props.onPress==='function')[0];expect(button.props.accessibilityLabel).toBe('Create note');
 expect(StyleSheet.flatten(button.props.style)).toMatchObject({width:48,height:48});
 await act(async()=>tree.unmount());
});
test('only an active settings operation gets a miniature spinner and busy state',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<View><SettingsRow title="Fetching" icon={Bell} loading onPress={()=>{}}/><SettingsRow title="Static" icon={Bell} onPress={()=>{}}/></View>);});
 const rows=tree.root.findAll(node=>typeof node.props.onPress==='function'&&node.props.accessibilityRole==='button');
 expect(rows[0].props).toMatchObject({disabled:true,accessibilityState:{busy:true}});
 expect(rows[0].findAllByType(ActivityIndicator)).toHaveLength(1);
 expect(rows[0].findByType(ActivityIndicator).props.size).toBe('small');
 expect(rows[1].props).toMatchObject({disabled:false,accessibilityState:{busy:false}});
 expect(rows[1].findAllByType(ActivityIndicator)).toHaveLength(0);
 await act(async()=>tree.unmount());
});

test('legacy compact flag cannot introduce inconsistent header control geometry',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<RoundAction label="Create note" icon={Plus} primary compact onPress={()=>{}}/>);});
 const button=tree.root.findAll(node=>node.props.accessibilityRole==='button'&&typeof node.props.onPress==='function')[0];
 expect(StyleSheet.flatten(button.props.style)).toMatchObject({width:48,height:48});
 expect(tree.root.findByType(Button).props).toMatchObject({size:'icon',variant:'outline',className:'rounded-full'});
 expect(StyleSheet.flatten(button.props.style)).toMatchObject({width:48,height:48,borderRadius:24});
 await act(async()=>tree.unmount());
});

test('headers use the Reusables Button asset and keep return separate from right actions; settings groups stay unboxed',async()=>{
 const {menuChrome}=require('../theme');let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<View><SectionHeading title="Schedules" subtitle="This workstation"/><SectionActions onBack={()=>{}}><RoundAction label="Refresh" icon={Plus} onPress={()=>{}}/><RoundAction label="Create" icon={Plus} primary onPress={()=>{}}/></SectionActions><SettingsGroup title="Group"><Text>Information</Text></SettingsGroup></View>);});
 const actions=tree.root.findByProps({testID:'section-footer-actions'});
 expect(StyleSheet.flatten(actions.props.style)).toMatchObject({justifyContent:'flex-end',gap:8,marginLeft:'auto'});
 expect(actions.findAllByType(Button).map(node=>node.props.accessibilityLabel)).toEqual(['Refresh','Create']);
 expect(actions.findAllByProps({accessibilityLabel:'Back to previous menu'})).toHaveLength(0);
 const group=tree.root.findByType(SettingsGroup);
 expect(group.findAllByType(View).some(node=>{const style=StyleSheet.flatten(node.props.style);return style?.borderRadius===16&&!style?.borderWidth;})).toBe(true);
 const refresh=actions.findAll(node=>node.props.accessibilityRole==='button'&&typeof node.props.onPress==='function')[0];
 expect(actions.findAllByType(Button).map(node=>node.props.variant)).toEqual(['outline','outline']);
 expect(StyleSheet.flatten(refresh.props.style)).toMatchObject({width:48,height:48,borderRadius:24});
 await act(async()=>tree.unmount());
});

const filterSets=[
 [{value:'all',label:'All'},{value:'archived',label:'Archived'},{value:'trash',label:'Trash'}],
 [{value:'active',label:'Active'},{value:'paused',label:'Paused'},{value:'finished',label:'Finished'}],
];
test.each(filterSets.map(options=>[options] as const))('Reusables filters keep selection geometry stable and labels scalable: %j',async options=>{
 let tree!:Renderer.ReactTestRenderer;const change=jest.fn();
 const render=(value:string)=><SectionSegments label="Filters" options={options} value={value} onChange={change}/>;
 await act(async()=>{tree=Renderer.create(render(options[0].value));});
 try{
  expect(tree.root.findByType(Tabs)).toBeDefined();expect(tree.root.findAllByType(TabsTrigger)).toHaveLength(3);
  expect(StyleSheet.flatten(tree.root.findByType(TabsList).props.style)).toMatchObject({height:'auto',minHeight:54,width:'100%',alignItems:'stretch'});
  const geometry:unknown[]=[];
  for(const option of options){
   await act(async()=>tree.update(render(option.value)));
   const tabs=tree.root.findAll(node=>node.props.accessibilityRole==='tab'&&typeof node.props.onPress==='function');
   expect(tabs).toHaveLength(3);
   const metrics=tabs.map((tab,index)=>{
    const {backgroundColor,borderColor,...shape}=StyleSheet.flatten(tab.props.style);
    expect(shape).toMatchObject({minWidth:48,minHeight:48,height:'auto',flex:1});
    expect(tab.props.accessibilityState).toMatchObject({selected:options[index].value===option.value,disabled:false});
    expect(backgroundColor).toBe(options[index].value===option.value?colors.selectedSurface:colors.surface);
    const labels=tab.findAllByType(Text);expect(labels).toHaveLength(1);
    expect(labels[0].props.children).toBe(options[index].label);
    expect(labels[0].props.allowFontScaling).not.toBe(false);expect(labels[0].props.numberOfLines).toBeUndefined();expect(labels[0].props.adjustsFontSizeToFit).not.toBe(true);expect(labels[0].props.maxFontSizeMultiplier).toBeUndefined();
    expect(StyleSheet.flatten(labels[0].props.style)).toMatchObject({fontSize:15,lineHeight:23,fontWeight:'500',flexShrink:1});
    act(()=>tab.props.onPress({}));expect(change).toHaveBeenLastCalledWith(options[index].value);
    return shape;
   });
   geometry.push(metrics);
  }
  expect(geometry[1]).toEqual(geometry[0]);expect(geometry[2]).toEqual(geometry[0]);
  act(()=>tree.root.findByType(Tabs).props.onValueChange('not-an-option'));expect(change).toHaveBeenCalledTimes(9);
 }finally{await act(async()=>tree.unmount());}
});
test('long workstation subtitles cannot vertically shift header actions and share the full content width',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<View><SectionHeading title="Sessions" subtitle="workstation.example.ts.net"/><SectionActions><RoundAction label="Schedules" icon={Bell} onPress={()=>{}}/><RoundAction label="Search" icon={Bell} onPress={()=>{}}/><RoundAction label="New" icon={Plus} primary onPress={()=>{}}/></SectionActions></View>);});
 try{
  const row=tree.root.findByProps({testID:'section-heading-row'}),subtitle=tree.root.findAllByType(Text).find(node=>node.props.testID==='section-heading-subtitle')!;
  expect(StyleSheet.flatten(row.props.style)).toMatchObject({alignItems:'flex-start',minHeight:30,flexDirection:'row'});
  expect(row.findAllByProps({testID:'section-heading-subtitle'})).toHaveLength(0);
  expect(subtitle.props.numberOfLines).toBeUndefined();
  expect(tree.root.findAllByType(Button)).toHaveLength(3);
 }finally{await act(async()=>tree.unmount());}
});


test.each([0,1,3])('title stays top while %i utilities, Back and Menu remain in a separate wrapping footer',async(count)=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<View><SectionHeading title="A long submenu title that must wrap rather than move the buttons" subtitle="A long workstation subtitle"/><View testID="body" style={{flex:1,minHeight:0}}/><SectionActions onBack={()=>{}} menu={<View testID="menu-slot"/>}>{Array.from({length:count},(_,index)=><RoundAction key={index} label={`Action ${index}`} icon={Plus} onPress={()=>{}}/>)}</SectionActions></View>);});
 const heading=tree.root.findByType(SectionHeading),footer=tree.root.findByType(SectionActions),toolbar=footer.findByProps({testID:'section-footer-toolbar'});
 expect(heading.findAllByType(RoundAction)).toHaveLength(0);expect(heading.findAllByProps({testID:'menu-slot'})).toHaveLength(0);
 expect(StyleSheet.flatten(footer.findByProps({testID:'section-footer'}).props.style)).toMatchObject({flexShrink:0,flexDirection:'row',alignItems:'flex-end',paddingHorizontal:16});
 expect(StyleSheet.flatten(toolbar.props.style)).toMatchObject({flex:1,minWidth:0,flexWrap:'wrap'});
 const menu=footer.findByProps({testID:'section-footer-menu'});expect(menu.findAllByType(View).filter(node=>node.props.testID==='menu-slot')).toHaveLength(1);
 expect(StyleSheet.flatten(menu.props.style)).toMatchObject({flexShrink:0,minWidth:48,minHeight:48});
 expect(toolbar.findByProps({testID:'section-footer-leading'}).findAllByType(RoundAction).map(node=>node.props.label)).toEqual(['Back to previous menu']);
 expect(footer.findAllByProps({testID:'section-heading-subtitle'})).toHaveLength(0);
 expect(tree.root.findAllByType(View).filter(node=>node.props.testID==='section-footer-actions')).toHaveLength(count?1:0);
 const title=heading.findAllByType(Text).find(node=>node.props.accessibilityRole==='header')!;
 expect(title.props.numberOfLines).toBeUndefined();expect(title.props.allowFontScaling).not.toBe(false);
 expect(StyleSheet.flatten(title.props.style)).toMatchObject({fontSize:24,lineHeight:30});
 await act(async()=>tree.unmount());
});

test('empty conditional actions do not create a footer, while a menu-only footer stays right-aligned',async()=>{
 let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<SectionActions>{false&&<View/>}{null}</SectionActions>);});
 expect(tree.root.findAllByType(View).filter(node=>node.props.testID==='section-footer')).toHaveLength(0);
 await act(async()=>tree.update(<SectionActions menu={<View testID="menu-only"/>}/>));
 expect(tree.root.findAllByType(View).filter(node=>node.props.testID==='section-footer')).toHaveLength(1);
 expect(tree.root.findByProps({testID:'section-footer-menu'}).findAllByType(View).filter(node=>node.props.testID==='menu-only')).toHaveLength(1);
 expect(tree.root.findAllByType(View).filter(node=>node.props.testID==='section-footer-actions')).toHaveLength(0);
 await act(async()=>tree.unmount());
});


test('overlay footers reveal the host gradient without changing normal footer chrome',async()=>{
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<SectionActions overlay onBack={()=>{}}/>);});
 try{
  const footer=tree.root.findByProps({testID:'section-footer'});
  expect(StyleSheet.flatten(footer.props.style)).toMatchObject({backgroundColor:'transparent',borderTopWidth:0});
  expect(footer.props.pointerEvents).toBe('box-none');
  const button=tree.root.findByType(Button);
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({minWidth:48,minHeight:48});
  await act(async()=>tree.update(<SectionActions onBack={()=>{}}/>));
  expect(tree.root.findByProps({testID:'section-footer'})).toBe(footer);
  expect(StyleSheet.flatten(footer.props.style)).toMatchObject({backgroundColor:colors.background,borderTopWidth:0});
 }finally{await act(async()=>tree.unmount());}
});


test.each(['dark','light'] as const)('measured %s footer overlays keep the full scroll viewport, input identity and draft through wrapping/reflow',async scheme=>{
 function Editor(){
  const [draft,setDraft]=React.useState('Unsent draft');
  return <SectionBody surfaceColor={tokens[scheme].colors.surface} footer={<SectionActions overlay onBack={()=>{}} menu={<View testID="retained-menu"/>}><RoundAction label="Save" icon={Plus} onPress={()=>{}}/></SectionActions>}>{clearance=>
   <ScrollView testID="retained-scroll" style={{flex:1,minHeight:0}} contentContainerStyle={{paddingBottom:clearance+16}} keyboardShouldPersistTaps="handled"><TextInput testID="retained-input" value={draft} onChangeText={setDraft}/></ScrollView>
  }</SectionBody>;
 }
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><Editor/></ThemeContext.Provider>);});
 try{
  const host=tree.root.findByProps({testID:'section-scroll-host'}),overlay=tree.root.findByProps({testID:'section-footer-overlay'});
  const scroll=tree.root.findByProps({testID:'retained-scroll'}),input=tree.root.findByProps({testID:'retained-input'}),menu=tree.root.findByProps({testID:'retained-menu'});
  act(()=>input.props.onChangeText('Keep the caret and draft'));
  expect(StyleSheet.flatten(host.props.style)).toMatchObject({flex:1,minHeight:0});
  expect(tree.root.findAllByType(EdgeFade).find(node=>node.props.edge==='top')!.props).toMatchObject({height:16,color:tokens[scheme].colors.surface});
  expect(StyleSheet.flatten(overlay.props.style)).toEqual({position:'absolute',left:0,right:0,bottom:0});
  expect(overlay.props.pointerEvents).toBe('box-none');
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({flex:1,minHeight:0});
  // Includes multi-line text/actions, Menu, padding and any additional footer row.
  for(const height of [64,184,96]){
   act(()=>overlay.props.onLayout({nativeEvent:{layout:{height}}}));
   expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(height+12+16);
   expect(tree.root.findAllByType(EdgeFade).find(node=>node.props.edge==='bottom')!.props).toMatchObject({edge:'bottom',height:height+12,color:tokens[scheme].colors.surface});
   expect(tree.root.findByProps({testID:'retained-scroll'})===scroll).toBe(true);
   expect(tree.root.findByProps({testID:'retained-input'})===input).toBe(true);
   expect(tree.root.findByProps({testID:'retained-menu'})===menu).toBe(true);
   expect(input.props.value).toBe('Keep the caret and draft');
  }
  for(const height of [0,-1,NaN,Infinity])act(()=>overlay.props.onLayout({nativeEvent:{layout:{height}}}));
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(124);
  expect(StyleSheet.flatten(tree.root.findByProps({testID:'section-footer'}).props.style)).toMatchObject({backgroundColor:'transparent',borderTopWidth:0});
 }finally{await act(async()=>tree.unmount());}
});


test.each(['dark','light'] as const)('%s settings place long values beneath the title with no narrow right-hand column or text clipping',async scheme=>{
 const value='Calendar, contacts and camera permissions are managed by Android';let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><SettingsRow title="Android permissions" value={value} icon={Bell} onPress={()=>{}}/></ThemeContext.Provider>);});
 try{
  const title=tree.root.findAllByType(Text).find(node=>node.props.children==='Android permissions')!,detail=tree.root.findAllByType(Text).find(node=>node.props.children===value)!;
  const column=tree.root.findAllByType(View).find(node=>{const style=StyleSheet.flatten(node.props.style);return style?.flex===1&&style?.gap===4;})!;
  expect(column.findAllByType(Text).map(node=>node.props.children)).toEqual(['Android permissions',value]);expect(StyleSheet.flatten(column.props.style)).toMatchObject({flex:1,minWidth:0,gap:4});
  for(const text of [title,detail]){
   expect(StyleSheet.flatten(text.props.style).fontFamily).toBe(APP_UI_FONT_FAMILY);
   expect(StyleSheet.flatten(text.props.style).maxWidth).toBeUndefined();expect(text.props.numberOfLines).toBeUndefined();expect(text.props.allowFontScaling).not.toBe(false);
  }
 }finally{await act(async()=>tree.unmount());}
});
