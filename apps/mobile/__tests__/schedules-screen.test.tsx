import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {AppState,StyleSheet,View} from 'react-native';
import {SectionHeading,RoundAction} from '../components/section-ui';
import {colors} from '../theme';
import {SchedulesScreen,ScheduleReceipt,ScheduleAlert,scheduleFrequency,type ScheduleJob} from '../components/schedules-screen';
jest.mock('uuid',()=>({v4:()=> '11111111-1111-4111-8111-111111111111'}));
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
const job:ScheduleJob={id:'a'.repeat(32),revision:3,conversationId:9,title:'Check release notes',kind:'check',text:'Only report a new stable release.',timezone:'Europe/Warsaw',firstRunAt:1800000000000,nextRunAt:1800000000000,intervalMs:172800000,maxRuns:20,stopOnMatch:true,state:'active',runs:1,history:[{number:1,dueAt:1799900000000,startedAt:1799900000000,finishedAt:1799900000100,outcome:'no_change',lateByMs:0}]};
const text=(tree:Renderer.ReactTestRenderer)=>tree.root.findAll(n=>n.props.children!=null).map(n=>React.Children.toArray(n.props.children).filter(c=>typeof c==='string'||typeof c==='number').join('')).join(' ');
const press=(tree:Renderer.ReactTestRenderer,label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0].props.onPress();
beforeEach(()=>{jest.spyOn(AppState,'addEventListener').mockReturnValue({remove:jest.fn()});});
afterEach(()=>jest.restoreAllMocks());

test('schedule list is a full overlay, shows honest timing, details, direct pause and source navigation',async()=>{
 let current=job;const request=jest.fn(async(_path:string,method?:string,body?:any)=>{if(method==='POST'){expect(body.operation).toEqual({action:'pause',id:job.id,expectedRevision:3});current={...job,state:'paused',revision:4,nextRunAt:undefined};return{persisted:true,...current};}return {jobs:[current]};});
 const compose=jest.fn(),open=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<SchedulesScreen visible request={request} onCompose={compose} onOpenChat={open}/>);});
 expect(StyleSheet.flatten(tree.root.findByProps({testID:'schedules-screen'}).props.style)).toMatchObject({position:'absolute',top:0,bottom:0,zIndex:25});
 expect(text(tree)).toContain('Every 2 days (elapsed)');expect(text(tree)).toContain('Last run: no change');
 await act(async()=>press(tree,'Check release notes, active. Show details'));
 expect(text(tree)).toContain('delivery is not confirmed here');
 await act(async()=>press(tree,'Open source chat'));expect(open).toHaveBeenCalledWith(9);
 await act(async()=>press(tree,'Edit in chat'));expect(compose.mock.calls[0][0]).toContain(job.id);
 await act(async()=>press(tree,'Pause'));
 expect(request.mock.calls.filter(([,method])=>method==='POST')).toHaveLength(1);
 await act(async()=>tree.root.findAll(n=>n.props.accessibilityRole==='tab'&&typeof n.props.onPress==='function')[1].props.onPress());
 expect(text(tree)).toContain('paused');expect(tree.root.findAll(n=>n.props.accessibilityLabel==='Resume'&&typeof n.props.onPress==='function').length).toBeGreaterThan(0);
 await act(async()=>tree.unmount());
});

test('errors offer refresh and never retry an uncertain mutation automatically',async()=>{
 const request=jest.fn(async(_path:string,method?:string)=>{if(method==='POST')throw Error('Connection lost');return {jobs:[job]};});let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<SchedulesScreen visible request={request} onCompose={()=>{}} onOpenChat={()=>{}}/>);});
 await act(async()=>press(tree,'Pause'));expect(text(tree)).toContain('Refresh to check the saved state');
 expect(request.mock.calls.filter(([,method])=>method==='POST')).toHaveLength(1);
 await act(async()=>press(tree,'Refresh saved state'));expect(request.mock.calls.filter(([,method])=>method==='POST')).toHaveLength(1);
 await act(async()=>tree.unmount());
});

test('receipt and alert are readable without an interactive web surface',async()=>{
 const open=jest.fn();let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<ScheduleReceipt job={job} onOpen={open}/>);});expect(text(tree)).toContain('Check release notes');expect(text(tree)).toContain('Next:');
 act(()=>press(tree,'View schedule Check release notes'));expect(open).toHaveBeenCalledTimes(1);
 await act(async()=>tree.update(<ScheduleAlert data={{title:'Reminder',text:'Leave for the appointment'}} onOpen={open}/>));expect(text(tree)).toContain('Leave for the appointment');
 await act(async()=>tree.unmount());
 expect(scheduleFrequency({...job,intervalMs:3600000})).toBe('Every 1 hour (elapsed)');
});

test('backend switch/unmount discards a late schedule response',async()=>{
 let resolve!:(value:unknown)=>void;const request=()=>new Promise(r=>{resolve=r;});let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<SchedulesScreen visible request={request} onCompose={()=>{}} onOpenChat={()=>{}}/>);});
 await act(async()=>tree.unmount());await act(async()=>resolve({jobs:[job]}));
});

test('hide/reopen cancels the old read and starts a fresh scoped read without waiting for its response',async()=>{
 let firstSignal:AbortSignal|undefined;
 const request=jest.fn().mockImplementationOnce((_path:string,_method?:string,_body?:unknown,signal?:AbortSignal)=>{firstSignal=signal;return new Promise(()=>{});}).mockResolvedValue({jobs:[job]});let tree!:Renderer.ReactTestRenderer;
 const props={request,onCompose:()=>{},onOpenChat:()=>{}};
 await act(async()=>{tree=Renderer.create(<SchedulesScreen visible {...props}/>);});
 await act(async()=>tree.update(<SchedulesScreen visible={false} {...props}/>));expect(firstSignal?.aborted).toBe(true);
 await act(async()=>tree.update(<SchedulesScreen visible {...props}/>));expect(request).toHaveBeenCalledTimes(2);expect(text(tree)).toContain(job.title);
 await act(async()=>tree.unmount());
});


test('schedule heading has return left and Refresh/Create right; cards and controls share menu chrome',async()=>{
 const back=jest.fn(),compose=jest.fn(),request=jest.fn(async()=>({jobs:[job]}));let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<SchedulesScreen visible request={request} onBack={back} onCompose={compose} onOpenChat={()=>{}}/>);});
 try{
  const heading=tree.root.findByType(SectionHeading);
  expect(heading.props).toMatchObject({title:'Schedules',subtitle:'This workstation',onBack:back});
  expect(heading.findAllByType(RoundAction).map(node=>node.props.label)).toEqual(['Back to previous menu','Refresh schedules','Create a schedule in chat']);
  const actions=heading.findByProps({testID:'section-heading-actions'});
  expect(actions.findAllByType(RoundAction).map(node=>node.props.label)).toEqual(['Refresh schedules','Create a schedule in chat']);
  expect(actions.findAllByType(RoundAction)[1].props.primary).toBe(true);
  act(()=>press(tree,'Back to previous menu'));expect(back).toHaveBeenCalledTimes(1);
  await act(async()=>press(tree,'Refresh schedules'));expect(request).toHaveBeenCalledTimes(2);
  act(()=>press(tree,'Create a schedule in chat'));expect(compose).toHaveBeenCalledWith('Create a schedule: ');
  const pause=tree.root.findAll(node=>node.props.accessibilityLabel==='Pause'&&typeof node.props.onPress==='function')[0];
  expect(StyleSheet.flatten(pause.props.style)).toMatchObject({borderRadius:14,borderWidth:1,borderColor:colors.border});
  expect(tree.root.findAllByType(View).some(node=>{const style=StyleSheet.flatten(node.props.style);return style?.borderRadius===20&&style.borderWidth===1&&style.borderColor===colors.border;})).toBe(true);
  await act(async()=>tree.update(<ScheduleReceipt job={job} onOpen={()=>{}}/>));
  const receipt=tree.root.findAll(node=>node.props.accessibilityLabel==='View schedule Check release notes'&&typeof node.props.onPress==='function')[0];
  expect(StyleSheet.flatten(receipt.props.style)).toMatchObject({borderRadius:20,borderWidth:1,borderColor:colors.border});
 }finally{await act(async()=>tree.unmount());}
});
