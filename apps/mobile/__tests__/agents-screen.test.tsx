import {PageSearch} from '../components/page-search';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {View,StyleSheet,Modal} from 'react-native';
import {AgentsScreen} from '../components/agents-screen';
import {EdgeFade} from '../components/edge-fade';
import {SectionHeading,SectionActions} from '../components/section-ui';
import type {AgentSession} from '../use-agent-overview';
const text=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(n=>typeof n.props.children==='string').map(n=>n.props.children).join(' ');
const button=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
const sessions:AgentSession[]=[{conversationId:7,title:'Build the app',status:'working',agents:[{name:'Worker',conversationId:8,status:'working'},{name:'Reviewer',conversationId:9,status:'idle'}]},{conversationId:20,title:'Research trip',status:'idle',agents:[{name:'Worker',conversationId:21,status:'stopping'}]}];
const props=()=>({sessions,onSelect:jest.fn(),onOpenSession:jest.fn(),onBack:jest.fn(),onHistoryChange:jest.fn(),status:'Connected',workstation:'Work PC'});
test('compact conversation-first rows expand helpers only when requested',async()=>{
 const p=props();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...p}>{null}</AgentsScreen>);});
 expect(tree.root.findByProps({testID:'sessions-heading'}).findAll(n=>n.props.children==='Sessions')).not.toHaveLength(0);
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'sessions-heading'}).props.style).paddingTop).toBe(28);
 expect(text(tree)).not.toContain('Work PC');expect(text(tree)).not.toContain('No working helpers');
 expect(tree.root.findByProps({testID:'agent-session-tree'}).props.data).toHaveLength(2);
 expect(button(tree,'View agent Worker')).toBeUndefined();
 const toggle=button(tree,'Expand agents for Build the app'),shape=StyleSheet.flatten(toggle.props.style);
 expect(shape.minHeight).toBe(48);expect(shape.borderWidth).toBeUndefined();expect(shape.backgroundColor).toBeUndefined();expect(shape.boxShadow).toBeUndefined();
 const toggleText=toggle.findAll(n=>n.props.children?.includes?.('helpers'))[0];
 expect(StyleSheet.flatten(toggleText.props.style)).toMatchObject({fontSize:13,lineHeight:20});
 act(()=>button(tree,'Expand agents for Build the app').props.onPress());act(()=>button(tree,'Expand agents for Research trip').props.onPress());
 const workers=tree.root.findAll(n=>n.props.accessibilityLabel==='View agent Worker'&&typeof n.props.onPress==='function');expect(workers).toHaveLength(2);
 act(()=>workers[1].props.onPress());expect(p.onSelect).toHaveBeenCalledWith(20,21);
 act(()=>button(tree,'Open Bob session Build the app').props.onPress());expect(p.onOpenSession).toHaveBeenCalledWith(7);
 expect(button(tree,'View agent Reviewer')).toBeDefined();expect(StyleSheet.flatten(workers[0].props.style).minHeight).toBeGreaterThanOrEqual(48);
 const title=button(tree,'Open Bob session Build the app').findAll(n=>n.props.children==='Build the app')[0];expect(StyleSheet.flatten(title.props.style)).toMatchObject({fontSize:16,fontWeight:'600'});
 await act(async()=>tree.unmount());
});
test('search reveals matching helpers and explicit collapse also works in history mode',async()=>{
 const p=props();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...p}>{null}</AgentsScreen>);});
 const search=tree.root.findByProps({accessibilityLabel:'Search agents and sessions'});
 act(()=>search.props.onChangeText('Reviewer'));expect(button(tree,'View agent Reviewer')).toBeDefined();expect(button(tree,'Open Bob session Research trip')).toBeUndefined();
 act(()=>button(tree,'Collapse agents for Build the app').props.onPress());expect(button(tree,'View agent Reviewer')).toBeUndefined();
 act(()=>search.props.onChangeText(''));await act(async()=>tree.update(<AgentsScreen {...p} history>{null}</AgentsScreen>));
 expect(button(tree,'View agent Reviewer')).toBeDefined();act(()=>button(tree,'Collapse agents for Build the app').props.onPress());expect(button(tree,'View agent Reviewer')).toBeUndefined();
 expect(tree.root.findByProps({accessibilityLabel:'Search agents and sessions'})).toBe(search);
 await act(async()=>tree.unmount());
});
test('opened helper retains list and transcript identity with an in-flow Back bar',async()=>{
 const p=props(),selected={parentId:7,agent:sessions[0].agents[0],title:sessions[0].title};let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...p} selected={selected}><View testID="retained-agent-transcript"/></AgentsScreen>);});
 const transcript=tree.root.findByProps({testID:'retained-agent-transcript'}),list=tree.root.findByProps({testID:'agent-session-tree'});
 expect(text(tree)).toContain('View only');act(()=>button(tree,'Back to agent list').props.onPress());expect(p.onBack).toHaveBeenCalled();
 await act(async()=>tree.update(<AgentsScreen {...p} selected={selected} visible={false}><View testID="retained-agent-transcript"/></AgentsScreen>));
 expect(tree.root.findByProps({testID:'agents-screen'}).props.pointerEvents).toBe('none');expect(tree.root.findByProps({testID:'retained-agent-transcript'})).toBe(transcript);expect(tree.root.findByProps({testID:'agent-session-tree'})).toBe(list);
 await act(async()=>tree.unmount());
});
test('empty, refresh failure, loading, retry and continuation remain actionable',async()=>{
 const p=props(),retry=jest.fn(),more=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...p} sessions={[]} loading>{null}</AgentsScreen>);});expect(text(tree)).toContain('Loading sessions…');
 await act(async()=>tree.update(<AgentsScreen {...p} sessions={[]} error="Offline; status unknown" onRetry={retry} hasMore onLoadMore={more}>{null}</AgentsScreen>));
 expect(text(tree)).toContain('Sessions could not be loaded');expect(text(tree)).toContain('Offline; status unknown');act(()=>button(tree,'Retry agent overview').props.onPress());expect(retry).toHaveBeenCalled();
 act(()=>button(tree,'Load more agent sessions').props.onPress());expect(more).toHaveBeenCalled();await act(async()=>tree.unmount());
});
test('search stays above the list while the borderless action bar reserves its own space',async()=>{
 const p=props();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...p} onNew={jest.fn()} onSchedules={jest.fn()} menu={<View testID="agents-menu-control"/>}>{null}</AgentsScreen>);});
 const footer=tree.root.findByType(SectionActions);expect(footer.props.overlay).not.toBe(true);
 expect(footer.findByProps({testID:'section-footer-menu'}).findByProps({testID:'agents-menu-control'})).toBeDefined();
 expect(footer.findAllByProps({accessibilityLabel:'Search agents and sessions'})).toHaveLength(0);
 expect(tree.root.findByProps({testID:'sessions-search-and-filters'}).findByProps({accessibilityLabel:'Search agents and sessions'})).toBeDefined();
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'sessions-bottom-bar'}).props.style)).toMatchObject({flexShrink:0});
 expect(StyleSheet.flatten(footer.findByProps({testID:'section-footer'}).props.style).backgroundColor).not.toBe('transparent');
 expect(StyleSheet.flatten(footer.findByProps({testID:'section-footer'}).props.style).borderTopWidth).toBe(0);
 const fades=tree.root.findByProps({testID:'sessions-scroll-region'}).findAllByType(EdgeFade);expect(fades.map(node=>[node.props.edge,node.props.height])).toEqual([['top',16],['bottom',24]]);
 expect(tree.root.findAllByProps({testID:'section-footer-overlay'})).toHaveLength(0);expect(button(tree,'New session')).toBeDefined();expect(button(tree,'Agent history')).toBeUndefined();
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'agent-session-tree'}).props.contentContainerStyle).paddingBottom).toBe(24);
 await act(async()=>tree.unmount());
});
test('large branches give each helper an independently virtualized row with stable parent-scoped identity',async()=>{
 const p=props(),many:AgentSession={...sessions[0],agents:Array.from({length:1000},(_,index)=>({name:'Helper '+index,conversationId:index+100,status:'idle'}))};let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...p} sessions={[many]} history>{null}</AgentsScreen>);});
 const list=tree.root.findByProps({testID:'agent-session-tree'});
 expect(list.props.data).toHaveLength(1001);
 expect(list.props.data[0].kind).toBe('session');expect(list.props.data[1].kind).toBe('agent');
 expect(list.props.keyExtractor(list.props.data[1])).toBe('agent:7:100');
 await act(async()=>tree.unmount());
});
test('session controls are sibling targets in the tree, with inline filters and page actions',async()=>{
 const p=props(),onSessionAction=jest.fn(async()=>{}),onFilterChange=jest.fn(),onNew=jest.fn(),onSchedules=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...p} onSessionAction={onSessionAction} onFilterChange={onFilterChange} onNew={onNew} onSchedules={onSchedules}>{null}</AgentsScreen>);});
 expect(button(tree,'Manage sessions')).toBeUndefined();
 const root=button(tree,'Open Bob session Build the app'),controls=button(tree,'Session controls for Build the app');
 expect(root.findAllByProps({accessibilityLabel:'Session controls for Build the app'})).toHaveLength(0);
 act(()=>controls.props.onPress());expect(p.onOpenSession).not.toHaveBeenCalled();expect(p.onSelect).not.toHaveBeenCalled();
 act(()=>button(tree,'Rename').props.onPress());act(()=>tree.root.findByProps({accessibilityLabel:'Conversation name'}).props.onChangeText('A better title'));
 await act(async()=>button(tree,'Save conversation name').props.onPress());expect(onSessionAction).toHaveBeenCalledWith('7','rename','A better title');
 expect(tree.root.findAllByProps({testID:'inline-session-actions'})).toHaveLength(0);
 act(()=>root.props.onLongPress());await act(async()=>button(tree,'Pin to top').props.onPress());expect(onSessionAction).toHaveBeenLastCalledWith('7','pin',undefined);
 act(()=>button(tree,'New session').props.onPress());expect(onNew).toHaveBeenCalled();act(()=>button(tree,'Schedules').props.onPress());expect(onSchedules).toHaveBeenCalled();
 act(()=>button(tree,'Session filter: Active').props.onPress());act(()=>button(tree,'Trash').props.onPress());expect(onFilterChange).toHaveBeenCalledWith('trash');
 await act(async()=>tree.unmount());
});
test('archived and trash rows expose reversal actions; pinned sessions sort first',async()=>{
 const p=props(),onSessionAction=jest.fn(async()=>{});let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...p} sessions={[sessions[0],{...sessions[1],pinned:true,archived:true}]} onSessionAction={onSessionAction}>{null}</AgentsScreen>);});
 expect(tree.root.findByProps({testID:'agent-session-tree'}).props.data[0].session.conversationId).toBe(20);
 act(()=>button(tree,'Session controls for Research trip').props.onPress());expect(button(tree,'Unpin')).toBeDefined();await act(async()=>button(tree,'Unarchive').props.onPress());expect(onSessionAction).toHaveBeenLastCalledWith('20','unarchive',undefined);
 await act(async()=>tree.update(<AgentsScreen {...p} sessions={[{...sessions[1],trashed:true}]} filter="trash" onSessionAction={onSessionAction}>{null}</AgentsScreen>));
 act(()=>button(tree,'Session controls for Research trip').props.onPress());expect(button(tree,'Delete')).toBeUndefined();await act(async()=>button(tree,'Restore conversation').props.onPress());expect(onSessionAction).toHaveBeenLastCalledWith('20','restore',undefined);
 await act(async()=>tree.unmount());
});
test('pending session mutations cannot double-submit and errors preserve the current chat',async()=>{
 const p=props();let reject!:(error:Error)=>void;const onSessionAction=jest.fn(()=>new Promise<void>((_resolve,fail)=>{reject=fail;}));let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...p} onSessionAction={onSessionAction}>{null}</AgentsScreen>);});
 act(()=>button(tree,'Session controls for Build the app').props.onPress());const pin=button(tree,'Pin to top');act(()=>{pin.props.onPress();pin.props.onPress();});expect(onSessionAction).toHaveBeenCalledTimes(1);
 await act(async()=>reject(Error('Connection lost; check before trying again.')));expect(text(tree)).toContain('Connection lost');expect(p.onOpenSession).not.toHaveBeenCalled();
 act(()=>button(tree,'Close session controls').props.onPress());expect(tree.root.findAllByProps({testID:'inline-session-actions'})).toHaveLength(0);
 await act(async()=>tree.unmount());
});
test('zero-helper rows stay compact and unknown execution is not fabricated as waiting or failed',async()=>{
 const p=props(),onFilterChange=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...p} sessions={[{conversationId:90,title:'A descriptive conversation title',status:'unknown',agents:[]}]} currentSessionId={90} onFilterChange={onFilterChange} onNew={jest.fn()}>{null}</AgentsScreen>);});
 const row=button(tree,'Open Bob session A descriptive conversation title');expect(row.props.accessibilityState.selected).toBe(true);
 expect(tree.root.findByProps({testID:'agent-session-tree'}).props.data).toHaveLength(1);
 expect(tree.root.findAll(node=>typeof node.props.accessibilityLabel==='string'&&/^(Expand|Collapse) agents/.test(node.props.accessibilityLabel))).toHaveLength(0);
 expect(text(tree)).not.toMatch(/No (working )?helpers|Waiting|Failed|History|Work PC/);
 expect(tree.root.findByProps({accessibilityLabel:'Session status: Status unavailable'})).toBeDefined();
 expect(StyleSheet.flatten(row.props.style).minHeight).toBe(48);
 expect(button(tree,'New session').findAll(node=>node.props.children==='New session')).toHaveLength(0);expect(StyleSheet.flatten(button(tree,'New session').props.style)).toMatchObject({width:48,height:48});
 act(()=>button(tree,'Session filter: Active').props.onPress());act(()=>button(tree,'Active').props.onPress());expect(onFilterChange).toHaveBeenCalledWith('all');
 await act(async()=>tree.unmount());
});
test('keyboard inset and filter updates retain search and list; initial failures never claim an empty Trash',async()=>{
 const p=props();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AgentsScreen {...p} onFilterChange={jest.fn()}>{null}</AgentsScreen>);});
 const search=tree.root.findByProps({accessibilityLabel:'Search agents and sessions'}),list=tree.root.findByProps({testID:'agent-session-tree'});
 act(()=>search.props.onChangeText('preserved query'));
 await act(async()=>tree.update(<AgentsScreen {...p} filter="trash" bottomInset={280} sessions={[]} error="Offline" onRetry={jest.fn()}>{null}</AgentsScreen>));
 expect(tree.root.findByProps({accessibilityLabel:'Search agents and sessions'})).toBe(search);expect(search.props.value).toBe('preserved query');expect(tree.root.findByProps({testID:'agent-session-tree'})).toBe(list);
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'agents-screen'}).props.style).bottom).toBe(280);
 expect(text(tree)).toContain('Sessions could not be loaded');expect(text(tree)).not.toContain('Trash is empty');
 await act(async()=>tree.unmount());
});

test('one filter selector replaces permanent filter tabs and preserves the list through radio choices',async()=>{
 const p=props(),change=jest.fn();let tree!:Renderer.ReactTestRenderer;
 const render=(filter:'all'|'archived'|'trash')=><AgentsScreen {...p} filter={filter} onFilterChange={change} onNew={()=>{}} onSchedules={()=>{}}>{null}</AgentsScreen>;
 await act(async()=>{tree=Renderer.create(render('all'));});
 try{
  const list=tree.root.findByProps({testID:'agent-session-tree'}),field=tree.root.findByProps({accessibilityLabel:'Search agents and sessions'}),footer=tree.root.findByProps({testID:'sessions-bottom-bar'}),header=tree.root.findByProps({testID:'sessions-search-and-filters'});
  expect(header.findAllByProps({accessibilityRole:'tablist'})).toHaveLength(0);expect(header.findAllByType(PageSearch)).toHaveLength(1);
  expect(list.findAllByProps({testID:'sessions-footer-filters'})).toHaveLength(0);
  for(const [filter,label] of [['all','Active'],['archived','Archived'],['trash','Trash']] as const){
   await act(async()=>tree.update(render(filter)));
   const selector=button(tree,`Session filter: ${label}`);
   expect(footer.findAll(node=>node.props.accessibilityLabel===`Session filter: ${label}`&&typeof node.props.onPress==='function')).toHaveLength(1);
   expect(button(tree,label)).toBeUndefined();act(()=>selector.props.onPress());
   const tab=button(tree,label);expect(tab.props.accessibilityState.checked).toBe(true);
   expect(tree.root.findByProps({testID:'agent-screen-content'}).props.importantForAccessibility).toBe('no-hide-descendants');
   act(()=>tab.props.onPress());expect(change).toHaveBeenLastCalledWith(filter);expect(tree.root.findAllByType(Modal)).toHaveLength(0);
   expect(tree.root.findByProps({testID:'agent-session-tree'})===list).toBe(true);expect(tree.root.findByProps({accessibilityLabel:'Search agents and sessions'})===field).toBe(true);
  }
  expect(StyleSheet.flatten(footer.props.style).position).toBeUndefined();
 }finally{await act(async()=>tree.unmount());}
});

test('filter cancellation, native Back and hiding the page never change membership or remount the list',async()=>{
 const p=props(),change=jest.fn();let tree!:Renderer.ReactTestRenderer;
 const render=(visible=true)=><AgentsScreen {...p} visible={visible} filter="archived" onFilterChange={change} onNew={()=>{}} onSchedules={()=>{}}>{null}</AgentsScreen>;
 await act(async()=>{tree=Renderer.create(render());});
 try{
  const list=tree.root.findByProps({testID:'agent-session-tree'}),field=tree.root.findByProps({accessibilityLabel:'Search agents and sessions'});
  act(()=>field.props.onChangeText('kept query'));
  for(const dismiss of ['Close session filters','Dismiss session filters','native Back']){
   act(()=>button(tree,'Session filter: Archived').props.onPress());expect(button(tree,'Archived').props.accessibilityState.checked).toBe(true);
   if(dismiss==='native Back')act(()=>tree.root.findByType(Modal).props.onRequestClose());else act(()=>button(tree,dismiss).props.onPress());
   expect(tree.root.findAllByType(Modal)).toHaveLength(0);expect(change).not.toHaveBeenCalled();
   expect(tree.root.findByProps({testID:'agent-session-tree'})===list).toBe(true);expect(field.props.value).toBe('kept query');
   expect(tree.root.findByProps({testID:'agent-screen-content'}).props.importantForAccessibility).toBe('auto');
  }
  act(()=>button(tree,'Session filter: Archived').props.onPress());await act(async()=>tree.update(render(false)));
  expect(tree.root.findAllByType(Modal)).toHaveLength(0);await act(async()=>tree.update(render()));expect(tree.root.findAllByType(Modal)).toHaveLength(0);
  expect(change).not.toHaveBeenCalled();expect(p.onSelect).not.toHaveBeenCalled();expect(p.onOpenSession).not.toHaveBeenCalled();
 }finally{await act(async()=>tree.unmount());}
});

test('lean row controls are unboxed metadata siblings and the single toolbar uses compact accessible icon targets',async()=>{
 const p=props();let tree!:Renderer.ReactTestRenderer;await act(async()=>{tree=Renderer.create(<AgentsScreen {...p} onSessionAction={async()=>{}} onFilterChange={()=>{}} onNew={()=>{}} onSchedules={()=>{}}>{null}</AgentsScreen>);});
 try{
  const open=button(tree,'Open Bob session Build the app'),helper=button(tree,'Expand agents for Build the app'),overflow=button(tree,'Session controls for Build the app');
  expect(open.findAll(node=>node.props.accessibilityLabel==='Expand agents for Build the app')).toHaveLength(0);
  expect(tree.root.findByProps({testID:'session-metadata-7'}).findAll(node=>node.props.accessibilityLabel==='Expand agents for Build the app'&&typeof node.props.onPress==='function')).toHaveLength(1);
  for(const item of [helper,overflow,button(tree,'Schedules'),button(tree,'Session filter: Active')]){
   const style=StyleSheet.flatten(item.props.style);expect(style.minHeight).toBeGreaterThanOrEqual(48);
   for(const key of ['backgroundColor','borderWidth','borderRadius','boxShadow'])expect(style[key]).toBeUndefined();
  }
  expect(StyleSheet.flatten(button(tree,'New session').props.style)).toMatchObject({width:48,height:48});
  expect(tree.root.findAllByProps({testID:'sessions-footer-filters'})).toHaveLength(0);expect(tree.root.findAllByType(SectionActions)).toHaveLength(1);
  for(const view of tree.root.findAllByType(View))expect(view.children.filter(child=>typeof child==='string')).toEqual([]);
 }finally{await act(async()=>tree.unmount());}
});
