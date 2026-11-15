import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {interactiveMenu,type MenuPort} from '../src/cli-menu.js';
import {keySelect,nextSelection,terminalText,TerminalCancelled} from '../src/terminal-ui.js';

function fixture(answers:string[]){
 const commands:string[][]=[],messages:string[]=[];let setups=0;
 const port:MenuPort={select:async()=>{assert.ok(answers.length,'unexpected prompt');return answers.shift()!;},say:text=>messages.push(text),setup:async()=>{setups++;},run:async args=>{commands.push(args);}};
 return {port,commands,messages,get setups(){return setups;}};
}
test('opening menus and going Back performs no effects',async()=>{
 const f=fixture(['phone','back','health','back','advanced','back','exit']);
 await interactiveMenu('/state',f.port);assert.deepEqual(f.commands,[]);assert.equal(f.setups,0);
});
test('setup, pairing and read-only actions route to explicit existing commands',async()=>{
 const f=fixture(['setup','phone','devices','pair','back','health','doctor','status','back','advanced','mcp-help','back','exit']);
 await interactiveMenu('/state',f.port);assert.equal(f.setups,1);
 assert.deepEqual(f.commands,[['list'],['connect'],['doctor'],['status'],['mcp','--help']]);
});
test('stop requires explicit approval and defaults to keeping service running',async()=>{
 const f=fixture(['health','stop','cancel','stop','confirm','back','exit']);
 await interactiveMenu('/state',f.port);assert.deepEqual(f.commands,[['stop']]);
});
test('failed actions return to menu without automatically repeating a mutation',async()=>{
 const f=fixture(['phone','pair','back','exit']);let calls=0;
 f.port.run=async()=>{calls++;throw Error('unknown outcome');};
 await interactiveMenu('/state',f.port);assert.equal(calls,1);assert.match(f.messages.join('\n'),/No automatic retry/);
});
test('cancellation returns to parent, then exits without effects',async()=>{
 const f=fixture([]);let count=0;f.port.select=async()=>{if(count++===0)return 'phone';throw new TerminalCancelled();};
 await interactiveMenu('/state',f.port);assert.equal(count,3);assert.deepEqual(f.commands,[]);
});
test('cancelling setup returns to home instead of terminating the dashboard',async()=>{
 const f=fixture(['setup','exit']);f.port.setup=async()=>{throw new TerminalCancelled();};
 await interactiveMenu('/state',f.port);assert.match(f.messages.join('\n'),/Completed steps are kept/);assert.deepEqual(f.commands,[]);
});
test('selection wraps and supports home/end',()=>{
 assert.equal(nextSelection(0,'up',3),2);assert.equal(nextSelection(2,'down',3),0);
 assert.equal(nextSelection(1,'home',3),0);assert.equal(nextSelection(0,'end',3),2);
 assert.equal(nextSelection(1,'other',3),1);
 assert.equal(terminalText('untrusted\x1b[31m\ntext'),'untrusted [31m text');
});
for(const cancel of [false,true])test(`keyboard menu ${cancel?'cancels':'selects'} and restores terminal state`,async()=>{
 const input=Object.assign(new PassThrough(),{isRaw:false,setRawMode(value:boolean){this.isRaw=value;}});
 const output=new PassThrough();let text='';output.on('data',chunk=>{text+=chunk.toString();});
 const pending=keySelect('Choose',[{value:'a',label:'First'},{value:'b',label:'Second'}],0,input,output);
 assert.equal(input.isRaw,true);input.emit('keypress','',{name:'down'});
 input.emit('keypress','',{name:cancel?'escape':'return'});
 if(cancel)await assert.rejects(pending,TerminalCancelled);else assert.equal(await pending,'b');
 assert.equal(input.isRaw,false);assert.equal(input.isPaused(),true,'an initially idle stream must not keep the process alive after exit');assert.equal(input.listenerCount('keypress'),0);assert.equal(input.listenerCount('end'),0);
 assert.match(text,/First/);assert.match(text,/Second/);input.destroy();output.destroy();
});
test('keyboard EOF cancels and restores raw mode',async()=>{
 const input=Object.assign(new PassThrough(),{isRaw:true,setRawMode(value:boolean){this.isRaw=value;}});
 const output=new PassThrough();output.resume();
 const pending=keySelect('Choose',[{value:'a',label:'First'}],0,input,output);
 input.emit('end');await assert.rejects(pending,TerminalCancelled);assert.equal(input.isRaw,true);assert.equal(input.listenerCount('keypress'),0);input.destroy();output.destroy();
});
