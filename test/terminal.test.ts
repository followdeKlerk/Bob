import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,stat,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {State} from '../src/state.js';
import {createTerminalManager,TerminalError,type TerminalIO,type TerminalProcess,type TerminalOptions} from '../src/terminal.js';

const exec=promisify(execFile),KEY='AbCdEf0123456789+/AbCd',BOOT='a0000000-0000-4000-8000-000000000001';
const copy=<T>(v:T):T=>structuredClone(v);
function fixture(extra:Partial<TerminalOptions>={}){
  let clock=100000,pid=1000;
  const values=new Map<string,unknown>(),devices=[{id:'owner',name:'Owner',revoked:0},{id:'other',name:'Other',revoked:0}];
  const state={id:'terminal-test',dir:'/tmp/bob-terminal-test',get:<T>(key:string)=>copy(values.get(key)) as T|undefined,
    set:(key:string,value:unknown)=>{values.set(key,copy(value));},devices:()=>devices};
  const sessions=new Set<string>(),processes=new Map<number,TerminalProcess>(),signals:{pid:number;signal:string;startTime:string}[]=[];
  const commands:{file:string;args:string[];env:NodeJS.ProcessEnv;cwd:string}[]=[];
  let hook:((file:string,args:string[])=>Promise<void>)|undefined,failMosh=false,failAfterFork=false;
  let beforeSignal:((expected:TerminalProcess)=>Promise<void>)|undefined;
  let afterSignalCheck:((expected:TerminalProcess)=>Promise<void>)|undefined;
  let shellPreparations=0;
  const io:TerminalIO={
    shell:async()=>{shellPreparations++;return {argv:['/bin/sh','-i'],env:{SHELL:'/bin/sh',PS1:'$ '}};},
    prepare:async()=>{},cwd:async path=>{if(!path.startsWith('/'))throw new Error('secret cwd error');return path;},
    process:async pid=>copy(processes.get(pid)),processes:async()=>[...processes.keys()],
    pidfdAvailable:async()=>{},
    signal:async(expected,signal)=>{
      // Fake a pidfd: bind the object first, validate against the current /proc
      // snapshot, then deliver only to that object even if its PID is recycled.
      const bound=processes.get(expected.pid);
      if(beforeSignal)await beforeSignal(expected);
      if(!bound||JSON.stringify(processes.get(expected.pid))!==JSON.stringify(expected))return;
      if(afterSignalCheck)await afterSignalCheck(expected);
      signals.push({pid:bound.pid,signal,startTime:bound.startTime});
      if(processes.get(expected.pid)===bound)processes.delete(expected.pid);
    },sleep:async()=>{},
    run:async(file,args,options)=>{
      commands.push({file,args:[...args],env:{...options.env},cwd:options.cwd});
      if(hook)await hook(file,args);
      if(file.endsWith('/tmux')){
        const op=args[4],name=args.at(args.indexOf('-t')+1)?.replace(/^=/,'').replace(/:$/,'');
        if(op==='has-session')return {code:sessions.has(name!)?0:1,stdout:'',stderr:''};
        if(op==='new-session'){sessions.add(args[args.indexOf('-s')+1]);return {code:0,stdout:'',stderr:''};}
        if(op==='kill-session'){const existed=sessions.delete(name!);return {code:existed?0:1,stdout:'',stderr:''};}
        if(op==='set-option')return {code:sessions.has(name!)?0:1,stdout:'',stderr:''};
        throw new Error('Unexpected fixture tmux command');
      }
      if(failMosh)throw new Error(`private key ${KEY} and provider output`);
      const id=++pid;
      processes.set(id,{pid:id,startTime:String(10000+id),bootId:BOOT,uid:process.getuid!(),executable:file,argv:[file,...args]});
      if(failAfterFork)throw new Error(`private key ${KEY} timeout`);
      return {code:0,stdout:`MOSH CONNECT ${args[args.indexOf('-p')+1]} ${KEY}\n`,stderr:`[mosh-server detached, pid = ${id}]\n`};
    },
  };
  const options:TerminalOptions={host:'127.0.0.1',localAddresses:['127.0.0.1'],platform:'linux',now:()=>clock,reapIntervalMs:0,...extra,io:{...io,...extra.io}};
  const manager=createTerminalManager(state,options);
  return {state,values,devices,io,options,manager,sessions,processes,commands,signals,shellPreparations:()=>shellPreparations,
    hook:(value:typeof hook)=>{hook=value;},beforeSignal:(value:typeof beforeSignal)=>{beforeSignal=value;},
    afterSignalCheck:(value:typeof afterSignalCheck)=>{afterSignalCheck=value;},
    failMosh:()=>{failMosh=true;},failAfterFork:()=>{failAfterFork=true;},advance:(ms:number)=>{clock+=ms;}};
}
const code=(expected:string)=>(error:unknown)=>error instanceof TerminalError&&error.code===expected;
const launches=(f:ReturnType<typeof fixture>)=>f.commands.filter(c=>c.file.endsWith('mosh-server'));

test('connect uses explicit argv, private tmux and validated -c cwd; output and keys stay out of metadata/status',async()=>{
  const f=fixture(),cwd='/tmp/project with space; $(not-a-command)';
  const original=process.env.BOB_TERMINAL_PROVIDER_SECRET;process.env.BOB_TERMINAL_PROVIDER_SECRET=KEY;
  try{
    const receipt=await f.manager.connect('owner','conversation',cwd,randomUUID());
    assert.equal(receipt.key,KEY);assert.equal(receipt.cwd,cwd);assert.equal(receipt.host,'127.0.0.1');
    const start=f.commands.find(c=>c.args.includes('new-session'))!;
    assert.equal(start.args[start.args.indexOf('-c')+1],cwd);
    assert.deepEqual(start.args.slice(-3),['--','/bin/sh','-i']);
    assert.deepEqual(start.args.slice(0,4),['-S','/tmp/bob-terminal-test/terminal/tmux.sock','-f','/dev/null']);
    const launch=launches(f)[0];assert.deepEqual(launch.args.slice(0,9),['new','-i','127.0.0.1','-p','60020','-c','256','--','/usr/bin/tmux']);
    assert.ok(launch.args.includes('attach-session'));assert.equal(launch.env.LC_ALL,'C.UTF-8');
    for(const command of f.commands){assert.equal(command.env.BOB_TERMINAL_PROVIDER_SECRET,undefined);assert.equal(command.env.MOSH_KEY,undefined);assert.equal(command.env.SSH_AUTH_SOCK,undefined);}
    const status=await f.manager.status('owner','conversation',cwd);
    assert.deepEqual(status.session,{id:receipt.sessionId,state:'detached',cwd});assert.equal(status.transportRunning,true);assert.equal(status.connected,false);
    assert.ok(!JSON.stringify(status).includes(KEY));assert.ok(!JSON.stringify([...f.values]).includes(KEY));
    await f.manager.close();assert.equal(f.processes.size,0);assert.equal(f.sessions.size,1,'tmux survives backend close');
  }finally{if(original===undefined)delete process.env.BOB_TERMINAL_PROVIDER_SECRET;else process.env.BOB_TERMINAL_PROVIDER_SECRET=original;await f.manager.close();}
});

test('lost HTTP response and concurrent same-request recovery reuse exactly one transport; new ID reconnects tmux',async()=>{
  const f=fixture(),request=randomUUID();
  try{
    const [first,retry]=await Promise.all([f.manager.connect('owner','chat','/cwd',request),f.manager.connect('owner','chat','/cwd',request)]);
    assert.deepEqual(retry,first);assert.equal(launches(f).length,1);assert.equal(f.sessions.size,1);
    const oldPid=[...f.processes.keys()][0];
    const next=await f.manager.connect('owner','chat','/cwd',randomUUID());
    assert.equal(next.sessionId,first.sessionId);assert.equal(f.sessions.size,1);assert.equal(f.processes.size,1);
    assert.ok(f.signals.some(s=>s.pid===oldPid));assert.equal(launches(f).length,2);
    await assert.rejects(f.manager.connect('owner','chat','/cwd',request),code('fresh_request_required'));
    assert.equal(f.processes.size,1,'stale replay must not kill the current transport');
  }finally{await f.manager.close();}
});

test('new shells get explicit scoped startup env; all connects hide only the exact owned tmux status',async()=>{
  let prepared=0;
  const f=fixture({io:{shell:async directory=>{
    prepared++;assert.equal(directory,'/tmp/bob-terminal-test/terminal');
    return {argv:['/usr/bin/zsh','-d','-i'],env:{SHELL:'/usr/bin/zsh',ZDOTDIR:join(directory,'shell-zsh')}};
  }}}),request=randomUUID();
  try{
    const first=await f.manager.connect('owner','chat','/cwd',request);
    await f.manager.connect('owner','chat','/cwd',request); // cached HTTP recovery
    await f.manager.connect('owner','chat','/changed-config',randomUUID());
    assert.equal(prepared,1);
    const starts=f.commands.filter(c=>c.args.includes('new-session'));
    assert.equal(starts.length,1);
    assert.deepEqual(starts[0].args.slice(-8),['-e','SHELL=/usr/bin/zsh','-e','ZDOTDIR=/tmp/bob-terminal-test/terminal/shell-zsh','--','/usr/bin/zsh','-d','-i']);
    const name=[...f.sessions][0],styles=f.commands.filter(c=>c.args.includes('set-option'));
    assert.equal(styles.length,3,'new, cached retry and reconnect each apply status off');
    for(const style of styles)assert.deepEqual(style.args,['-S','/tmp/bob-terminal-test/terminal/tmux.sock','-f','/dev/null','set-option','-t',`=${name}:`,'status','off']);
    assert.ok(!f.commands.some(c=>c.args.some(arg=>['send-keys','respawn-pane','source-file','kill-server'].includes(arg))));
    assert.equal((await f.manager.status('owner','chat','/changed-config')).sessionId,first.sessionId);
    await f.manager.disconnect('owner','chat',first.sessionId);
    await f.manager.connect('owner','chat','/new-cwd',randomUUID());
    assert.equal(prepared,2,'explicit End then new session applies the new shell setup');
  }finally{await f.manager.close();}
});

test('restart retires persisted transport by identity, retains tmux and rejects key receipt replay',async()=>{
  const f=fixture(),request=randomUUID();
  const first=await f.manager.connect('owner','chat','/cwd',request);
  // Simulate a crash: no close. The fake clock timer is disabled, and a new manager reads persisted metadata.
  const restarted=createTerminalManager(f.state,f.options);
  try{
    const status=await restarted.status('owner','chat','/cwd');
    assert.equal(status.session?.id,first.sessionId);assert.equal(status.session?.state,'detached');
    assert.equal(f.processes.size,0);assert.equal(f.sessions.size,1);
    await assert.rejects(restarted.connect('owner','chat','/cwd',request),code('fresh_request_required'));
    assert.equal(launches(f).length,1);
    assert.equal((await restarted.connect('owner','chat','/cwd',randomUUID())).sessionId,first.sessionId);
    assert.equal(f.shellPreparations(),1,'restart reconnect never rewrites startup files or respawns the shell');
    assert.equal(f.commands.filter(c=>c.args.includes('new-session')).length,1);
    await restarted.disconnect('owner','chat',first.sessionId);assert.equal(f.sessions.size,0);assert.equal(f.processes.size,0);
  }finally{await restarted.close();/* Do not close the intentionally stale crashed manager. */}
});

test('revoked restart cleanup works despite unavailable bind host or missing launch binaries',async()=>{
  for(const unavailable of ['host','dependency'] as const)for(const operation of ['reap','close','status'] as const){
    const f=fixture();await f.manager.connect('owner','chat','/cwd',randomUUID());
    f.devices[0].revoked=1;
    const restarted=createTerminalManager(f.state,{...f.options,
      ...(unavailable==='host'?{host:'0.0.0.0'}:{io:{...f.io,prepare:async()=>{throw new Error('missing mosh binary');}}}),
    });
    assert.equal((await restarted.capabilities()).available,false);
    assert.equal(f.processes.size,1,'capability probing alone does not delete ownership metadata');
    try{
      if(operation==='status')assert.equal((await restarted.status('other','unrelated','/cwd')).available,false);
      else await restarted[operation]();
      assert.equal(f.processes.size,0,`${unavailable}/${operation} retired persisted Mosh`);
      assert.equal(f.sessions.size,0,`${unavailable}/${operation} ended revoked tmux`);
      const book=f.state.get<any>('terminal.host.v1');assert.equal(book.sessions.length,0);assert.equal(book.attempts.length,1);
    }finally{await restarted.close();}
  }
});

test('unavailable launch capability cannot bypass authorized restart close cleanup',async()=>{
  const f=fixture();await f.manager.connect('owner','chat','/cwd',randomUUID());
  const restarted=createTerminalManager(f.state,{...f.options,host:'0.0.0.0'});
  assert.equal((await restarted.capabilities()).available,false);
  await restarted.close();assert.equal(f.processes.size,0);assert.equal(f.sessions.size,1,'authorized tmux survives');
});

test('pidfd capability is required for new launch; failed cleanup retains ownership metadata for recovery',async()=>{
  const unsupported=fixture({io:{pidfdAvailable:async()=>{throw new Error(KEY);}}});
  assert.equal((await unsupported.manager.capabilities()).available,false);
  await assert.rejects(unsupported.manager.connect('owner','chat','/cwd',randomUUID()),code('unavailable'));
  assert.equal(unsupported.commands.length,0);await unsupported.manager.close();
  const f=fixture();await f.manager.connect('owner','chat','/cwd',randomUUID());f.devices[0].revoked=1;
  const before=f.state.get<any>('terminal.host.v1');
  const failed=createTerminalManager(f.state,{...f.options,host:'0.0.0.0',io:{...f.io,
    pidfdAvailable:async()=>{throw new Error(KEY);},signal:async()=>{throw new Error(KEY);},
  }});
  await assert.rejects(failed.reap(),code('cleanup_failed'));
  assert.deepEqual(f.state.get('terminal.host.v1'),before,'failed signalling must not discard ownership');
  assert.equal(f.processes.size,1);await assert.rejects(failed.close(),code('cleanup_failed'));
  const recovered=createTerminalManager(f.state,{...f.options,host:'0.0.0.0'});
  await recovered.reap();assert.equal(f.processes.size,0);assert.equal(f.sessions.size,0);await recovered.close();
});

test('missing tmux during unavailable restart still retires Mosh and preserves failed End metadata',async()=>{
  const f=fixture();await f.manager.connect('owner','chat','/cwd',randomUUID());f.devices[0].revoked=1;
  f.hook(async file=>{if(file.endsWith('/tmux'))throw new Error('missing tmux');});
  const failed=createTerminalManager(f.state,{...f.options,host:'0.0.0.0'});
  await assert.rejects(failed.reap(),code('cleanup_failed'));
  assert.equal(f.processes.size,0);assert.equal(f.state.get<any>('terminal.host.v1').sessions.length,1);
  await assert.rejects(failed.close(),code('cleanup_failed'));f.hook(undefined);
  const recovered=createTerminalManager(f.state,{...f.options,host:'0.0.0.0'});
  await recovered.reap();assert.equal(f.sessions.size,0);await recovered.close();
});

test('identity-bound signal seam cannot target a PID reused before or after validation',async()=>{
  for(const stage of ['before','after'] as const){
    const f=fixture();await f.manager.connect('owner','chat','/cwd',randomUUID());
    const original=copy([...f.processes.values()][0]),replacement={...copy(original),startTime:'999999999'};
    const replace=async(expected:TerminalProcess)=>{
      assert.deepEqual(expected,original,'signal receives complete expected identity, not just a numeric PID');
      f.processes.set(original.pid,replacement);
    };
    if(stage==='before')f.beforeSignal(replace);else f.afterSignalCheck(replace);
    await f.manager.close();
    assert.equal(f.processes.get(original.pid),replacement,'replacement process must remain untouched');
    if(stage==='before')assert.equal(f.signals.length,0);
    else {assert.equal(f.signals.length,1);assert.equal(f.signals[0].startTime,original.startTime);}
  }
});

test('session ownership and stale End protect a live transport; configured cwd changes retain the existing shell',async()=>{
  const f=fixture();
  try{
    const first=await f.manager.connect('owner','chat','/cwd',randomUUID());
    await assert.rejects(f.manager.status('other','chat','/cwd'),code('session_owned'));
    await assert.rejects(f.manager.connect('other','chat','/cwd',randomUUID()),code('session_owned'));
    await assert.rejects(f.manager.disconnect('other','chat',first.sessionId),code('session_owned'));
    await assert.rejects(f.manager.disconnect('owner','chat',randomUUID()),code('session_mismatch'));
    const resumed=await f.manager.connect('owner','chat','relative-or-invalid-config',randomUUID());
    assert.equal(resumed.cwd,'/cwd');assert.equal(resumed.sessionId,first.sessionId);
    assert.equal((await f.manager.status('owner','chat','relative-or-invalid-config')).cwd,'/cwd');
    await assert.rejects(f.manager.connect('owner','chat','/cwd','shell command'),code('invalid_request'));
    assert.equal(f.processes.size,1);assert.equal(f.sessions.size,1);
    assert.deepEqual(await f.manager.disconnect('owner','chat',first.sessionId),{ended:true});
    assert.deepEqual(await f.manager.disconnect('owner','chat',first.sessionId),{ended:true});
  }finally{await f.manager.close();}
});

test('End preserves persistent attempt tombstones; old End/replay cannot create or kill a replacement shell',async()=>{
  const f=fixture(),request=randomUUID();
  let manager=f.manager;
  try{
    const first=await manager.connect('owner','chat','/cwd',request);
    await manager.disconnect('owner','chat',first.sessionId);
    assert.deepEqual(await manager.disconnect('owner','chat',first.sessionId),{ended:true});
    await manager.close();manager=createTerminalManager(f.state,f.options);
    await assert.rejects(manager.connect('owner','chat','/cwd',request),code('fresh_request_required'));
    assert.equal(f.sessions.size,0);assert.equal(launches(f).length,1);
    const replacement=await manager.connect('owner','chat','/new-cwd',randomUUID());
    assert.notEqual(replacement.sessionId,first.sessionId);assert.equal(replacement.cwd,'/new-cwd');
    await assert.rejects(manager.disconnect('owner','chat',first.sessionId),code('session_mismatch'));
    await assert.rejects(manager.connect('owner','chat','/cwd',request),code('fresh_request_required'));
    assert.equal(f.processes.size,1);assert.equal(f.sessions.size,1);
  }finally{await manager.close();}
});

test('persistent attempt cap fails closed without eviction or starting a shell',async()=>{
  const f=fixture();
  f.state.set('terminal.host.v1',{version:1,sessions:[],attempts:Array.from({length:4096},(_,i)=>({
    hash:createHash('sha256').update(String(i)).digest('hex'),sessionId:randomUUID(),
  }))});
  try{
    await assert.rejects(f.manager.connect('owner','chat','/cwd',randomUUID()),code('attempt_limit'));
    assert.equal(f.sessions.size,0);assert.equal(f.commands.length,0);
    assert.equal(f.state.get<any>('terminal.host.v1').attempts.length,4096);
  }finally{await f.manager.close();}
});

test('per-session attempts are bounded; End frees session capacity without deleting tombstones',async()=>{
  const f=fixture();
  try{
    let id='';
    for(let i=0;i<256;i++)id=(await f.manager.connect('owner','chat','/cwd',randomUUID())).sessionId;
    await assert.rejects(f.manager.connect('owner','chat','/cwd',randomUUID()),code('request_limit'));
    assert.equal(f.processes.size,1);
    await f.manager.disconnect('owner','chat',id);
    await f.manager.connect('owner','chat','/cwd',randomUUID());
    assert.equal(f.state.get<any>('terminal.host.v1').attempts.length,257);
  }finally{await f.manager.close();}
});

test('idle cleanup never initializes an unused manager, but does recover persisted transports after a crash',async()=>{
  let prepared=0;
  const idle=fixture({reapIntervalMs:10,io:{prepare:async()=>{prepared++;}}});
  await new Promise(resolve=>setTimeout(resolve,35));await idle.manager.close();
  assert.equal(prepared,0);assert.equal(idle.commands.length,0);
  const f=fixture();await f.manager.connect('owner','chat','/cwd',randomUUID());
  const restarted=createTerminalManager(f.state,{...f.options,reapIntervalMs:10});
  try{await new Promise(resolve=>setTimeout(resolve,35));assert.equal(f.processes.size,0);assert.equal(f.sessions.size,1);}
  finally{await restarted.close();}
});

test('expired receipts require a fresh explicit request; no receipt is reconstructed from metadata',async()=>{
  const f=fixture(),request=randomUUID();
  try{
    await f.manager.connect('owner','chat','/cwd',request);f.advance(120001);
    await assert.rejects(f.manager.connect('owner','chat','/cwd',request),code('fresh_request_required'));
    assert.equal(launches(f).length,1);assert.equal(f.processes.size,1);
    await f.manager.connect('owner','chat','/cwd',randomUUID());assert.equal(launches(f).length,2);
  }finally{await f.manager.close();}
});

test('revocation is revalidated after an awaited daemon spawn and immediately cleans transport and tmux',async()=>{
  const f=fixture();
  f.hook(async file=>{if(file.endsWith('mosh-server'))f.devices[0].revoked=1;});
  try{
    await assert.rejects(f.manager.connect('owner','chat','/cwd',randomUUID()),code('device_revoked'));
    assert.equal(f.processes.size,0);assert.equal(f.sessions.size,0);
    await assert.rejects(f.manager.status('owner','chat','/cwd'),code('device_revoked'));
  }finally{await f.manager.close();}
});

test('reap removes revoked devices; close terminates active transport but preserves authorized tmux',async()=>{
  const f=fixture();
  await f.manager.connect('owner','chat','/cwd',randomUUID());
  await f.manager.connect('other','another','/cwd',randomUUID());
  f.devices[0].revoked=1;await f.manager.reap();
  assert.equal(f.sessions.size,1);assert.equal(f.processes.size,1);
  await f.manager.close();assert.equal(f.processes.size,0);assert.equal(f.sessions.size,1);
  await assert.rejects(f.manager.connect('other','another','/cwd',randomUUID()),code('closed'));
});

test('a failed session cleanup does not starve revocation cleanup for another device',async()=>{
  const f=fixture();
  try{
    await f.manager.connect('owner','one','/cwd',randomUUID());
    await f.manager.connect('other','two','/cwd',randomUUID());
    const firstName=[...f.sessions][0];
    f.devices[0].revoked=1;f.devices[1].revoked=1;
    f.hook(async(_file,args)=>{if(args.includes('kill-session')&&args.includes(`=${firstName}`))throw new Error(KEY);});
    await assert.rejects(f.manager.reap(),code('cleanup_failed'));
    assert.equal(f.processes.size,0,'all revoked transports were stopped despite one tmux failure');
    assert.equal(f.sessions.size,1);
    f.hook(undefined);await f.manager.reap();assert.equal(f.sessions.size,0);
  }finally{await f.manager.close();}
});

test('PID reuse or changed boot/start identity never signals an unrelated process',async()=>{
  for(const field of ['startTime','bootId','argv','executable','uid'] as const){
    const f=fixture();await f.manager.connect('owner','chat','/cwd',randomUUID());
    const p=[...f.processes.values()][0];
    if(field==='startTime')p.startTime='999999999';
    else if(field==='bootId')p.bootId=randomUUID();
    else if(field==='argv')p.argv=['/usr/bin/unrelated'];
    else if(field==='executable')p.executable='/usr/bin/unrelated';
    else p.uid=-100;
    // For a reused identity with identical argv, a scan must not override the persisted start identity.
    await f.manager.close();
    assert.equal(f.signals.length,0,`${field} must not be killed`);
  }
});

test('orphaned daemon after uncertain timeout is discovered by exact private argv, cleaned and never replayed',async()=>{
  const f=fixture(),request=randomUUID();f.failAfterFork();
  try{
    await assert.rejects(f.manager.connect('owner','chat','/cwd',request),error=>{
      assert.ok(error instanceof TerminalError);assert.ok(!String(error).includes(KEY));assert.ok(!String(error).includes('private'));return true;
    });
    assert.equal(f.processes.size,0);assert.equal(f.signals.length,1);
    await assert.rejects(f.manager.connect('owner','chat','/cwd',request),code('fresh_request_required'));
    assert.equal(launches(f).length,1);
  }finally{await f.manager.close();}
});

test('subprocess failures are redacted; sessions, UDP ports and pending work are bounded',async()=>{
  const failed=fixture();failed.failMosh();
  try{await assert.rejects(failed.manager.connect('owner','chat','/cwd',randomUUID()),error=>error instanceof TerminalError&&!String(error).includes(KEY));}
  finally{await failed.manager.close();}
  const f=fixture({portStart:61000,portEnd:61001,maxSessions:2,maxQueued:2});
  try{
    const a=await f.manager.connect('owner','one','/cwd',randomUUID()),b=await f.manager.connect('owner','two','/cwd',randomUUID());
    assert.deepEqual([a.port,b.port],[61000,61001]);
    await assert.rejects(f.manager.connect('owner','three','/cwd',randomUUID()),code('session_limit'));
    assert.equal(f.sessions.size,2);
    let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
    f.hook(async()=>blocked);
    const one=f.manager.status('owner','one','/cwd'),two=f.manager.status('owner','two','/cwd');
    await assert.rejects(f.manager.status('owner','three','/cwd'),code('host_busy'));
    release();await Promise.all([one,two]);
  }finally{await f.manager.close();}
});

test('unavailable host/platform/dependencies report safe capabilities and spawn nothing',async()=>{
  for(const options of [{platform:'darwin'},{host:'0.0.0.0'},{host:'192.168.1.2'},{host:'100.64.1.2'}]){
    const f=fixture(options);
    try{
      assert.equal((await f.manager.capabilities()).available,false);
      assert.equal((await f.manager.status('owner','chat','/cwd')).available,false);
      await assert.rejects(f.manager.connect('owner','chat','/cwd',randomUUID()),code('unavailable'));
      assert.equal(f.commands.length,0);
    }finally{await f.manager.close();}
  }
  const f=fixture({io:{prepare:async()=>{throw new Error(KEY);}}});
  assert.ok(!JSON.stringify(await f.manager.capabilities()).includes(KEY));await f.manager.close();
});

test('close racing a running launch cleans the uncertain daemon and does not return its key',async()=>{
  const f=fixture();let arrived!:()=>void,release!:()=>void;
  const waiting=new Promise<void>(resolve=>{arrived=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  f.hook(async file=>{if(file.endsWith('mosh-server')){arrived();await gate;}});
  const connect=f.manager.connect('owner','chat','/cwd',randomUUID());
  await waiting;const closed=f.manager.close();release();
  await assert.rejects(connect,code('closed'));await closed;
  assert.equal(f.processes.size,0);assert.equal(f.sessions.size,1);
});

test('metadata validation fails closed rather than deleting or signalling unknown state',async()=>{
  const f=fixture();f.state.set('terminal.host.v1',{version:1,sessions:[{id:'corrupted',key:KEY}]});
  await assert.rejects(f.manager.status('owner','chat','/cwd'),code('invalid_metadata'));
  assert.equal(f.commands.length,0);assert.equal(f.signals.length,0);
  await assert.rejects(f.manager.close(),code('invalid_metadata'));
});

test('real loopback Mosh bootstrap, retry, reconnect, restart recovery and exact tmux End',{
  skip:process.env.BOB_TEST_MOSH_LIVE!=='1',timeout:30000,
},async()=>{
  await Promise.all([access('/usr/bin/mosh-server'),access('/usr/bin/tmux')]);
  const dir=await mkdtemp(join(tmpdir(),'bob-term-')),cwd=join(dir,'workspace with spaces');
  const {mkdir}=await import('node:fs/promises');await mkdir(cwd);
  const moved=join(cwd,'changed directory');await mkdir(moved);
  const state=new State(dir),paired=state.pair(state.invite().token,'Isolated terminal test');
  const device=paired.deviceId,chat=randomUUID(),options={host:'127.0.0.1',portStart:62020,portEnd:62021,maxSessions:2,reapIntervalMs:0};
  let manager=createTerminalManager(state,options);
  const socket=join(dir,'terminal','tmux.sock');
  const tmux=(...args:string[])=>exec('/usr/bin/tmux',['-S',socket,'-f','/dev/null',...args],{env:{PATH:'/usr/bin:/bin',HOME:dir,LC_ALL:'C.UTF-8'},timeout:3000});
  try{
    assert.equal((await manager.capabilities()).available,true);
    const request=randomUUID(),first=await manager.connect(device,chat,cwd,request);
    assert.ok(/^[A-Za-z0-9+/]{22}$/.test(first.key),'Bootstrap returned a valid key shape'); // Never print the key.
    const stored=state.get<any>('terminal.host.v1'),s=stored.sessions[0];
    assert.ok(!JSON.stringify(stored).includes(first.key));
    const [cwdResult,envResult]=await Promise.all([
      tmux('display-message','-p','-t',`=${s.name}:`,'#{pane_current_path}'),
      tmux('show-environment','-g'),
    ]);
    assert.equal(cwdResult.stdout.trim(),cwd);
    const panePid=(await tmux('display-message','-p','-t',`=${s.name}:`,'#{pane_pid}')).stdout.trim();
    assert.equal((await tmux('show-options','-v','-t',`=${s.name}:`,'status')).stdout.trim(),'off');
    await tmux('new-session','-d','-s','unrelated-fixture','--','/bin/sh','-i');
    await tmux('set-option','-t','=unrelated-fixture:','status','on');
    assert.ok(!envResult.stdout.includes('OPENAI_API_KEY='));assert.ok(!envResult.stdout.includes('MOSH_KEY='));
    assert.equal((await stat(join(dir,'terminal'))).mode&0o077,0);
    const retry=await manager.connect(device,chat,cwd,request);
    assert.ok(JSON.stringify(retry)===JSON.stringify(first),'Same-request receipt is unchanged');
    // Exercise the actual encrypted UDP/PTY/tmux path, not just bootstrap parsing.
    // A tiny Python stdlib PTY fixture drains/discards all terminal output and never
    // prints the environment/key; mosh-client receives MOSH_KEY only in its env.
    const proof=join(cwd,'.mosh-path-proof');
    const clientScript=String.raw`
import os, pty, subprocess, sys, time, select, fcntl, termios, struct
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
p = subprocess.Popen(['/usr/bin/mosh-client', sys.argv[1], sys.argv[2]], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
try:
    deadline = time.monotonic() + 6
    next_send = time.monotonic() + .5
    while time.monotonic() < deadline and not os.path.exists(sys.argv[3]):
        ready, _, _ = select.select([master], [], [], .05)
        if ready:
            try: os.read(master, 65536)
            except OSError: break
        if time.monotonic() >= next_send:
            os.write(master, b"cd -- 'changed directory'; printf '%s' \"$PWD\" > ../.mosh-path-proof\n")
            next_send = time.monotonic() + .5
    if not os.path.exists(sys.argv[3]): sys.exit(2)
finally:
    p.terminate()
    try: p.wait(timeout=2)
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait()
    os.close(master)
`;
    await exec('/usr/bin/python3',['-c',clientScript,first.host,String(first.port),proof],{
      env:{PATH:'/usr/bin:/bin',HOME:dir,TERM:'xterm-256color',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',MOSH_KEY:first.key},timeout:10000,
    }).catch(()=>{throw new Error('Isolated Mosh client did not establish the encrypted terminal data path');});
    assert.equal(await readFile(proof,'utf8'),moved);
    await tmux('set-option','-t',`=${s.name}:`,'status','on'); // Simulate an old pre-polish session.
    const oldPid=s.transport.pid;
    const next=await manager.connect(device,chat,cwd,randomUUID());
    assert.equal(next.sessionId,first.sessionId);assert.ok(next.key!==first.key,'Reconnect rotated the transport key');
    await assert.rejects(access(`/proc/${oldPid}/exe`));
    assert.equal((await tmux('list-sessions','-F','#{session_name}')).stdout.trim().split('\n').length,2);
    assert.equal((await tmux('display-message','-p','-t',`=${s.name}:`,'#{pane_pid}')).stdout.trim(),panePid);
    assert.equal((await tmux('display-message','-p','-t',`=${s.name}:`,'#{pane_current_path}')).stdout.trim(),moved);
    assert.equal((await tmux('show-options','-v','-t',`=${s.name}:`,'status')).stdout.trim(),'off');
    assert.equal((await tmux('show-options','-v','-t','=unrelated-fixture:','status')).stdout.trim(),'on');
    assert.equal((await manager.status(device,chat,cwd)).transportRunning,true);
    assert.equal((await manager.status(device,chat,cwd)).session?.state,'detached');
    await manager.close();
    assert.equal((await tmux('has-session','-t',`=${s.name}`)).stderr,'');
    manager=createTerminalManager(state,options);
    assert.equal((await manager.status(device,chat,cwd)).session?.state,'detached');
    await assert.rejects(manager.connect(device,chat,cwd,request),code('fresh_request_required'));
    assert.equal((await manager.connect(device,chat,cwd,randomUUID())).sessionId,first.sessionId);
    assert.equal((await tmux('display-message','-p','-t',`=${s.name}:`,'#{pane_pid}')).stdout.trim(),panePid);
    assert.equal((await tmux('display-message','-p','-t',`=${s.name}:`,'#{pane_current_path}')).stdout.trim(),moved);
    assert.deepEqual(await manager.disconnect(device,chat,first.sessionId),{ended:true});
    assert.equal((await manager.status(device,chat,cwd)).session,undefined);
    await assert.rejects(tmux('has-session','-t',`=${s.name}`));
    // An unavailable launch host must not block actual pidfd cleanup on a revoked restart.
    await manager.connect(device,chat,cwd,randomUUID());
    const revokedSession=state.get<any>('terminal.host.v1').sessions[0];
    state.revoke(device);
    manager=createTerminalManager(state,{...options,host:'0.0.0.0'}); // Simulated backend crash/restart, no old close.
    assert.equal((await manager.capabilities()).available,false);
    await manager.reap();
    await assert.rejects(access(`/proc/${revokedSession.transport.pid}/exe`));
    await assert.rejects(tmux('has-session','-t',`=${revokedSession.name}`));
    assert.equal(state.get<any>('terminal.host.v1').sessions.length,0);
    // The actual control DB (including WAL) must never contain transport keys.
    for(const name of ['control.sqlite','control.sqlite-wal']){
      const bytes=await readFile(join(dir,name)).catch(()=>Buffer.alloc(0));
      assert.equal(bytes.includes(Buffer.from(first.key)),false);assert.equal(bytes.includes(Buffer.from(next.key)),false);
    }
  }finally{
    await manager.close();
    // Exact fixture socket, never the user's tmux server.
    await tmux('kill-server').catch(()=>{});state.close();await rm(dir,{recursive:true,force:true});
  }
});
