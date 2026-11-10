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
 assert.match(markdown,/code_inline:\{fontFamily:APP_MONO_FONT_FAMILY/);
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
 assert.match(readFileSync(join(native,'res/values/styles.xml'),'utf8'),/android:fontFamily">@font\/nunito/);
});

test('compact utility type scale is one point smaller without shrinking line heights',()=>{
 const require=createRequire(new URL('../apps/mobile/package.json',import.meta.url));
 const sizes=require('./tailwind.config.js').theme.extend.fontSize;
 const previous={xs:[12,16],sm:[14,20],base:[16,24],lg:[18,28],xl:[20,28],'2xl':[24,32],'3xl':[30,36],'4xl':[36,40]};
 for(const [name,[size,lineHeight]] of Object.entries(previous))assert.deepEqual(sizes[name],[`${size-1}px`,{lineHeight:`${lineHeight}px`}]);
 const markdown=readFileSync(join(mobile,'components/chat-markdown.tsx'),'utf8');
 assert.match(markdown,/body:\{fontFamily:APP_FONT_FAMILY,color:colors.body,fontSize:15,lineHeight:25/);
 assert.match(markdown,/codeText:\{fontFamily:APP_MONO_FONT_FAMILY,fontSize:13,lineHeight:22/);
 assert.match(markdown,/heading1:\{[^}]*fontSize:24,lineHeight:33/);
 const composer=readFileSync(join(mobile,'components/draft-input.tsx'),'utf8');
 assert.match(composer,/fontSize:17,lineHeight:26,minHeight:48/);
 assert.match(composer,/compactInput:\{marginHorizontal:44,fontSize:15,lineHeight:24/);
});


// Inspect sfnt metadata directly: hashes alone cannot prove the requested weight
// or a real italic face, and no build-time font conversion/dependency is needed.
function fontTables(data:Buffer):Map<string,number>{
 const result=new Map<string,number>();
 for(let i=0;i<data.readUInt16BE(4);i++){const offset=12+16*i;result.set(data.toString('ascii',offset,offset+4),data.readUInt32BE(offset+8));}
 return result;
}
function hasGlyph(data:Buffer,tables:Map<string,number>,code:number):boolean{
 const cmap=tables.get('cmap')!;
 for(let i=0;i<data.readUInt16BE(cmap+2);i++){
  const sub=cmap+data.readUInt32BE(cmap+8+8*i);
  if(data.readUInt16BE(sub)!==4)continue;
  const count=data.readUInt16BE(sub+6)/2;
  for(let j=0;j<count;j++){
   const end=data.readUInt16BE(sub+14+2*j),start=data.readUInt16BE(sub+16+2*count+2*j);
   if(code>=start&&code<=end)return true;
  }
 }
 return false;
}

test('Nunito official static faces retain pinned bytes, real 400/500/600/700 weights, italics and extended scripts',()=>{
 const assets=join(native,'assets/fonts/nunito'),fonts=join(native,'res/font');
 const provenance=JSON.parse(readFileSync(join(assets,'provenance.json'),'utf8'));
 assert.equal(provenance.family,'Nunito');assert.equal(provenance.fonts.length,8);
 const license=readFileSync(join(assets,'OFL.txt'));
 assert.equal(createHash('sha256').update(license).digest('hex'),provenance.licenseSha256);
 assert.match(license.toString(),/Copyright 2014 The Nunito Project Authors/);
 assert.match(license.toString(),/SIL OPEN FONT LICENSE Version 1\.1/);
 const xml=readFileSync(join(fonts,'nunito.xml'),'utf8');
 const interactive=readFileSync(join(native,'java/com/bobmobile/BobInteractive.kt'),'utf8');
 assert.match(interactive,/ResourcesCompat.getFont\(context, R.font.nunito\)/);
 assert.match(interactive,/context.resources.openRawResource\(font\)/);
 assert.equal((xml.match(/<font /g)??[]).length,8);
 for(const font of provenance.fonts){
  assert.match(font.url,/^https:\/\/fonts\.gstatic\.com\/s\/nunito\/v32\//);
  const data=readFileSync(join(fonts,font.file)),tables=fontTables(data);
  assert.equal(createHash('sha256').update(data).digest('hex'),font.sha256,font.file);
  assert.equal(tables.has('fvar'),false,'official static face, not a variable default');
  const os2=tables.get('OS/2')!;
  assert.equal(data.readUInt16BE(os2+4),font.weight,font.file);
  assert.equal(Boolean(data.readUInt16BE(os2+62)&1),font.style==='italic',font.file);
  for(const char of 'Az09żłПриветệ')assert.ok(hasGlyph(data,tables,char.codePointAt(0)!),`${font.file}: ${char}`);
  assert.ok(xml.includes(`android:font="@font/${font.file.slice(0,-4)}" android:fontWeight="${font.weight}" android:fontStyle="${font.style}"`));
  assert.ok(interactive.includes(`Triple(R.font.${font.file.slice(0,-4)}, "${font.weight===700?'700 1000':font.weight}", "${font.style}")`));
 }
 const application=readFileSync(join(native,'java/com/bobmobile/MainApplication.kt'),'utf8');
 assert.match(application,/addCustomFont\(this, "Nunito", R.font.nunito\)/);
 assert.ok(application.indexOf('"Nunito"')<application.indexOf('loadReactNative(this)'));
 const typography=readFileSync(join(mobile,'typography.ts'),'utf8');
 assert.match(typography,/APP_FONT_FAMILY='Nunito'/);assert.match(typography,/APP_UI_FONT_FAMILY=APP_FONT_FAMILY/);assert.match(typography,/APP_MONO_FONT_FAMILY='Nordwand Mono'/);
 for(const name of ['chat-markdown','peer-admission','tool-content']){
  const source=readFileSync(join(mobile,`components/${name}.tsx`),'utf8');
  assert.match(source,/typography="mono"/);assert.match(source,/fontFamily:APP_MONO_FONT_FAMILY/);
 }
});


test('preview chrome uses rounded UI type while original text-file layout stays monospaced',()=>{
 const source=readFileSync(join(native,'java/com/bobmobile/BobPreviewActivity.kt'),'utf8');
 assert.ok(source.includes('if (monospaced) R.font.nordwand_mono else R.font.nunito'));
 assert.ok(source.includes('label(16f, monospaced = true)'));
 assert.ok(source.includes('BobAppearance.button(this); typeface = androidx.core.content.res.ResourcesCompat.getFont(context, R.font.nunito)'));
 const pkg=JSON.parse(readFileSync('package.json','utf8'));
 assert.ok(pkg.files.includes('apps/mobile/android/app/src/main/assets/fonts/nunito'));
});
