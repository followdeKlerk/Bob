import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const mobile='apps/mobile',native=join(mobile,'android/app/src/main');

test('all owned native text components use shared typography, with no legacy font overrides',()=>{
 function sources(path:string):string[]{return readdirSync(path,{withFileTypes:true}).flatMap(file=>file.isDirectory()?sources(join(path,file.name)):file.name.endsWith('.tsx')?[join(path,file.name)]:[]);}
 for(const file of [join(mobile,'App.tsx'),...sources(join(mobile,'components'))]){
  if(file.endsWith('app-text.tsx'))continue;
  const source=readFileSync(file,'utf8');
  for(const match of source.matchAll(/import\s*\{([^}]+)\}\s*from ['"]react-native['"]/g)){
   assert.doesNotMatch(match[1],/(?:^|,)\s*(?:Text|TextInput)\s*(?:,|$|as\s)/,file);
  }
  assert.doesNotMatch(source,/fontFamily\s*:\s*['"](?:monospace|Menlo|sans-serif|serif)['"]/,file);
 }
 const markdown=readFileSync(join(mobile,'components/chat-markdown.tsx'),'utf8');
 assert.match(markdown,/body:\{fontFamily:APP_FONT_FAMILY/);
 assert.match(markdown,/code_inline:\{fontFamily:APP_FONT_FAMILY/);
});

test('bundled font files retain upstream bytes, license, and registered weight/italic mapping',()=>{
 const assets=join(native,'assets/fonts'),fonts=join(native,'res/font');
 const provenance=readFileSync(join(assets,'README.md'),'utf8');
 assert.match(provenance,/Nordwand Mono 1\.4\.0/);
 const hashes=[...provenance.matchAll(/- `([^`]+)`: `([a-f0-9]{64})`/g)];assert.equal(hashes.length,12);
 for(const [,name,expected] of hashes){
  const data=readFileSync(join(name.endsWith('.ttf')?fonts:assets,name));
  assert.equal(createHash('sha256').update(data).digest('hex'),expected,name);
  assert.ok(data.length>10000,name);
 }
 assert.match(readFileSync(join(assets,'OFL.txt'),'utf8'),/SIL OPEN FONT LICENSE Version 1\.1/);
 const xml=readFileSync(join(fonts,'nordwand_mono.xml'),'utf8');
 assert.equal((xml.match(/<font /g)??[]).length,8);
 for(const weight of [400,500,600,700])for(const style of ['normal','italic'])assert.ok(xml.includes(`android:fontWeight="${weight}" android:fontStyle="${style}"`));
 const application=readFileSync(join(native,'java/com/bobmobile/MainApplication.kt'),'utf8');
 assert.match(application,/addCustomFont\(this, "Nordwand Mono", R.font.nordwand_mono\)/);
 assert.ok(application.indexOf('addCustomFont(')<application.indexOf('loadReactNative(this)'));
 assert.match(readFileSync(join(native,'res/values/styles.xml'),'utf8'),/android:fontFamily">@font\/nordwand_mono/);
});

test('compact utility type scale is one point smaller without shrinking line heights',()=>{
 const require=createRequire(new URL('../apps/mobile/package.json',import.meta.url));
 const sizes=require('./tailwind.config.js').theme.extend.fontSize;
 const previous={xs:[12,16],sm:[14,20],base:[16,24],lg:[18,28],xl:[20,28],'2xl':[24,32],'3xl':[30,36],'4xl':[36,40]};
 for(const [name,[size,lineHeight]] of Object.entries(previous))assert.deepEqual(sizes[name],[`${size-1}px`,{lineHeight:`${lineHeight}px`}]);
 const markdown=readFileSync(join(mobile,'components/chat-markdown.tsx'),'utf8');
 assert.match(markdown,/body:\{fontFamily:APP_FONT_FAMILY,color:colors.body,fontSize:15,lineHeight:25/);
 assert.match(markdown,/codeText:\{fontFamily:APP_FONT_FAMILY,fontSize:13,lineHeight:22/);
 assert.match(markdown,/heading1:\{[^}]*fontSize:24,lineHeight:33/);
 const composer=readFileSync(join(mobile,'components/draft-input.tsx'),'utf8');
 assert.match(composer,/fontSize:17,lineHeight:26,minHeight:48/);
 assert.match(composer,/compactInput:\{marginHorizontal:44,fontSize:15,lineHeight:24/);
});
