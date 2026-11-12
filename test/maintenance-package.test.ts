import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {installLockedRuntime} from '../src/maintenance-build.js';

test('cold package installation keeps the reviewed graph despite newer registry metadata',{timeout:45000},async t=>{
 const base=mkdtempSync(join(tmpdir(),'bob-locked-runtime-')),source=join(base,'source'),packed=join(base,'packed'),dependency=join(base,'dependency'),requests:string[]=[];
 t.after(()=>rmSync(base,{recursive:true,force:true}));
 const put=(file:string,data:string)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,data);};
 const run=async(command:string,args:string[],cwd:string,timeout:number)=>await new Promise<void>((ok,fail)=>{
  const child=spawn(command,args,{cwd,env:{...process.env,npm_config_cache:join(base,'empty-cache'),npm_config_registry:origin,npm_config_update_notifier:'false'},stdio:['ignore','pipe','pipe']});
  let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');fail(Error('Fixture subprocess timed out'));},timeout);
  child.stdout.on('data',b=>{output=(output+String(b)).slice(-2000);});child.stderr.on('data',b=>{output=(output+String(b)).slice(-2000);});
  child.once('error',e=>{clearTimeout(timer);fail(e);});child.once('close',code=>{clearTimeout(timer);code===0?ok():fail(Error(output));});
 });
 let tarball:Buffer;
 const registry=createServer((req,res)=>{
  requests.push(req.url!);
  if(req.url==='/bob-lock-probe-dependency/-/bob-lock-probe-dependency-1.0.0.tgz'){res.setHeader('Content-Type','application/octet-stream');res.end(tarball);return;}
  // An unlocked resolver would choose 2.0.0; the reviewed lock pins 1.0.0.
  if(req.url==='/bob-lock-probe-dependency'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({name:'bob-lock-probe-dependency','dist-tags':{latest:'2.0.0'},versions:{'2.0.0':{name:'bob-lock-probe-dependency',version:'2.0.0',dist:{tarball:origin+'/unreviewed-2.0.0.tgz'}}}}));return;}
  res.statusCode=404;res.end();
 });
 await new Promise<void>(ok=>registry.listen(0,'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+(registry.address() as {port:number}).port;
 t.after(()=>{registry.closeAllConnections();registry.close();});
 put(join(dependency,'package/package.json'),JSON.stringify({name:'bob-lock-probe-dependency',version:'1.0.0'}));
 const depArchive=join(base,'dependency.tgz');await run('tar',['-czf',depArchive,'-C',dependency,'package'],base,10000);tarball=readFileSync(depArchive);
 const manifest={name:'@bob-local/cli',version:'0.3.0',workspaces:['packages/core'],bundleDependencies:['@bob-local/core'],dependencies:{'@bob-local/core':'0.1.0','bob-lock-probe-dependency':'*'}};
 const workspace={name:'@bob-local/core',version:'0.1.0'};
 const lock=JSON.stringify({name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,packages:{'':manifest,'packages/core':workspace,'node_modules/@bob-local/core':{resolved:'packages/core',link:true},'node_modules/bob-lock-probe-dependency':{version:'1.0.0',resolved:origin+'/bob-lock-probe-dependency/-/bob-lock-probe-dependency-1.0.0.tgz',integrity:'sha512-'+createHash('sha512').update(tarball).digest('base64')}}});
 put(join(source,'package-lock.json'),lock);
 put(join(packed,'package/package.json'),JSON.stringify(manifest));
 put(join(packed,'package/dist/cli.js'),'// exact compiled payload\n');
 put(join(packed,'package/node_modules/@bob-local/core/package.json'),JSON.stringify(workspace));
 put(join(packed,'package/node_modules/@bob-local/core/dist/index.js'),'// exact compiled workspace\n');
 const archive=join(base,'runtime.tgz');await run('tar',['-czf',archive,'-C',packed,'package'],base,10000);
 const root=await installLockedRuntime({sourceRoot:source,archive,installation:join(base,'installation'),run});
 assert.equal(JSON.parse(readFileSync(join(root,'node_modules/bob-lock-probe-dependency/package.json'),'utf8')).version,'1.0.0');
 assert.equal(readFileSync(join(root,'node_modules/@bob-local/core/dist/index.js'),'utf8'),'// exact compiled workspace\n');
 assert.equal(readFileSync(join(root,'dist/cli.js'),'utf8'),'// exact compiled payload\n');
 assert.equal(readFileSync(join(root,'package-lock.json'),'utf8'),lock);
 assert.equal(readFileSync(join(source,'package-lock.json'),'utf8'),lock);
 assert.deepEqual(requests,['/bob-lock-probe-dependency/-/bob-lock-probe-dependency-1.0.0.tgz'],'only the locked integrity-pinned tarball is fetched; registry metadata cannot change the graph');
 put(join(packed,'package/npm-shrinkwrap.json'),'{"lockfileVersion":3,"packages":{}}');
 await run('tar',['-czf',archive,'-C',packed,'package'],base,10000);
 await assert.rejects(installLockedRuntime({sourceRoot:source,archive,installation:join(base,'shadow-lock-installation'),run}),/shrinkwrap cannot override/);
 assert.equal(requests.length,1,'shadow locks are rejected before another dependency fetch');
});
