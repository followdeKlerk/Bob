import {constants} from 'node:fs';
import {access, lstat, mkdir, open, rename, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname, join} from 'node:path';

export interface TerminalShell {argv:string[];env:Record<string,string>}
/** Separate dependency/file seams keep shell selection independent of the test host. */
export interface TerminalShellIO {
  executable(path:string):Promise<boolean>;
  trustedPlugin(path:string):Promise<boolean>;
  startup(directory:string,content:string):Promise<void>;
}
export const terminalHighlightPlugins=[
  '/usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh', // Arch
  '/usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh', // Debian/Ubuntu
] as const;

async function checkPrivateDirectory(directory:string) {
  const info=await lstat(directory);
  if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0)
    throw new Error('Unsafe terminal startup directory');
}
async function trustedPlugin(path:string):Promise<boolean> {
  try {
    // Never source a user-writable plugin, or follow a symlink to user config.
    let current=path,first=true;
    for(;;){
      const info=await lstat(current);
      if(info.isSymbolicLink()||info.uid!==0||(info.mode&0o022)!==0||
        (first?!info.isFile():!info.isDirectory()))return false;
      if(current==='/')return true;
      first=false;current=dirname(current);
    }
  }catch{return false;}
}
export const terminalShellIO:TerminalShellIO={
  executable:async path=>{try{await access(path,constants.X_OK);return true;}catch{return false;}},
  trustedPlugin,
  startup:async(directory,content)=>{
    // The terminal parent is private and already checked by the host probe. Check
    // again here, before creating anything; never accept a symlink as either dir.
    await checkPrivateDirectory(dirname(directory));
    try{await mkdir(directory,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    await checkPrivateDirectory(directory);
    // Only our rc is allowed in this dedicated ZDOTDIR. In particular, do not
    // accidentally execute an old/custom .zshenv before our .zshrc.
    const forbidden=['.zshenv','.zprofile','.zlogin','.zlogout'];
    // zsh can prefer a newer compiled rc over the plain file we just wrote.
    for(const name of [...forbidden,...[...forbidden,'.zshrc'].map(name=>name+'.zwc')]){
      try{await lstat(join(directory,name));throw new Error('Unexpected terminal startup file');}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    }
    const target=join(directory,'.zshrc');
    try{
      const info=await lstat(target);
      if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0)
        throw new Error('Unsafe terminal startup file');
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const temporary=join(directory,`.zshrc-${randomUUID()}.tmp`);
    const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{
      await file.writeFile(content,'utf8');await file.sync();await file.close();
      // Rename replaces the directory entry, never follows the destination.
      await rename(temporary,target);
    }finally{await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
  },
};

export function terminalZshRc(plugin?:typeof terminalHighlightPlugins[number]):string {
  // No cwd/user text is embedded in code. %~ is expanded by zsh's prompt renderer;
  // disabling prompt substitution prevents $()/backticks in paths being executed.
  return `# Bob-only interactive shell. No user or global zshrc is sourced.
unsetopt PROMPT_SUBST PROMPT_BANG
setopt PROMPT_PERCENT
# Native prompt truncation leaves two columns free even after a resize. No
# command substitution, hooks or interpolation of cwd as executable shell code.
PROMPT='\n%F{green}%-2<...<%2~%<<%f\n%# '
RPROMPT=''
${plugin?`# The distro plugin's redraw hooks need ZLE loaded even in a bare rc.\nzmodload zsh/zle\nsource '${plugin}'\n`:''}`;
}

/** Called ONLY when creating a pane, never to upgrade an existing shell. */
export async function prepareTerminalShell(directory:string,io:TerminalShellIO=terminalShellIO):Promise<TerminalShell> {
  if(await io.executable('/usr/bin/zsh')){
    try{
      let plugin:typeof terminalHighlightPlugins[number]|undefined;
      for(const path of terminalHighlightPlugins)if(await io.trustedPlugin(path)){plugin=path;break;}
      const zdotdir=join(directory,'shell-zsh');
      await io.startup(zdotdir,terminalZshRc(plugin));
      return {argv:['/usr/bin/zsh','-d','-i'],env:{SHELL:'/usr/bin/zsh',ZDOTDIR:zdotdir}};
    }catch{/* Optional polish must not disable an otherwise working terminal. */}
  }
  if(await io.executable('/usr/bin/bash'))return {
    argv:['/usr/bin/bash','--noprofile','--norc','+O','promptvars','-i'],
    env:{SHELL:'/usr/bin/bash',PS1:'\\n\\[\\e[32m\\]\\W\\[\\e[0m\\]\\n\\$ '},
  };
  // POSIX sh has no portable, substitution-free dynamic cwd prompt.
  return {argv:['/bin/sh','-i'],env:{SHELL:'/bin/sh',PS1:'$ '}};
}
