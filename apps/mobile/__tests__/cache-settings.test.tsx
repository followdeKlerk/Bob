import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Alert,BackHandler,Platform,ScrollView,StyleSheet,Text} from 'react-native';
import {CacheSettings,formatCacheBytes} from '../components/cache-settings';
import {getCachePreferences,getCacheUsage,updateCachePreferences,clearDownloadedCache,subscribeCachePreferences} from '../download-cache';
import {ThemeContext,tokens} from '../theme-context';
import {menuRadii} from '../theme-tokens';
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_,name)=>name==='__esModule'?true:()=>null}));
jest.mock('../haptics',()=>({selectionHaptic:jest.fn()}));
jest.mock('../download-cache',()=>({getCachePreferences:jest.fn(),getCacheUsage:jest.fn(),updateCachePreferences:jest.fn(),clearDownloadedCache:jest.fn(),subscribeCachePreferences:jest.fn(),HISTORY_CACHE_MAX_BYTES:128*1024*1024}));
let tree:Renderer.ReactTestRenderer|undefined;
let preferences:{chatLists:boolean;history:boolean;maxConversations:number};
let listeners:Set<()=>void>;
function control(label:string){return tree!.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];}
function text(){return JSON.stringify(tree!.toJSON());}
function visibleText(){return tree!.root.findAllByType(Text).map(node=>React.Children.toArray(node.props.children).filter(child=>typeof child==='string'||typeof child==='number').join('')).join(' ');}
function view(active=true,scheme:'light'|'dark'='light'){return <ThemeContext.Provider value={tokens[scheme]}><CacheSettings active={active}/></ThemeContext.Provider>;}
async function mount(active=true,scheme:'light'|'dark'='light'){await act(async()=>{tree=Renderer.create(view(active,scheme));});}
async function openLimit(){await act(async()=>control('Cached conversation limit').props.onPress());}
async function confirm(){const buttons=(Alert.alert as jest.Mock).mock.calls.at(-1)[2];await act(async()=>buttons.find((button:any)=>button.style==='destructive').onPress());}
beforeEach(()=>{
 jest.clearAllMocks();preferences={chatLists:true,history:true,maxConversations:50};listeners=new Set();
 (getCachePreferences as jest.Mock).mockImplementation(async()=>({...preferences}));
 (getCacheUsage as jest.Mock).mockResolvedValue({chatLists:{bytes:1024,entries:2},history:{bytes:4096,conversations:3},totalBytes:5120});
 (updateCachePreferences as jest.Mock).mockImplementation(async(patch)=>{preferences={...preferences,...patch};listeners.forEach(listener=>listener());return {...preferences};});
 (clearDownloadedCache as jest.Mock).mockResolvedValue(undefined);
 (subscribeCachePreferences as jest.Mock).mockImplementation(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};});
 jest.spyOn(Alert,'alert').mockImplementation(()=>{});
});
afterEach(async()=>{if(tree){await act(async()=>tree!.unmount());tree=undefined;}jest.useRealTimers();jest.restoreAllMocks();});

test.each(['light','dark'] as const)('%s cache settings use four compact cards with details and limit choices out of the way',async scheme=>{
 await mount(true,scheme);
 expect(tree!.root.findAllByType(Text).filter(node=>node.props.accessibilityRole==='header').map(node=>node.props.children)).toEqual(['Cached on this device','Limit','Usage','Reset Cache']);
 expect(control('Cache conversation history').props.accessibilityState.checked).toBe(true);
 expect(control('Cached conversation limit').props.accessibilityState.expanded).toBe(false);
 expect(control('Cached conversation limit').props.accessibilityValue.text).toBe('50 chats');
 expect(control('Cache up to 50 conversations')).toBeUndefined();
 expect(visibleText()).toContain('5.0 KiB');expect(visibleText()).toContain('Keep Up To: 50 chats');
 expect(StyleSheet.flatten(control('Clear downloaded chat cache').findAllByType(Text)[0].props.style).color).toBe(tokens[scheme].colors.danger);
 expect(visibleText().split(/\s+/).length).toBeLessThan(80);
 expect(text()).not.toContain('128.0 MiB');expect(text()).not.toContain('secure erasure');expect(visibleText()).not.toContain('Files & Links');
 expect(tree!.root.findAllByType(ScrollView)).toHaveLength(0);
 for(const title of ['Cached on this device','Limit','Usage','Reset Cache']){
  const style=StyleSheet.flatten(tree!.root.findByProps({testID:`cache-card:${title}`}).props.style);
  expect(style.backgroundColor).toBe(tokens[scheme].colors.panel);expect(style.borderRadius).toBe(menuRadii.card);expect(style.borderWidth).toBe(1);expect(style.borderColor).toBe(tokens[scheme].colors.subtle);expect(style.height).toBeUndefined();expect(style.overflow).not.toBe('hidden');
 }
 for(const label of ['About caching','Refresh usage','Cached conversation limit','Clear downloaded chat cache'])expect(StyleSheet.flatten(control(label).props.style).minHeight).toBeGreaterThanOrEqual(48);
 await openLimit();expect(control('Cached conversation limit').props.accessibilityState.expanded).toBe(true);
 expect(control('Cache up to 50 conversations').props.accessibilityState.checked).toBe(true);
 for(const count of [10,25,50,100,200,500])expect(StyleSheet.flatten(control(`Cache up to ${count} conversations`).props.style).minHeight).toBeGreaterThanOrEqual(48);
 for(const node of tree!.root.findAllByType(Text)){expect(node.props.allowFontScaling).not.toBe(false);expect(node.props.numberOfLines).toBeUndefined();expect(node.props.adjustsFontSizeToFit).not.toBe(true);}
 await act(async()=>control('Cache up to 25 conversations').props.onPress());
 expect(updateCachePreferences).toHaveBeenCalledWith({maxConversations:25});
 expect(control('Cached conversation limit').props.accessibilityValue.text).toBe('25 chats');
 expect(control('Cached conversation limit').props.accessibilityState.expanded).toBe(false);
 await openLimit();expect(control('Cache up to 25 conversations').props.accessibilityState.checked).toBe(true);
 await act(async()=>control('Cache up to 25 conversations').props.onPress());
 expect(control('Cached conversation limit').props.accessibilityState.expanded).toBe(false);
 expect(updateCachePreferences).toHaveBeenCalledTimes(1);
});

test('saved controls become usable before a slow usage measurement finishes',async()=>{
 let finish!:(value:any)=>void;
 (getCacheUsage as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await mount();
 expect(control('Cache conversation history').props.disabled).toBe(false);
 expect(control('Cache conversation history').props.accessibilityState.checked).toBe(true);
 expect(control('Cached conversation limit').props.accessibilityValue.text).toBe('50 chats');
 expect(visibleText()).toContain('Measuring cache');expect(visibleText()).not.toContain('0 B');
 await act(async()=>finish({chatLists:{bytes:1024,entries:2},history:{bytes:4096,conversations:3},totalBytes:5120}));
 expect(visibleText()).toContain('5.0 KiB');expect(visibleText()).not.toContain('Measuring cache');
});

test('usage timeout offers retry without disabling saved controls or accepting a stale result',async()=>{
 jest.useFakeTimers();let finish!:(value:any)=>void;
 (getCacheUsage as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await mount();await act(async()=>{await jest.advanceTimersByTimeAsync(10000);});
 expect(visibleText()).toContain('Cache measurement took too long');expect(visibleText()).not.toContain('Measuring cache');
 expect(control('Cache conversation history').props.disabled).toBe(false);expect(control('Refresh usage').props.disabled).toBe(false);
 expect(control('Retry cache settings').props.disabled).toBe(false);expect(visibleText()).not.toContain('0 B');
 await act(async()=>control('Retry cache settings').props.onPress());expect(visibleText()).toContain('5.0 KiB');
 await act(async()=>finish({chatLists:{bytes:0,entries:0},history:{bytes:0,conversations:0},totalBytes:0}));
 expect(visibleText()).toContain('5.0 KiB');expect(visibleText()).not.toContain('0 B');
 expect(updateCachePreferences).not.toHaveBeenCalled();expect(clearDownloadedCache).not.toHaveBeenCalled();
});

test('a late read rejection stays handled after its observer timed out and a retry succeeded',async()=>{
 jest.useFakeTimers();let fail!:(error:Error)=>void;
 (getCacheUsage as jest.Mock).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{fail=reject;}));
 await mount();await act(async()=>{await jest.advanceTimersByTimeAsync(10000);});
 await act(async()=>control('Retry cache settings').props.onPress());expect(visibleText()).toContain('5.0 KiB');
 await act(async()=>fail(Error('synthetic late read failure')));
 expect(visibleText()).toContain('5.0 KiB');expect(visibleText()).not.toContain('unavailable');
});

test('unsettled policy reads fail closed after a deadline and do not hide completed usage',async()=>{
 jest.useFakeTimers();let finish!:(value:any)=>void;
 (getCachePreferences as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await mount();expect(visibleText()).toContain('5.0 KiB');expect(control('Cache conversation history').props.disabled).toBe(true);
 await act(async()=>{await jest.advanceTimersByTimeAsync(10000);});
 expect(visibleText()).toContain('Cache settings took too long');expect(visibleText()).toContain('Controls are disabled');
 expect(control('Cached conversation limit').props.accessibilityValue.text).toBe('Unavailable');
 expect(control('Clear downloaded chat cache').props.disabled).toBe(true);expect(control('Retry cache settings').props.disabled).toBe(false);
 await act(async()=>finish({...preferences,history:false,maxConversations:10}));
 expect(control('Clear downloaded chat cache').props.disabled).toBe(true);
 await act(async()=>control('Retry cache settings').props.onPress());
 expect(control('Cache conversation history').props.accessibilityState.checked).toBe(true);
 expect(control('Cached conversation limit').props.accessibilityValue.text).toBe('50 chats');
 expect(updateCachePreferences).not.toHaveBeenCalled();
});

test('synchronous adapter errors are shown instead of leaving a rejected refresh stuck loading',async()=>{
 (getCachePreferences as jest.Mock).mockImplementationOnce(()=>{throw Error('synthetic adapter failure');});
 await mount();expect(visibleText()).toContain('Could not read the saved cache settings');expect(visibleText()).toContain('5.0 KiB');
 expect(control('Retry cache settings').props.disabled).toBe(false);expect(control('Cached conversation limit').props.accessibilityValue.text).toBe('Unavailable');
});

test('hidden and unmounted views stop waiting without applying late results or leaking read timers',async()=>{
 jest.useFakeTimers();let oldPolicy!:(value:any)=>void,oldUsage!:(value:any)=>void;
 const scheduled=jest.spyOn(globalThis,'setTimeout'),cleared=jest.spyOn(globalThis,'clearTimeout');
 const readTimers=()=>scheduled.mock.calls.flatMap((call,index)=>call[1]===10000?[scheduled.mock.results[index].value]:[]);
 (getCachePreferences as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{oldPolicy=resolve;}));
 (getCacheUsage as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{oldUsage=resolve;}));
 await mount();const first=readTimers();expect(first).toHaveLength(2);
 await act(async()=>tree!.update(view(false)));for(const timer of first)expect(cleared).toHaveBeenCalledWith(timer);
 await act(async()=>tree!.update(view(true)));expect(control('Cached conversation limit').props.accessibilityValue.text).toBe('50 chats');
 await act(async()=>{oldPolicy({...preferences,maxConversations:10});oldUsage({chatLists:{bytes:0,entries:0},history:{bytes:0,conversations:0},totalBytes:0});});
 expect(control('Cached conversation limit').props.accessibilityValue.text).toBe('50 chats');expect(visibleText()).toContain('5.0 KiB');
 (getCacheUsage as jest.Mock).mockImplementationOnce(()=>new Promise(()=>{}));
 await act(async()=>control('Refresh usage').props.onPress());
 await act(async()=>tree!.unmount());tree=undefined;for(const timer of readTimers())expect(cleared).toHaveBeenCalledWith(timer);
});

test('a completed change is not held busy by its follow-up usage scan',async()=>{
 jest.useFakeTimers();await mount();
 (getCacheUsage as jest.Mock).mockImplementation(()=>new Promise(()=>{}));
 await act(async()=>control('Cache conversation history').props.onPress());await confirm();
 expect(updateCachePreferences).toHaveBeenCalledWith({history:false});expect(control('Cache conversation history').props.accessibilityState.checked).toBe(false);
 expect(control('Clear downloaded chat cache').props.disabled).toBe(false);expect(control('Refresh usage').props.disabled).toBe(true);
 expect(visibleText()).toContain('caching is off');
});

test('a read deadline never unlocks or repeats an unsettled clear operation',async()=>{
 jest.useFakeTimers();let finish!:()=>void;
 (clearDownloadedCache as jest.Mock).mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 await mount();await act(async()=>control('Clear downloaded chat cache').props.onPress());await confirm();
 await act(async()=>{await jest.advanceTimersByTimeAsync(20000);});await confirm();
 expect(clearDownloadedCache).toHaveBeenCalledTimes(1);expect(control('Clear downloaded chat cache').props.disabled).toBe(true);
 expect(visibleText()).not.toContain('Downloaded chat cache cleared.');
 await act(async()=>finish());expect(visibleText()).toContain('Downloaded chat cache cleared.');
});

test('the info action explains scope and safeguards on demand without adding page paragraphs or changing policy',async()=>{
 await mount();expect(Alert.alert).not.toHaveBeenCalled();
 await act(async()=>control('About caching').props.onPress());
 const [title,detail]=(Alert.alert as jest.Mock).mock.calls.at(-1);
 expect(title).toBe('About caching');
 for(const phrase of ['all workstations','128.0 MiB','two live sessions','drafts or queued messages','not total app storage','file previews','not secure erasure'])expect(detail).toContain(phrase);
 expect(text()).not.toContain('secure erasure');expect(updateCachePreferences).not.toHaveBeenCalled();expect(clearDownloadedCache).not.toHaveBeenCalled();
});

test('Android Back closes the limit selector without changing the cache setting',async()=>{
 jest.replaceProperty(Platform,'OS','android');
 const callbacks:Array<Parameters<typeof BackHandler.addEventListener>[1]>=[],remove=jest.fn();
 jest.spyOn(BackHandler,'addEventListener').mockImplementation((_event,callback)=>{callbacks.push(callback);return {remove};});
 await mount();expect(callbacks).toHaveLength(0);await openLimit();expect(callbacks).toHaveLength(1);
 await act(async()=>{expect(callbacks[0]({type:'hardwareBackPress',timeStamp:0})).toBe(true);});
 expect(remove).toHaveBeenCalled();expect(control('Cached conversation limit').props.accessibilityState.expanded).toBe(false);
 expect(control('Cache up to 50 conversations')).toBeUndefined();expect(updateCachePreferences).not.toHaveBeenCalled();
});

test('hiding a retained settings page closes its selector and fences a stale choice callback',async()=>{
 await mount();await openLimit();const choose=control('Cache up to 25 conversations').props.onPress;
 await act(async()=>tree!.update(view(false)));await act(async()=>choose());
 expect(updateCachePreferences).not.toHaveBeenCalled();expect(control('Cached conversation limit').props.accessibilityState.expanded).toBe(false);
 await act(async()=>tree!.update(view(true)));
 expect(control('Cached conversation limit').props.accessibilityState.expanded).toBe(false);expect(control('Cached conversation limit').props.accessibilityValue.text).toBe('50 chats');
});

test('turning caching off requires confirmation and retains an accurate saved switch; enabling is non-destructive',async()=>{
 await mount();await act(async()=>control('Cache conversation history').props.onPress());
 expect(updateCachePreferences).not.toHaveBeenCalled();expect(Alert.alert).toHaveBeenCalled();
 await confirm();expect(updateCachePreferences).toHaveBeenCalledWith({history:false});
 expect(control('Cache conversation history').props.accessibilityState.checked).toBe(false);
 expect(control('Cached conversation limit').props.disabled).toBe(true);
 await openLimit();expect(control('Cache up to 25 conversations')).toBeUndefined();
 (Alert.alert as jest.Mock).mockClear();await act(async()=>control('Cache conversation history').props.onPress());
 expect(updateCachePreferences).toHaveBeenLastCalledWith({history:true});expect(Alert.alert).not.toHaveBeenCalled();
});

test('clear is explicit, keeps unrelated storage outside its scope, and reports failure rather than false success',async()=>{
 await mount();await act(async()=>control('Clear downloaded chat cache').props.onPress());
 expect(clearDownloadedCache).not.toHaveBeenCalled();
 expect((Alert.alert as jest.Mock).mock.calls.at(-1)[1]).toContain('Notes, pairings and APK downloads are kept');
 (clearDownloadedCache as jest.Mock).mockRejectedValueOnce(Error('synthetic storage error'));
 await confirm();expect(clearDownloadedCache).toHaveBeenCalledWith('all');
 expect(text()).toContain('Some cached copies may remain');expect(text()).not.toContain('Downloaded chat cache cleared.');
 await act(async()=>control('Clear downloaded chat cache').props.onPress());await confirm();
 expect(text()).toContain('Downloaded chat cache cleared. Open sessions are unchanged.');
});

test('a confirmation from a hidden or unmounted settings page cannot clear anything',async()=>{
 await mount();await act(async()=>control('Clear downloaded chat cache').props.onPress());
 await act(async()=>tree!.update(view(false)));await confirm();
 expect(clearDownloadedCache).not.toHaveBeenCalled();
 await act(async()=>tree!.unmount());tree=undefined;await confirm();expect(clearDownloadedCache).not.toHaveBeenCalled();
});

test('unreadable saved preferences disable mutation rather than assuming caching is enabled',async()=>{
 (getCachePreferences as jest.Mock).mockRejectedValue(Error('synthetic settings error'));
 await mount();expect(text()).toContain('Controls are disabled');
 expect(control('Cache conversation history').props.disabled).toBe(true);
 expect(control('Clear downloaded chat cache').props.disabled).toBe(true);
 await act(async()=>control('Cache conversation history').props.onPress());expect(updateCachePreferences).not.toHaveBeenCalled();
 (getCachePreferences as jest.Mock).mockResolvedValue({...preferences,history:false});
 await act(async()=>control('Retry cache settings').props.onPress());
 expect(control('Cache conversation history').props.disabled).toBe(false);expect(control('Cache conversation history').props.accessibilityState.checked).toBe(false);
});

test('preference changes from another retained settings view refresh this view without local write-back',async()=>{
 await mount();preferences={...preferences,chatLists:false,maxConversations:100};
 await act(async()=>listeners.forEach(listener=>listener()));
 expect(control('Cache conversation lists').props.accessibilityState.checked).toBe(false);
 expect(control('Cached conversation limit').props.accessibilityValue.text).toBe('100 chats');
 await openLimit();expect(control('Cache up to 100 conversations').props.accessibilityState.checked).toBe(true);
 preferences={...preferences,history:false};await act(async()=>listeners.forEach(listener=>listener()));
 expect(control('Cached conversation limit').props.disabled).toBe(true);expect(control('Cached conversation limit').props.accessibilityState.expanded).toBe(false);
 preferences={...preferences,history:true};await act(async()=>listeners.forEach(listener=>listener()));
 expect(control('Cached conversation limit').props.accessibilityState.expanded).toBe(false);
 expect(updateCachePreferences).not.toHaveBeenCalled();
});

test('usage measurement failures remain visible and refresh restores real values, including an empty cache',async()=>{
 (getCacheUsage as jest.Mock).mockRejectedValueOnce(Error('synthetic usage failure'));
 await mount();expect(visibleText()).toContain('Storage usage unavailable');expect(visibleText()).not.toContain('0 B');expect(visibleText()).not.toContain('5.0 KiB');
 (getCacheUsage as jest.Mock).mockResolvedValue({chatLists:{bytes:0,entries:0},history:{bytes:0,conversations:0},totalBytes:0});
 await act(async()=>control('Refresh usage').props.onPress());
 expect(visibleText()).not.toContain('unavailable');expect(visibleText()).toContain('0 B');
 expect(tree!.root.findAllByProps({accessibilityLabel:'Cached chats: 0'}).length).toBeGreaterThan(0);
 expect(updateCachePreferences).not.toHaveBeenCalled();
});

test('an in-flight clear cannot be submitted twice and does not claim success before completion',async()=>{
 let resolve!:()=>void;(clearDownloadedCache as jest.Mock).mockImplementation(()=>new Promise<void>(done=>{resolve=done;}));
 await mount();await act(async()=>control('Clear downloaded chat cache').props.onPress());await confirm();await confirm();
 expect(clearDownloadedCache).toHaveBeenCalledTimes(1);expect(control('Clear downloaded chat cache').props.disabled).toBe(true);
 expect(text()).not.toContain('Downloaded chat cache cleared.');
 await act(async()=>resolve());expect(text()).toContain('Downloaded chat cache cleared.');
});

test('usage formatting is based on byte counts and never fabricates unavailable measurements',()=>{
 expect(formatCacheBytes(0)).toBe('0 B');expect(formatCacheBytes(1024)).toBe('1.0 KiB');
 expect(formatCacheBytes(1024*1024)).toBe('1.0 MiB');expect(formatCacheBytes(NaN)).toBe('Unavailable');
});
