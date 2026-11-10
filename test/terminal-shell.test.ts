import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,readdir,symlink,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareTerminalShell,terminalShellIO,terminalHighlightPlugins,terminalZshRc,type TerminalShellIO} from '../src/terminal-shell.js';
const exec=promisify(execFile);
const quote=(s:string)=>`'${s.replaceAll("'","'\\''")}'`;

function shellFixture(executables:string[],plugins:readonly string[]=[]) {
  const files:{directory:string;content:string}[]=[],checked:string[]=[];
  const io:TerminalShellIO={
    executable:async path=>executables.includes(path),
    trustedPlugin:async path=>{checked.push(path);return plugins.includes(path);},
    startup:async(directory,content)=>{files.push({directory,content});},
  };
  return {io,files,checked};
}
test('shell selection is deterministic, scoped and only uses known distro plugin paths',async()=>{
  for(const plugin of terminalHighlightPlugins){
    const f=shellFixture(['/usr/bin/zsh','/usr/bin/bash'],[plugin]);
    const shell=await prepareTerminalShell('/private/terminal',f.io);
    assert.deepEqual(shell,{argv:['/usr/bin/zsh','-d','-i'],env:{SHELL:'/usr/bin/zsh',ZDOTDIR:'/private/terminal/shell-zsh'}});
    assert.deepEqual(f.files,[{directory:'/private/terminal/shell-zsh',content:terminalZshRc(plugin)}]);
    assert.ok(f.files[0].content.includes(`source '${plugin}'`));
    assert.ok(f.files[0].content.includes("PROMPT='\n%F{green}%-2<...<%2~%<<%f\n%# '"),'blank-line spacing and viewport-relative shortening stay shell-owned');
    assert.ok(!f.files[0].content.includes('$('));assert.ok(!f.files[0].content.includes('`'));
    assert.ok(f.checked.every(path=>(terminalHighlightPlugins as readonly string[]).includes(path)));
  }
  const missingPlugin=shellFixture(['/usr/bin/zsh']);
  assert.equal((await prepareTerminalShell('/private/terminal',missingPlugin.io)).argv[0],'/usr/bin/zsh');
  assert.ok(!missingPlugin.files[0].content.includes('source '));
  for(const brokenSetup of [false,true]){
    const f=shellFixture(brokenSetup?['/usr/bin/zsh','/usr/bin/bash']:['/usr/bin/bash']);
    if(brokenSetup)f.io.startup=async()=>{throw new Error('read-only startup storage');};
    const shell=await prepareTerminalShell('/private/terminal',f.io);
    assert.deepEqual(shell.argv,['/usr/bin/bash','--noprofile','--norc','+O','promptvars','-i']);
    assert.ok(shell.env.PS1.includes('\\W'));assert.ok(shell.env.PS1.startsWith('\\n'));assert.equal(shell.env.ZDOTDIR,undefined);
  }
  assert.deepEqual(await prepareTerminalShell('/private/terminal',shellFixture([]).io),{argv:['/bin/sh','-i'],env:{SHELL:'/bin/sh',PS1:'$ '}});
});

test('private startup writes are atomic, owner-only and do not follow symlinks or custom startup files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bob-shell-files-')),startup=join(dir,'shell-zsh'),outside=join(dir,'outside');
  try{
    await writeFile(outside,'untouched',{mode:0o600});
    await terminalShellIO.startup(startup,'first');
    await terminalShellIO.startup(startup,'second');
    assert.equal(await readFile(join(startup,'.zshrc'),'utf8'),'second');
    assert.equal((await lstat(startup)).mode&0o077,0);
    assert.equal((await lstat(join(startup,'.zshrc'))).mode&0o077,0);
    assert.deepEqual(await readdir(startup),['.zshrc']);
    await rm(join(startup,'.zshrc'));await symlink(outside,join(startup,'.zshrc'));
    await assert.rejects(terminalShellIO.startup(startup,'bad'));
    assert.equal(await readFile(outside,'utf8'),'untouched');
    await rm(startup,{recursive:true});await symlink(dir,startup);
    await assert.rejects(terminalShellIO.startup(startup,'bad'));
    assert.equal(await readFile(outside,'utf8'),'untouched');
    await rm(startup);await mkdir(startup,{mode:0o700});
    await writeFile(join(startup,'.zshenv'),'untrusted');
    await assert.rejects(terminalShellIO.startup(startup,'bad'));
    await rm(join(startup,'.zshenv'));
    await symlink(outside,join(startup,'.zshrc.zwc'));
    await assert.rejects(terminalShellIO.startup(startup,'bad'));
    assert.equal(await readFile(outside,'utf8'),'untouched');
    await rm(join(startup,'.zshrc.zwc'));await chmod(startup,0o755);
    await assert.rejects(terminalShellIO.startup(startup,'bad'));
    await chmod(startup,0o700);await chmod(dir,0o755);
    await assert.rejects(terminalShellIO.startup(startup,'bad'));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('plugin trust rejects local, writable and symlinked files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bob-shell-plugin-'));
  try{
    const plugin=join(dir,'plugin.zsh');await writeFile(plugin,'# not distro-owned');
    assert.equal(await terminalShellIO.trustedPlugin(plugin),false);
    const link=join(dir,'link.zsh');await symlink(terminalHighlightPlugins[0],link);
    assert.equal(await terminalShellIO.trustedPlugin(link),false);
    assert.equal(await terminalShellIO.trustedPlugin(join(dir,'missing')),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

// A controlling PTY, not `zsh -c`: proves ZLE and real per-keystroke highlighting.
// Only fixture shells are started/signalled. No production PTY or tmux is touched.
const ptyScript=String.raw`
import os, pty, sys, json, select, time, signal, fcntl, termios, struct
spec = json.loads(sys.argv[1])
pid, fd = pty.fork()
if pid == 0:
    os.chdir(spec['cwd'])
    os.execve(spec['argv'][0], spec['argv'], spec['env'])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, spec.get('columns', 160), 0, 0))
out = bytearray()
def drain(seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], min(.05, max(0, deadline-time.monotonic())))
        if ready:
            try: out.extend(os.read(fd, 65536))
            except OSError: return
def prompt(start):
    deadline = time.monotonic() + 5
    while b'\x1b[?2004h' not in out[start:]:
        if time.monotonic() >= deadline: raise RuntimeError('Fixture shell prompt timed out')
        drain(.05)
try:
    prompt(0)
    for step in spec['steps']:
        start = len(out)
        os.write(fd, step.encode())
        if step.endswith('\n'): prompt(start)
        else: drain(.3)
    deadline = time.monotonic() + 5
    while not os.path.exists(spec['proof']):
        if time.monotonic() >= deadline: raise RuntimeError('Fixture proof timed out')
        drain(.05)
finally:
    os.kill(pid, signal.SIGTERM)
    drain(.2)
    # Interactive shells can ignore SIGTERM. This is our exact unreaped child.
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
    os.close(fd)
sys.stdout.buffer.write(out)
`;
const hasPty=process.platform!=='win32'&&await terminalShellIO.executable('/usr/bin/python3');
const hasZsh=hasPty&&await terminalShellIO.executable('/usr/bin/zsh'),hasBash=hasPty&&await terminalShellIO.executable('/usr/bin/bash');
const pluginAvailability=await Promise.all(terminalHighlightPlugins.map(path=>terminalShellIO.trustedPlugin(path)));
const plugin=terminalHighlightPlugins.find((_,index)=>pluginAvailability[index]);
async function realShell(kind:'zsh'|'bash',highlight=false,columns=160) {
  const dir=await mkdtemp(join(tmpdir(),'bob-shell-pty-')),home=join(dir,'home'),terminal=join(dir,'terminal');
  const initial=join(dir,'start'),changed=join(dir,'cwd $(touch INJECTED) `touch BACKTICK` %F{red}');
  await Promise.all([mkdir(home),mkdir(terminal,{mode:0o700}),mkdir(initial),mkdir(changed)]);
  try{
    for(const name of ['.zshenv','.zshrc','.zprofile','.zlogin','.bashrc','.bash_profile','.profile'])
      await writeFile(join(home,name),`touch ${quote(join(dir,'USER_CONFIG_LOADED'))}\n`);
    const shell=await prepareTerminalShell(terminal,{...terminalShellIO,executable:async path=>path===`/usr/bin/${kind}`});
    const proof=join(dir,'proof'),highlights=join(dir,'highlights');
    const steps=[
      kind==='zsh'?`print -r -- "GLOBAL_RCS=$options[globalrcs] PROMPT_SUBST=$options[promptsubst] HIGHLIGHT=$ZSH_HIGHLIGHT_VERSION"\n`:`shopt -q promptvars; printf 'PROMPTVARS=%s\\n' "$?"\n`,
      `cd -- ${quote(changed)}\n`,
      `printf '%s' "$PWD" > ${quote(proof)}\n`,
    ];
    if(highlight)steps.push(
      `bob_probe() { print -r -- "$region_highlight" > ${quote(highlights)}; }; zle -N bob_probe; bindkey '^G' bob_probe\n`,
      'echo hello', '\x07',
    );
    const {stdout}=await exec('/usr/bin/python3',['-I','-c',ptyScript,JSON.stringify({argv:shell.argv,cwd:initial,columns,
      env:{PATH:'/usr/bin:/bin',HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',...shell.env},steps,proof:highlight?highlights:proof})],{timeout:10000});
    assert.equal(await readFile(proof,'utf8'),changed);
    const plain=stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replaceAll('\r','');
    const lastTwo=changed.split('/').slice(-2).join('/');
    const displayed=kind==='zsh'?(lastTwo.length>columns-2?'...'+lastTwo.slice(-(columns-5)):lastTwo):changed.split('/').at(-1)!;
    assert.ok(plain.includes(displayed+'\n'),`short cwd must appear on its own prompt line: ${JSON.stringify(plain)}`);
    assert.ok(stdout.includes('\r\n\x1b[32m'), 'a blank line separates each prompt from preceding output');
    assert.ok(stdout.includes('\x1b[32m'),'prompt uses standard green ANSI');
    if(kind==='zsh')assert.ok(plain.includes('GLOBAL_RCS=off PROMPT_SUBST=off'));
    else assert.ok(plain.includes('PROMPTVARS=1'));
    for(const name of ['USER_CONFIG_LOADED','INJECTED','BACKTICK']){
      await assert.rejects(lstat(join(dir,name)));await assert.rejects(lstat(join(changed,name)));
    }
    if(highlight){
      assert.match(await readFile(highlights,'utf8'),/0 4 fg=green/,'ZLE highlights the unexecuted echo command');
      assert.match(stdout,/\x1b\[32me(?:\x1b\[32m)?c(?:\x1b\[32m)?h(?:\x1b\[32m)?o/,'live command color reaches the PTY');
      assert.match(plain,/HIGHLIGHT=\d+\.\d+/,'distro highlighting plugin was loaded');
    }
  }finally{await rm(dir,{recursive:true,force:true});}
}
test('real isolated zsh prompt follows cd safely and excludes user/global rc files',{skip:!hasZsh,timeout:15000},async()=>realShell('zsh'));
test('real isolated zsh ZLE highlights commands while typing',{skip:!hasZsh||!plugin,timeout:15000},async()=>realShell('zsh',true));
test('real isolated bash fallback prompt follows cd without config loading or path substitution',{skip:!hasBash,timeout:15000},async()=>realShell('bash'));

test('real narrow zsh prompt stays inside the viewport with a blank line and safe shortened cwd',{skip:!hasZsh,timeout:15000},async()=>realShell('zsh',false,32));
