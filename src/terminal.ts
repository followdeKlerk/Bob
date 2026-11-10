import {execFile} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {access, lstat, mkdir, readFile, readdir, readlink, realpath, stat} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {networkInterfaces, userInfo} from 'node:os';
import {HttpError} from './errors.js';
import type {State} from './state.js';
import {prepareTerminalShell,type TerminalShell} from './terminal-shell.js';

/** No subprocess output, environment, or Mosh key is ever included in an error. */
export class TerminalError extends HttpError {
  constructor(readonly code:string, status:number, message:string) { super(status,message); }
}
export interface TerminalProcess {
  pid:number; startTime:string; bootId:string; uid:number; executable:string; argv:string[];
}
export interface TerminalCommand {cwd:string; env:NodeJS.ProcessEnv; timeoutMs:number}
export interface TerminalIO {
  run(file:string,args:string[],options:TerminalCommand):Promise<{code:number;stdout:string;stderr:string}>;
  process(pid:number,strict?:boolean):Promise<TerminalProcess|undefined>;
  processes():Promise<number[]>;
  /** Must bind a process handle before verifying identity; never signal a bare PID. */
  signal(expected:TerminalProcess,signal:'SIGTERM'|'SIGKILL',timeoutMs:number):Promise<void>;
  pidfdAvailable(timeoutMs:number):Promise<void>;
  sleep(ms:number):Promise<void>;
  cwd(path:string):Promise<string>;
  prepare(socketDirectory:string,mosh:string,tmux:string):Promise<void>;
  /** Optional shell dependencies/private startup; invoked only for a new pane. */
  shell(directory:string):Promise<TerminalShell>;
}
export interface TerminalOptions {
  host:string;
  portStart?:number; portEnd?:number; maxSessions?:number; commandTimeoutMs?:number;
  receiptTtlMs?:number; reapIntervalMs?:number; maxQueued?:number;
  /** Test seams; production callers should use the defaults. */
  io?:Partial<TerminalIO>; platform?:string; localAddresses?:string[]; now?:()=>number;
  moshPath?:string; tmuxPath?:string;
}
type TerminalState=Pick<State,'id'|'dir'|'get'|'set'|'devices'>;
type Identity=Pick<TerminalProcess,'pid'|'startTime'|'bootId'>;
type Session={id:string;deviceId:string;conversationId:string;name:string;cwd:string;requests:string[];
  host?:string;port?:number;transport?:Identity};
type Book={version:1;sessions:Session[];attempts:{hash:string;sessionId:string}[]};
export type TerminalReceipt={sessionId:string;requestId:string;host:string;port:number;key:string;cwd:string};
export type TerminalCapabilities={available:boolean;reason?:string;protocol:'mosh';maxSessions:number;portStart:number;portEnd:number};
export type TerminalStatus={available:boolean;reason?:string;cwd:string;connected:boolean;transportRunning?:boolean;sessionId?:string;
  session?:{id:string;state:'detached'|'connected';cwd:string}};
const CONFIG_KEY='terminal.host.v1';
const MAX_REQUESTS=256;
const MAX_ATTEMPTS=4096; // Lifetime prototype cap. Never expire/evict attempts, even after End.
const attemptHash=(device:string,conversation:string,requestHash:string)=>digest(JSON.stringify([device,conversation,requestHash]));
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=256&&!/[\x00-\x1f]/.test(s);
const allowedHost=(host:string)=>/^127(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host)&&host.split('.').every(n=>+n<=255)
  || /^100\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/.test(host)&&+host.split('.')[1]>=64&&+host.split('.')[1]<=127&&host.split('.').every(n=>+n<=255);
const failure=(code:string,status:number,message:string)=>new TerminalError(code,status,message);

/** /proc snapshots identify candidates; only the pidfd helper below may signal them. */
async function linuxProcess(pid:number,strict=false):Promise<TerminalProcess|undefined> {
  if(!Number.isSafeInteger(pid)||pid<=1)return;
  try {
    const [raw,bootId,executable,cmd,status]=await Promise.all([
      readFile(`/proc/${pid}/stat`,'utf8'),readFile('/proc/sys/kernel/random/boot_id','utf8'),
      readlink(`/proc/${pid}/exe`),readFile(`/proc/${pid}/cmdline`),readFile(`/proc/${pid}/status`,'utf8')]);
    const fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');
    if(fields[0]==='Z'||fields[0]==='X')return;
    const uid=Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]);
    const startTime=fields[19];
    if(!/^\d+$/.test(startTime)||!Number.isSafeInteger(uid))return;
    return {pid,startTime,bootId:bootId.trim(),uid,executable,argv:cmd.toString().split('\0').filter(Boolean)};
  }catch(error){
    const code=(error as NodeJS.ErrnoException).code;
    if(strict&&code!=='ENOENT'&&code!=='ESRCH')throw failure('cleanup_failed',503,'Terminal process identity could not be inspected');
    return;
  }
}
// Fixed code only; the JSON argument contains process identity/argv, never a key.
// Open pidfd BEFORE reading /proc. PID reuse before validation mismatches identity;
// reuse after validation cannot retarget the already-open process handle.
const PIDFD_HELPER=String.raw`
import json, os, signal, sys
fd = None
try:
    if sys.argv[1] == 'probe':
        fd = os.pidfd_open(os.getpid(), 0)
        signal.pidfd_send_signal(fd, 0, None, 0)
    else:
        expected = json.loads(sys.argv[1])
        pid = expected['pid']
        fd = os.pidfd_open(pid, 0)
        with open('/proc/sys/kernel/random/boot_id') as f:
            boot = f.read().strip()
        with open('/proc/%d/stat' % pid) as f:
            fields = f.read().rsplit(')', 1)[1].split()
        with open('/proc/%d/status' % pid) as f:
            uid = next(int(line.split()[1]) for line in f if line.startswith('Uid:'))
        executable = os.readlink('/proc/%d/exe' % pid)
        with open('/proc/%d/cmdline' % pid, 'rb') as f:
            argv = [part.decode('utf-8') for part in f.read().split(b'\0') if part]
        if (fields[0] not in ('Z', 'X') and fields[19] == expected['startTime']
                and boot == expected['bootId'] and uid == expected['uid']
                and executable == expected['executable'] and argv == expected['argv']):
            number = {'SIGTERM': signal.SIGTERM, 'SIGKILL': signal.SIGKILL}[expected['signal']]
            signal.pidfd_send_signal(fd, number, None, 0)
except (ProcessLookupError, FileNotFoundError):
    pass
except Exception:
    sys.exit(70)
finally:
    if fd is not None:
        os.close(fd)
`;
function pidfdHelper(payload:string,timeoutMs:number):Promise<void> {
  return new Promise((resolve,reject)=>{
    execFile('/usr/bin/python3',['-I','-c',PIDFD_HELPER,payload],{
      cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'},
      timeout:timeoutMs,killSignal:'SIGKILL',maxBuffer:1024,encoding:'utf8',
    },error=>error?reject(failure('cleanup_failed',503,'Identity-bound terminal signalling is unavailable')):resolve());
  });
}
const defaultIO:TerminalIO={
  run:(file,args,options)=>new Promise((resolve,reject)=>{
    execFile(file,args,{cwd:options.cwd,env:options.env,timeout:options.timeoutMs,killSignal:'SIGKILL',
      maxBuffer:16384,encoding:'utf8',windowsHide:true},(error,stdout,stderr)=>{
      if(error&&(typeof error.code!=='number'||error.killed))return reject(failure('command_failed',503,'Terminal host command failed'));
      resolve({code:error?Number(error.code):0,stdout,stderr});
    });
  }),
  process:linuxProcess,
  processes:async()=>{
    const entries=await readdir('/proc');
    const pids=entries.filter(n=>/^\d+$/.test(n)).map(Number);
    if(pids.length>65536)throw failure('host_busy',503,'Terminal process scan limit reached');
    return pids;
  },
  signal:(expected,signal,timeoutMs)=>pidfdHelper(JSON.stringify({...expected,signal}),timeoutMs),
  pidfdAvailable:timeoutMs=>pidfdHelper('probe',timeoutMs),
  sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  shell:prepareTerminalShell,
  cwd:async path=>{
    if(typeof path!=='string'||!isAbsolute(path)||path.length>4096||path.includes('\0'))throw failure('invalid_cwd',400,'Terminal requires an existing absolute backend directory');
    try {const resolved=await realpath(path);if(!(await stat(resolved)).isDirectory())throw 0;return resolved;}
    catch {throw failure('invalid_cwd',400,'Terminal requires an existing absolute backend directory');}
  },
  prepare:async(directory,mosh,tmux)=>{
    await Promise.all([access(mosh,constants.X_OK),access(tmux,constants.X_OK)]);
    // A private dedicated socket avoids the user's existing tmux server/config/environment.
    await mkdir(directory,{mode:0o700,recursive:true});
    const info=await lstat(directory);
    if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0)throw 0;
    const socket=join(directory,'tmux.sock');
    try {const s=await lstat(socket);if(!s.isSocket()||s.uid!==process.getuid?.())throw 0;}
    catch(error){if((error as NodeJS.ErrnoException)?.code!=='ENOENT')throw error;}
  },
};

/**
 * One device-owned tmux session per conversation. Only metadata goes in control config.
 * Mosh CLI contract (upstream src/frontend/mosh-server.cc, also Mosh 1.4.0):
 * `new -i ADDRESS -p PORT -- COMMAND ARGS...` prints MOSH CONNECT and a detached
 * PID, then forks and chdirs HOME. Consequently tmux is created separately with
 * explicit `new-session -c ABSOLUTE_CWD`, never relying on mosh's inherited cwd.
 * Receipt keys live only in bounded RAM. Replays without that receipt require a
 * fresh request; attempts are recorded BEFORE spawning, including failed ones.
 * Attempts never expire, including after End: 256/session and 4096/backend lifetime
 * are hard prototype limits, not LRU caches. Exhaustion fails closed and requires
 * End (session limit) or explicit operator review (lifetime limit).
 * Assumes the existing single supervised backend owns this State directory.
 */
export function createTerminalManager(state:TerminalState,options:TerminalOptions) {
  const host=options.host,portStart=options.portStart??60020,portEnd=options.portEnd??60027;
  const maxSessions=options.maxSessions??8,timeout=options.commandTimeoutMs??5000,maxQueued=options.maxQueued??16;
  const ttl=options.receiptTtlMs??120000,now=options.now??Date.now;
  for(const [value,min,max] of [[portStart,1024,65535],[portEnd,portStart,65535],[maxSessions,1,16],
    [timeout,100,30000],[maxQueued,1,32],[ttl,1000,300000]] as const)
    if(!Number.isInteger(value)||value<min||value>max)throw failure('invalid_options',400,'Invalid terminal host limits');
  if(portEnd-portStart>=16||maxSessions>portEnd-portStart+1)throw failure('invalid_options',400,'Terminal UDP range must be small and cover all sessions');
  const mosh=options.moshPath??'/usr/bin/mosh-server',tmux=options.tmuxPath??'/usr/bin/tmux';
  if(!isAbsolute(mosh)||!isAbsolute(tmux))throw failure('invalid_options',400,'Terminal executables must be absolute');
  // Short, deterministic, private socket path, stable across backend updates.
  const directory=join(state.dir,'terminal'),socket=join(directory,'tmux.sock');
  const prefix=`bob_${digest(state.id).slice(0,12)}_`;
  const io:TerminalIO={...defaultIO,...options.io};
  const uid=process.getuid?.()??-1;
  const user=userInfo();
  const env:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin',HOME:user.homedir,USER:user.username,LOGNAME:user.username,
    SHELL:'/bin/sh',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TERM:'xterm-256color',
    MOSH_SERVER_NETWORK_TMOUT:'600',MOSH_SERVER_SIGNAL_TMOUT:'1'};
  let book:Book={version:1,sessions:[],attempts:[]};
  const receipts=new Map<string,{requestHash:string;expires:number;value:TerminalReceipt}>();
  let tail:Promise<unknown>=Promise.resolve(),queued=0,closing=false,initialized=false;
  let available:TerminalCapabilities|undefined;
  let timer:ReturnType<typeof setInterval>|undefined;
  const save=()=>state.set(CONFIG_KEY,book);
  const paired=(deviceId:string)=>state.devices().some(device=>device.id===deviceId&&!device.revoked);
  const auth=(deviceId:string)=>{if(!paired(deviceId))throw failure('device_revoked',403,'Terminal device is no longer paired');};
  const open=()=>{if(closing)throw failure('closed',503,'Terminal manager is closed');};
  const input=(deviceId:string,conversationId:string)=>{
    if(!validId(deviceId)||!validId(conversationId))throw failure('invalid_request',400,'Invalid terminal identity');
    open();auth(deviceId);
  };
  const guarded=async<T>(deviceId:string,work:Promise<T>)=>{const result=await work;auth(deviceId);open();return result;};
  const enqueue=<T>(work:()=>Promise<T>,allowClosed=false):Promise<T>=>{
    if(!allowClosed&&closing)return Promise.reject(failure('closed',503,'Terminal manager is closed'));
    if(!allowClosed&&queued>=maxQueued)return Promise.reject(failure('host_busy',429,'Terminal host is busy'));
    queued++;
    const result=tail.then(work).catch(error=>{throw error instanceof TerminalError?error:failure('host_failed',503,'Terminal host operation failed');});
    tail=result.then(()=>{},()=>{}).finally(()=>{queued--;});
    return result;
  };
  const command=async(file:string,args:string[])=>io.run(file,args,{cwd:directory,env:{...env},timeoutMs:timeout});
  const tmuxCommand=(args:string[])=>command(tmux,['-S',socket,'-f','/dev/null',...args]);
  const hideStatus=async(s:Session)=>{
    // Exact owned session on our private socket, never a server/global option.
    // The trailing ':' selects target parsing for set-option (bare '=name'
    // is treated as a literal session name by current tmux versions).
    const result=await tmuxCommand(['set-option','-t',`=${s.name}:`,'status','off']);
    if(result.code!==0)throw failure('launch_failed',503,'Terminal session appearance could not be configured');
  };
  const argsFor=(s:Session)=>['new','-i',s.host!,'-p',String(s.port),'-c','256','--',tmux,
    '-S',socket,'-f','/dev/null','attach-session','-d','-t',`=${s.name}`];
  const owned=(p:TerminalProcess|undefined,s:Session,identity?:Identity):p is TerminalProcess=>Boolean(p&&
    p.uid===uid&&(p.executable===mosh||p.executable===mosh+' (deleted)')&&JSON.stringify(p.argv)===JSON.stringify([mosh,...argsFor(s)])&&
    (!identity||p.pid===identity.pid&&p.startTime===identity.startTime&&p.bootId===identity.bootId));
  const stopProcess=async(s:Session,p:TerminalProcess)=>{
    // Snapshots are only a filter. The signal seam opens pidfd first, revalidates
    // the complete expected identity, then signals that handle, never a bare PID.
    let current=await io.process(p.pid,true);
    if(!owned(current,s,p))return;
    await io.signal(p,'SIGTERM',timeout);
    for(let i=0;i<12;i++){await io.sleep(25);current=await io.process(p.pid,true);if(!owned(current,s,p))return;}
    current=await io.process(p.pid,true);
    if(owned(current,s,p))await io.signal(current,'SIGKILL',timeout);
    for(let i=0;i<8;i++){await io.sleep(25);if(!owned(await io.process(p.pid,true),s,p))return;}
    throw failure('cleanup_failed',503,'Terminal transport did not stop');
  };
  const stopTransport=async(s:Session,scan=false)=>{
    receipts.delete(s.id);
    if(s.port!==undefined&&s.host!==undefined){
      if(s.transport){const p=await io.process(s.transport.pid,true);if(owned(p,s,s.transport))await stopProcess(s,p);}
      // Also recover a daemon forked just before a crash/timeout, before its PID was saved.
      // Ownership uses our exact private socket/session argv and a fresh /proc identity.
      if(scan)for(const pid of await io.processes()){
        // A known PID whose start/boot identity changed is NOT an orphan to reclaim.
        if(pid===s.transport?.pid)continue;
        const p=await io.process(pid);if(owned(p,s))await stopProcess(s,p);
      }
    }
    delete s.transport;delete s.port;delete s.host;save();
  };
  const end=async(s:Session)=>{
    await stopTransport(s,true);
    const result=await tmuxCommand(['kill-session','-t',`=${s.name}`]);
    if(result.code!==0&&(await tmuxCommand(['has-session','-t',`=${s.name}`])).code===0)
      throw failure('cleanup_failed',503,'Terminal session cleanup failed');
    book.sessions=book.sessions.filter(other=>other!==s);receipts.delete(s.id);save();
  };
  const find=(deviceId:string,conversationId:string)=>{
    const s=book.sessions.find(s=>s.conversationId===conversationId);
    if(s&&s.deviceId!==deviceId)throw failure('session_owned',409,'This conversation terminal belongs to another paired device');
    return s;
  };
  const pruneReceipts=()=>{for(const [id,r]of receipts)if(r.expires<=now())receipts.delete(id);};
  const probe=async()=>{
    if(available)return available;
    const base={protocol:'mosh' as const,maxSessions,portStart,portEnd};
    const addresses=options.localAddresses??Object.values(networkInterfaces()).flatMap(entries=>entries??[]).filter(a=>a.family==='IPv4').map(a=>a.address);
    if((options.platform??process.platform)!=='linux')return available={...base,available:false,reason:'Terminal hosting requires Linux'};
    if(!allowedHost(host)||!addresses.includes(host))return available={...base,available:false,reason:'Terminal requires the actual serve host to be a local Tailscale IPv4 or loopback address'};
    if(Buffer.byteLength(socket)>100)return available={...base,available:false,reason:'Terminal state directory path is too long for a private tmux socket'};
    try{await io.pidfdAvailable(timeout);await io.prepare(directory,mosh,tmux);}
    catch{return available={...base,available:false,reason:'Terminal requires mosh-server, tmux, Python 3 with Linux pidfd support, and a private terminal state directory'};}
    return available={...base,available:true};
  };
  const validateBook=(raw:unknown):Book=>{
    const b=raw as Book;
    if(!b||b.version!==1||!Array.isArray(b.sessions)||b.sessions.length>16)throw 0;
    const ids=new Set<string>(),conversations=new Set<string>();
    for(const s of b.sessions){
      if(!s||!uuid.test(s.id)||!validId(s.deviceId)||!validId(s.conversationId)||
        !new RegExp(`^${prefix}[0-9a-f]{32}$`).test(s.name)||!isAbsolute(s.cwd)||s.cwd.includes('\0')||
        !Array.isArray(s.requests)||s.requests.length>MAX_REQUESTS||s.requests.some(r=>!/^[0-9a-f]{64}$/.test(r))||
        ids.has(s.id)||conversations.has(s.conversationId))throw 0;
      if(s.port!==undefined&&(!Number.isInteger(s.port)||s.port<1024||s.port>65535||!s.host||!allowedHost(s.host)))throw 0;
      if(s.transport&&(!Number.isSafeInteger(s.transport.pid)||s.transport.pid<=1||!/^\d+$/.test(s.transport.startTime)||!uuid.test(s.transport.bootId)||s.port===undefined))throw 0;
      ids.add(s.id);conversations.add(s.conversationId);
    }
    // Additive metadata upgrade: derive tombstones from pre-tombstone prototype records.
    b.attempts??=b.sessions.flatMap(s=>s.requests.map(hash=>({hash:attemptHash(s.deviceId,s.conversationId,hash),sessionId:s.id})));
    if(!Array.isArray(b.attempts)||b.attempts.length>MAX_ATTEMPTS||b.attempts.some(a=>!a||!/^[0-9a-f]{64}$/.test(a.hash)||!uuid.test(a.sessionId)))throw 0;
    return b;
  };
  const reapInternal=async()=>{
    pruneReceipts();let failed=false;
    for(const s of [...book.sessions])try{
      if(!paired(s.deviceId)){await end(s);continue;}
      if(s.transport&&!owned(await io.process(s.transport.pid,true),s,s.transport))await stopTransport(s,true);
    }catch{failed=true;}
    // One broken session must not starve revocation cleanup for every other device.
    if(failed)throw failure('cleanup_failed',503,'Terminal session cleanup failed');
  };
  // Cleanup authority comes from persisted ownership metadata, NOT current bind
  // address/dependency capabilities. A disabled host still must retire old daemons.
  const ready=async()=>{
    if(initialized)return;
    try{const raw=state.get<unknown>(CONFIG_KEY);book=raw===undefined?book:validateBook(raw);}
    catch{throw failure('invalid_metadata',503,'Terminal host metadata is invalid; manual inspection is required');}
    // On restart the key is intentionally unavailable. Retain tmux, retire old transport.
    let failed=false;
    for(const s of book.sessions)try{await stopTransport(s,true);}catch{failed=true;}
    try{await reapInternal();}catch{failed=true;}
    if(failed)throw failure('cleanup_failed',503,'Terminal restart cleanup failed');
    initialized=true;
  };
  const capabilities=()=>enqueue(async()=>{open();return {...await probe()};});
  const status=(deviceId:string,conversationId:string,cwd:string):Promise<TerminalStatus>=>enqueue(async()=>{
    input(deviceId,conversationId);
    await guarded(deviceId,ready());
    const caps=await guarded(deviceId,probe());
    if(!caps.available)return {available:false,reason:caps.reason,cwd,connected:false};
    await guarded(deviceId,reapInternal());
    const s=find(deviceId,conversationId);
    if(!s)return {available:true,cwd:await guarded(deviceId,io.cwd(cwd)),connected:false};
    const exists=await guarded(deviceId,tmuxCommand(['has-session','-t',`=${s.name}`]));
    if(exists.code!==0){await guarded(deviceId,end(s));return {available:true,cwd:await guarded(deviceId,io.cwd(cwd)),connected:false};}
    const transportRunning=Boolean(s.transport&&owned(await guarded(deviceId,io.process(s.transport.pid)),s,s.transport));
    // mosh-server being alive does not prove a client is attached. Only native client
    // state can establish that; GET never claims a connected phone or returns a key.
    return {available:true,cwd:s.cwd,connected:false,transportRunning,sessionId:s.id,session:{id:s.id,state:'detached',cwd:s.cwd}};
  });
  const connect=(deviceId:string,conversationId:string,cwd:string,requestId:string):Promise<TerminalReceipt>=>enqueue(async()=>{
    input(deviceId,conversationId);
    if(typeof requestId!=='string'||!uuid.test(requestId))throw failure('invalid_request',400,'Terminal requestId must be a UUID');
    let s:Session|undefined,attempted=false;
    try{
      await guarded(deviceId,ready());
      await guarded(deviceId,reapInternal());
      const caps=await guarded(deviceId,probe());
      if(!caps.available)throw failure('unavailable',503,caps.reason!);
      s=find(deviceId,conversationId);
      const requestHash=digest(requestId.toLowerCase()),attempt=attemptHash(deviceId,conversationId,requestHash);
      const previous=book.attempts.find(a=>a.hash===attempt);
      if(previous){
        if(!s||previous.sessionId!==s.id)throw failure('fresh_request_required',409,'Terminal attempt has already ended; use a fresh requestId');
        const cached=receipts.get(s.id);
        if(cached&&cached.requestHash===requestHash&&cached.expires>now()&&s.transport&&
          owned(await guarded(deviceId,io.process(s.transport.pid)),s,s.transport)){
          await guarded(deviceId,hideStatus(s));return {...cached.value};
        }
        throw failure('fresh_request_required',409,'Terminal receipt is no longer available; explicitly reconnect with a fresh requestId');
      }
      // Configuration changes never prevent reattachment to an existing shell.
      const resolved=s?.cwd??await guarded(deviceId,io.cwd(cwd));
      if(book.attempts.length>=MAX_ATTEMPTS)throw failure('attempt_limit',429,'Terminal lifetime attempt limit reached; operator review is required');
      if(s&&s.requests.length>=MAX_REQUESTS)throw failure('request_limit',409,'Terminal reconnect limit reached; End this session before starting another');
      if(!s){
        if(book.sessions.length>=maxSessions)throw failure('session_limit',429,'Terminal session limit reached; End an existing session first');
        s={id:randomUUID(),deviceId,conversationId,name:prefix+randomUUID().replaceAll('-',''),cwd:resolved,requests:[]};
        book.sessions.push(s);
      }
      s.requests.push(requestHash);book.attempts.push({hash:attempt,sessionId:s.id});save();attempted=true; // Durable attempt, never a key.
      await guarded(deviceId,stopTransport(s,true));
      const exists=await guarded(deviceId,tmuxCommand(['has-session','-t',`=${s.name}`]));
      if(exists.code!==0){
        const shell=await guarded(deviceId,io.shell(directory));
        const shellEnv=Object.entries(shell.env).flatMap(([key,value])=>['-e',`${key}=${value}`]);
        const result=await guarded(deviceId,tmuxCommand(['new-session','-d','-s',s.name,'-c',resolved,...shellEnv,'--',...shell.argv]));
        if(result.code!==0)throw failure('launch_failed',503,'Terminal session could not be started');
      }
      await guarded(deviceId,hideStatus(s));
      const used=new Set(book.sessions.filter(other=>other!==s).map(other=>other.port));
      let port=portStart;while(port<=portEnd&&used.has(port))port++;
      if(port>portEnd)throw failure('port_limit',429,'Terminal transport limit reached');
      s.host=host;s.port=port;save(); // Recoverable ownership before the daemon forks.
      const result=await guarded(deviceId,command(mosh,argsFor(s)));
      const match=/^MOSH CONNECT (\d+) ([A-Za-z0-9+/]{22})\r?$/m.exec(result.stdout);
      const pidMatch=/\[mosh-server detached, pid = (\d+)\]/.exec(result.stderr);
      if(result.code!==0||!match||Number(match[1])!==port||!pidMatch)throw failure('launch_failed',503,'Terminal transport could not be started');
      const p=await guarded(deviceId,io.process(Number(pidMatch[1])));
      if(!owned(p,s))throw failure('launch_failed',503,'Terminal transport ownership could not be verified');
      s.transport={pid:p.pid,startTime:p.startTime,bootId:p.bootId};save();
      const receipt={sessionId:s.id,requestId,host,port,key:match[2],cwd:s.cwd};
      receipts.set(s.id,{requestHash,expires:now()+ttl,value:receipt});
      auth(deviceId);open();return {...receipt};
    }catch(error){
      // Revocation/close may race any awaited spawn. Retire its transport before rejecting.
      if(s){if(!paired(deviceId))await end(s);else if(attempted)await stopTransport(s,true);}
      throw error;
    }
  });
  const disconnect=(deviceId:string,conversationId:string,sessionId?:string):Promise<{ended:boolean}>=>enqueue(async()=>{
    input(deviceId,conversationId);await guarded(deviceId,ready());
    const s=find(deviceId,conversationId);
    if(!s)return {ended:true};
    if(sessionId!==undefined&&sessionId!==s.id)throw failure('session_mismatch',409,'Terminal session changed; refresh before ending it');
    await guarded(deviceId,end(s));return {ended:true};
  });
  const reap=()=>enqueue(async()=>{open();await ready();await reapInternal();});
  const interval=options.reapIntervalMs??5000;
  if(!Number.isInteger(interval)||interval<0||interval>60000)throw failure('invalid_options',400,'Invalid terminal cleanup interval');
  if(interval){timer=setInterval(()=>{
    // Unused hosts do no filesystem/process work. Persisted metadata still triggers
    // restart orphan/revocation recovery without waiting for a terminal HTTP request.
    try{if(initialized||state.get<unknown>(CONFIG_KEY)!==undefined)void reap().catch(()=>{});}catch{/* State may already be shutting down. */}
  },interval);timer.unref();}
  let closePromise:Promise<void>|undefined;
  const close=():Promise<void>=>{
    if(closePromise)return closePromise;
    closing=true;if(timer)clearInterval(timer);
    closePromise=enqueue(async()=>{
      // No startup probe on unused managers, but recover persisted transports on close.
      if(!initialized){if(state.get<unknown>(CONFIG_KEY)===undefined)return;await ready();}
      let failed=false;
      for(const s of [...book.sessions])try{if(!paired(s.deviceId))await end(s);else await stopTransport(s,true);}catch{failed=true;}
      receipts.clear();
      if(failed)throw failure('cleanup_failed',503,'Terminal transport cleanup failed');
    },true);
    return closePromise;
  };
  return {capabilities,status,connect,disconnect,reap,close};
}
export type TerminalManager=ReturnType<typeof createTerminalManager>;
