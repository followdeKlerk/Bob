import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';

// Bump whenever the input boundary, normalization or allowlist changes. Old
// baselines must never silently acquire a broader exemption after an upgrade.
const policy=1;
export const uiBaselineKey='fullyValidatedUiBaseline';
export type SourceManifest={policy:1;files:Record<string,string>};
type ReleaseIdentity={id:string;cli:string;sourceHash?:string;compatibility?:string;durableVersion?:string};
export type UiBaseline={policy:1;root:string;releaseId:string;sourceHash:string;compatibility:string;durableVersion:string;manifest:SourceManifest};

// Reviewed presentation leaves only. No directory globs: new components, tests,
// App.tsx, state, network, native code, dependencies and shared code all fall back.
const presentationFiles=new Set([
 'apps/mobile/theme-tokens.ts',
 'apps/mobile/typography.ts',
 'apps/mobile/components/app-text.tsx',
 'apps/mobile/components/edge-fade.tsx',
 'apps/mobile/components/tab-glyph.tsx',
 'apps/mobile/components/section-ui.tsx',
 'apps/mobile/components/compact-activity-row.tsx',
]);

// Deliberately not .gitignore: ignored build scripts/config/new source are inputs
// too. Only known generated/dependency output and private research are excluded.
const generated=new Set([
 '.git','node_modules','dist','docs',
 'apps/mobile/node_modules',
 'apps/mobile/android/.gradle','apps/mobile/android/.kotlin',
 'apps/mobile/android/build','apps/mobile/android/app/build','apps/mobile/android/app/.cxx',
 'apps/mobile/android/inline-webview-test/build',
 'apps/mobile/android/local.properties',
 'apps/mobile/android/app/src/main/assets/bob-host.js',
 ...['core','coding','resources','subagents','web','interactive','peers','memory'].map(name=>'packages/'+name+'/dist'),
]);

/** Preserve every byte except the actual generated JSON version string values.
 * Parsing before tokenization rejects malformed/ambiguous syntax. In particular,
 * dependency versions and the package-lock packages table are never erased. */
export function mobilePackageVersion(text:string,lock:boolean,version='<release-version>'):string{
 JSON.parse(text);
 const tokens=[...text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)];
 let cursor=0;const replacements:{start:number;end:number}[]=[];
 const value=(path:string[])=>{
  const token=tokens[cursor++];
  if(token[0]==='{'){
   while(tokens[cursor][0]!=='}'){
    const key=JSON.parse(tokens[cursor++][0]);cursor++;value([...path,key]);
    if(tokens[cursor][0]===',')cursor++;
   }
   cursor++;
  }else if(token[0]==='['){
   let index=0;while(tokens[cursor][0]!==']'){value([...path,String(index++)]);if(tokens[cursor][0]===',')cursor++;}cursor++;
  }else if((path.length===1&&path[0]==='version'||lock&&path.length===3&&path[0]==='packages'&&path[1]===''&&path[2]==='version')&&/^"\d+\.\d+\.\d+"$/.test(token[0])){
   replacements.push({start:token.index!,end:token.index!+token[0].length});
  }
 };
 value([]);
 for(const {start,end} of replacements.reverse())text=text.slice(0,start)+JSON.stringify(version)+text.slice(end);
 return text;
}
function normalizedContent(path:string,bytes:Buffer):Buffer|string{
 if(path==='apps/mobile/package.json'||path==='apps/mobile/package-lock.json')return mobilePackageVersion(bytes.toString('utf8'),path.endsWith('package-lock.json'));
 if(path==='apps/mobile/android/app/build.gradle'){
  let text=bytes.toString('utf8');
  const code=/^(\s*versionCode[ \t]+)\d+([ \t]*\r?)$/gm,name=/^(\s*versionName[ \t]+)"\d+\.\d+\.\d+"([ \t]*\r?)$/gm;
  if([...text.matchAll(code)].length!==1||[...text.matchAll(name)].length!==1)throw Error('Unknown Android version metadata');
  text=text.replace(code,'$1<release-code>$2').replace(name,'$1"<release-version>"$2');return text;
 }
 return bytes;
}

/** Full worktree content, not HEAD/status/mtime. Never follow a symlink, even at
 * an excluded output path; unreadable/unknown filesystem objects disable fast. */
export function sourceManifest(root:string):SourceManifest{
 if(!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())throw Error('Source root must be a real directory');
 const files:Record<string,string>=Object.create(null);
 const visit=(relative:string)=>{
  const path=join(root,relative),stat=lstatSync(path);
  if(stat.isSymbolicLink())throw Error('Symlink in source manifest: '+relative);
  if(generated.has(relative))return;
  if(stat.isDirectory())for(const name of readdirSync(path).sort())visit(relative?relative+'/'+name:name);
  else if(stat.isFile())files[relative]=createHash('sha256').update(String(stat.mode&0o111)+'\0').update(normalizedContent(relative,readFileSync(path))).digest('hex');
  else throw Error('Nonregular source input: '+relative);
 };
 visit('');return {policy,files};
}
function validManifest(value:unknown):value is SourceManifest{
 if(!value||typeof value!=='object')return false;
 const manifest=value as SourceManifest;
 return manifest.policy===policy&&!!manifest.files&&typeof manifest.files==='object'&&!Array.isArray(manifest.files)&&Object.entries(manifest.files).every(([path,hash])=>path!==''&&!path.startsWith('/')&&!path.split('/').some(part=>!part||part==='.'||part==='..')&&typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash));
}
export function sameManifest(a:SourceManifest,b:SourceManifest):boolean{
 const paths=Object.keys(a.files);return a.policy===b.policy&&paths.length===Object.keys(b.files).length&&paths.every(path=>a.files[path]===b.files[path]);
}
export function createUiBaseline(root:string,release:ReleaseIdentity,manifest:SourceManifest):UiBaseline{
 if(!release.sourceHash||!release.compatibility||!release.durableVersion||!validManifest(manifest))throw Error('Incomplete fully validated release');
 return {policy,root:realpathSync(root),releaseId:release.id,sourceHash:release.sourceHash,compatibility:release.compatibility,durableVersion:release.durableVersion,manifest};
}
export function uiFastPath(target:string,root:string,current:SourceManifest|undefined,baseline:unknown,validated:ReleaseIdentity|undefined,active:ReleaseIdentity|undefined):{eligible:boolean;reason:string;baselineId?:string;changedFiles?:string[]}{
 const no=(reason:string)=>({eligible:false,reason});
 if(target!=='android')return no('target requires full backend validation');
 if(!current||!validManifest(current))return no('source manifest unavailable');
 if(!baseline||typeof baseline!=='object')return no('no fully validated UI baseline');
 const b=baseline as UiBaseline;
 let canonicalRoot:string;
 try{canonicalRoot=realpathSync(root);}catch{return no('source root unavailable');}
 if(b.policy!==policy||!validManifest(b.manifest)||b.root!==canonicalRoot||!b.sourceHash||!b.compatibility||!b.durableVersion||!b.releaseId)return no('unknown or incompatible baseline');
 if(!validated||validated.id!==b.releaseId||validated.sourceHash!==b.sourceHash||validated.compatibility!==b.compatibility||validated.durableVersion!==b.durableVersion)return no('baseline release evidence missing');
 if(!active?.cli||active.compatibility!==b.compatibility||active.durableVersion!==b.durableVersion)return no('no compatible active backend to reuse');
 try{if(!lstatSync(active.cli).isFile())return no('active backend CLI unavailable');}catch{return no('active backend CLI unavailable');}
 const before=Object.keys(b.manifest.files),after=Object.keys(current.files);
 if(before.length!==after.length||before.some(path=>!Object.hasOwn(current.files,path)))return no('new or deleted source input');
 const changed=after.filter(path=>b.manifest.files[path]!==current.files[path]);
 if(changed.some(path=>!presentationFiles.has(path)))return no('changes outside reviewed presentation files');
 return {eligible:true,reason:changed.length+' reviewed presentation file(s) changed',baselineId:b.releaseId,changedFiles:changed};
}
