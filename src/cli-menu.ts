import {terminalBanner,terminalSelect,terminalStyle,terminalText,TerminalCancelled,type MenuChoice} from './terminal-ui.js';

export type MenuPort={
 select:(question:string,choices:MenuChoice<string>[])=>Promise<string>;
 say:(text:string)=>void;
 setup:()=>Promise<unknown>;
 run:(args:string[])=>Promise<void>;
};
/** Navigation has no effects: only a selected, explicit action reaches the command port. */
export async function interactiveMenu(state:string,port:MenuPort){
 let page='home';
 while(true){
  const choices:MenuChoice<string>[]=page==='home'?[
   {value:'setup',label:'Guided setup',hint:'Inspect existing components, configure safely, then pair your phone'},
   {value:'phone',label:'Phone & pairing',hint:'Connect the Android app or inspect paired devices'},
   {value:'health',label:'Health & service',hint:'Local checks and explicit background-service controls'},
   {value:'advanced',label:'Advanced tools',hint:'Discover models, integrations, backups and direct commands'},
   {value:'exit',label:'Exit'},
  ]:page==='phone'?[
   {value:'pair',label:'Pair a phone',hint:'Creates a private, short-lived QR invitation using the saved endpoint'},
   {value:'devices',label:'List paired devices',hint:'Read-only device list; does not revoke access'},
   {value:'setup',label:'Connection setup',hint:'Use guided setup if no HTTPS endpoint has been saved'},
   {value:'back',label:'Back'},
  ]:page==='health'?[
   {value:'doctor',label:'Check local configuration',hint:'Read-only; no network calls, repairs or model charges'},
   {value:'status',label:'Show service status',hint:'Inspect the selected backend’s systemd user service'},
   {value:'start',label:'Start service',hint:'Explicitly start this backend’s existing user service'},
   {value:'stop',label:'Stop service',hint:'Disconnects active clients; asks before stopping'},
   {value:'back',label:'Back'},
  ]:[
   {value:'help',label:'All commands',hint:'Full CLI help; scripts and existing commands remain supported'},
   {value:'auth-help',label:'Models & authentication',hint:'How to use subscription login or an API key'},
   {value:'mcp-help',label:'MCP integrations',hint:'Connection configuration and tool allowlists'},
   {value:'backup-help',label:'Backups',hint:'Sensitive exports; choose a private destination explicitly'},
   {value:'back',label:'Back'},
  ];
  let choosing=true;
  try{
   const action=await port.select(page==='home'?'What would you like to do?':page==='phone'?'Phone & pairing':page==='health'?'Health & service':'Advanced tools',choices);
   choosing=false;
   if(action==='exit')return;
   if(action==='back'){page='home';continue;}
   if(['phone','health','advanced'].includes(action)){page=action;continue;}
   if(action==='setup'){await port.setup();continue;}
   if(action==='stop'){
    const answer=await port.select('Stop this backend? Active clients will disconnect.',[{value:'cancel',label:'Keep running'},{value:'confirm',label:'Stop service'}]);
    if(answer!=='confirm')continue;
   }
   const commands:Record<string,string[]>={pair:['connect'],devices:['list'],doctor:['doctor'],status:['status'],start:['start'],stop:['stop'],help:['--help'],'auth-help':['login','--help'],'mcp-help':['mcp','--help'],'backup-help':['backup','--help']};
   if(action==='auth-help')port.say('Guided setup helps with OpenAI API keys, Bob-owned ChatGPT browser login, or Anthropic API keys. Direct API-key command: bob provider --help. Never pass secrets in command arguments.');
   if(commands[action])await port.run(commands[action]);
  }catch(error){
   if(error instanceof TerminalCancelled){
    if(choosing){if(page==='home')return;page='home';}
    else port.say(error.message);
    continue;
   }
   port.say('Action did not complete: '+terminalText(error instanceof Error?error.message:String(error))+'\nNo automatic retry was made. Review the output before choosing another action.');
  }
 }
}
export async function menuOnTerminal(state:string){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Interactive menus need a local terminal. Run bob --help for direct commands.');
 terminalBanner();
 console.log(terminalStyle('State: ','2')+terminalText(state));
 console.log('Choose an action; opening the menu does not change your backend.');
 const {spawnSync}=await import('node:child_process');
 await interactiveMenu(state,{
  select:terminalSelect,say:console.log,
  setup:async()=>{const {setupOnTerminal}=await import('./setup-host.js');await setupOnTerminal(state);},
  run:async args=>{
   if(args[0]==='doctor'){
    const {diagnose}=await import('./doctor.js');
    const report=diagnose(state);
    console.log('\n'+terminalStyle('Local configuration checks','1'));
    for(const check of report.checks){
     const marker=check.status==='ok'?'✓':check.status==='warning'?'!':'✗';
     console.log(terminalStyle(`${marker} ${check.id}`,check.status==='ok'?'32':check.status==='warning'?'33':'31')+' — '+terminalText(check.message));
    }
    console.log('\n'+report.limits);
    return;
   }
   const result=spawnSync(process.execPath,[process.argv[1],'--state',state,...args],{stdio:'inherit',env:{...process.env,SYSTEMD_PAGER:'cat'},timeout:120000});
   if(result.error||result.status!==0)throw Error('Command exited without success. See its output above; it was not retried.');
  },
 });
}
