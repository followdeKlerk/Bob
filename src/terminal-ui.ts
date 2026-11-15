import {emitKeypressEvents} from 'node:readline';
import {createInterface} from 'node:readline/promises';
import type {Readable, Writable} from 'node:stream';

export class TerminalCancelled extends Error {
 constructor(){super('Cancelled. Completed steps are kept; no automatic retry was made.');}
}
export const terminalText=(value:string)=>value.replace(/[\x00-\x1f\x7f-\x9f]/g,' ');
export function terminalStyle(text:string,code:string){
 return process.stdout.isTTY&&!('NO_COLOR' in process.env)&&process.env.TERM!=='dumb'?`\x1b[${code}m${text}\x1b[0m`:text;
}
export function terminalBanner(){
 console.log('\n'+terminalStyle('  B O B','1;36')+'  /  Your local AI workspace\n');
}
export type MenuChoice<T extends string>={value:T;label:string;hint?:string};
export function nextSelection(current:number,key:string,count:number){
 if(key==='up')return (current+count-1)%count;
 if(key==='down')return (current+1)%count;
 if(key==='home')return 0;
 if(key==='end')return count-1;
 return current;
}
/** Only prompts in a real terminal. Restores raw mode and listeners on every exit. */
export function terminalSelect<T extends string>(question:string,choices:MenuChoice<T>[],initial=0):Promise<T>{
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Interactive menus need a terminal. Use bob --help for direct commands.');
 if(!choices.length||initial<0||initial>=choices.length)throw Error('Invalid menu choices.');
 // A numbered, line-based fallback supports simple terminals and screen readers.
 if(process.env.TERM==='dumb'||process.env.BOB_MENU_PLAIN==='1'||(process.stdout.columns??80)<45)return plainSelect(question,choices,initial);
 return keySelect(question,choices,initial,process.stdin,process.stdout);
}
export async function terminalLine(prompt:string):Promise<string>{
 const rl=createInterface({input:process.stdin,output:process.stdout});
 try{return await new Promise<string>((resolve,reject)=>{
  const cancel=()=>reject(new TerminalCancelled());
  rl.once('SIGINT',cancel);rl.once('close',cancel);
  void rl.question(prompt).then(resolve,reject);
 });}finally{rl.close();}
}
async function plainSelect<T extends string>(question:string,choices:MenuChoice<T>[],initial:number):Promise<T>{
 console.log('\n'+terminalText(question));
 choices.forEach((c,i)=>console.log(`  ${i+1}. ${terminalText(c.label)}${c.hint?' — '+terminalText(c.hint):''}`));
 while(true){const answer=(await terminalLine(`Choose [${initial+1}] (q to cancel): `)).trim();if(/^q$/i.test(answer))throw new TerminalCancelled();const n=answer===''?initial:Number(answer)-1;if(Number.isInteger(n)&&n>=0&&n<choices.length)return choices[n].value;console.log('Choose a number from the list.');}
}
type KeyInput=Readable&{isRaw?:boolean;setRawMode:(value:boolean)=>unknown};
export function keySelect<T extends string>(question:string,choices:MenuChoice<T>[],initial:number,input:KeyInput,output:Writable):Promise<T>{
 return new Promise((resolve,reject)=>{
  let selected=initial,closed=false;const wasRaw=!!input.isRaw,wasFlowing=input.readableFlowing===true;
  output.write('\n'+terminalStyle(terminalText(question),'1')+'\n');
  const fit=(value:string)=>{
   const width=Math.max(10,((output as Writable&{columns?:number}).columns??80)-2);
   const clean=terminalText(value);return clean.length>width?clean.slice(0,width-1)+'…':clean;
  };
  const rows=choices.length+1;
  const draw=()=>{
   const lines=choices.map((choice,i)=>{const line=fit(`  ${i===selected?'›':' '} ${choice.label}`);return i===selected?terminalStyle(line,'1;36'):line;});
   lines.push(fit('  '+(choices[selected].hint??'')),fit('  ↑/↓ choose · Enter select · Esc cancel'));
   output.write('\r'+lines.map(line=>'\x1b[2K'+line).join('\n')+`\x1b[${rows}A\r`);
  };
  const cleanup=()=>{closed=true;input.off('keypress',key);input.off('end',ended);input.off('error',failed);input.setRawMode(wasRaw);if(!wasFlowing)input.pause();output.write(`\x1b[${rows}B\r\n`);};
  const ended=()=>{if(!closed){cleanup();reject(new TerminalCancelled());}};
  const failed=(error:Error)=>{if(!closed){cleanup();reject(error);}};
  const key=(_text:string,k:{name?:string;ctrl?:boolean}={})=>{
   if(closed)return;
   if(k.name==='escape'||k.ctrl&&['c','d'].includes(k.name??'')){ended();return;}
   if(k.name==='return'){const value=choices[selected].value;cleanup();resolve(value);return;}
   selected=nextSelection(selected,k.name??'',choices.length);draw();
  };
  emitKeypressEvents(input);input.on('keypress',key);input.once('end',ended);input.once('error',failed);input.setRawMode(true);input.resume();draw();
 });
}
