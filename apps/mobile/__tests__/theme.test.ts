const {readFileSync,readdirSync}=jest.requireActual('node:fs');
const {resolve}=jest.requireActual('node:path');
declare const __dirname:string;
import {colors} from '../theme';
const source=(path:string)=>readFileSync(resolve(__dirname,'..',path),'utf8');
test('app background is pure black while raised controls remain distinguishable',()=>{
 expect(colors.background).toBe('#000000');expect(colors.surface).not.toBe(colors.background);expect(colors.composer).not.toBe(colors.background);
 expect(source('tailwind.config.js')).toContain("background:'#000000'");
});
test('Android launch window and system bars use the same pure-black background',()=>{
 const styles=source('android/app/src/main/res/values/styles.xml');
 for(const name of ['windowBackground','colorBackground','statusBarColor','navigationBarColor'])expect(styles).toContain(`<item name="android:${name}">#000000</item>`);
});
test('interactive host chrome matches the app without recoloring user-generated visuals',()=>{
 const native=source('android/app/src/main/java/com/bobmobile/BobInteractive.kt');expect(native).toContain('setBackgroundColor(0xff000000.toInt())');expect(native).toContain('margin:0;background:#000000');
 expect(source('../interactive/host.ts')).toContain('border:0;background:#000000');
});

const tailwind=require('../tailwind.config');
test('all formerly white foreground and primary-control tokens match warm navigation',()=>{
 const beige='#e8e0d2';
 for(const key of ['navigationSurface','foreground','body','accent'] as const)expect(colors[key]).toBe(beige);
 for(const key of ['foreground','primary','secondary-foreground','accent-foreground','ring'])expect(tailwind.theme.extend.colors[key]).toBe(beige);
 expect(tailwind.theme.extend.colors['primary-foreground']).toBe(colors.onAccent);
 expect(source('App.tsx')).toContain('backgroundColor:keyboardInset>0?colors.background:colors.navigationSurface');
 const {navigationSurface,foreground,body,accent,...monochrome}=colors;
 for(const color of Object.values(monochrome)){
  expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(color.slice(1,3)).toBe(color.slice(3,5));expect(color.slice(3,5)).toBe(color.slice(5,7));
 }
 // Preserve contrast for secondary copy and black labels on light buttons.
 expect(colors.muted).toBe('#a1a1a1');expect(colors.onAccent).toBe('#000000');
});

test('warm foreground and button labels retain normal-text contrast',()=>{
 const luminance=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
 const contrast=(a:string,b:string)=>{const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(values[0]+0.05)/(values[1]+0.05);};
 for(const background of [colors.background,colors.panel,colors.surface,colors.composer,colors.selectedSurface,tailwind.theme.extend.colors.destructive])expect(contrast(colors.foreground,background)).toBeGreaterThanOrEqual(4.5);
 expect(contrast(colors.accent,colors.onAccent)).toBeGreaterThanOrEqual(4.5);
});

test('owned native text, controls, surface status and logo tints share the beige',()=>{
 const styles=source('android/app/src/main/res/values/styles.xml');
 for(const name of ['android:textColorPrimary','android:textColorSecondary','colorAccent','android:colorAccent','colorControlNormal','android:colorControlNormal'])expect(styles).toContain(`<item name="${name}">#e8e0d2</item>`);
 const native=source('android/app/src/main/java/com/bobmobile/BobInteractive.kt');
 expect(native).toContain('setTextColor(0xffe8e0d2.toInt())');expect(native).toContain('color:#e8e0d2');
 const preview=source('android/app/src/main/java/com/bobmobile/BobPreviewActivity.kt');
 expect(preview.match(/backgroundTintList = android.content.res.ColorStateList.valueOf\(0xffe8e0d2.toInt\(\)\)/g)).toHaveLength(3);
 expect(preview.match(/setTextColor\(0xff000000.toInt\(\)\)/g)).toHaveLength(3);
 expect(source('App.tsx')).toContain("welcomeLogo:{width:'100%',maxWidth:400,aspectRatio:1}");
 expect(source('../../tools/generate-mobile-icons.sh')).toContain("warm_white='#e8e0d2'");
 expect(source('android/app/src/main/res/values/colors.xml')).toContain('<color name="zxing_status_text">#e8e0d2</color>');
 expect(source('components/side-drawer.tsx')).toContain('brand:{width:90,height:42,tintColor:colors.foreground}');
});

test('brand artwork is warm without tinting its dark canvas; status icons remain OS alpha masks',()=>{
 const {PNG}=jest.requireActual('pngjs');
 const image=(path:string)=>PNG.sync.read(readFileSync(resolve(__dirname,'..',path)));
 for(const path of ['assets/bob-logo.png','assets/bob-wordmark.png','android/app/src/main/res/drawable-nodpi/bob_launcher_foreground.png','android/app/src/main/res/drawable-nodpi/bob_notification_logo.png']){
  const png=image(path);let warm=0,dark=0,white=0;
  for(let i=0;i<png.data.length;i+=4){
   const [r,g,b,a]=png.data.subarray(i,i+4);if(!a)continue;
   if(r===232&&g===224&&b===210)warm++;
   if(Math.max(r,g,b)<5)dark++;
   if(Math.min(r,g,b)>=220&&Math.max(r,g,b)-Math.min(r,g,b)<=15)white++;
  }
  expect({path,white}).toEqual({path,white:0});expect(warm).toBeGreaterThan(0);
  if(path==='assets/bob-logo.png')expect(dark).toBeGreaterThan(0);
 }
 for(const density of ['mdpi','hdpi','xhdpi','xxhdpi','xxxhdpi']){
  const mask=image(`android/app/src/main/res/drawable-${density}/ic_stat_bob.png`);let visible=0;
  for(let i=0;i<mask.data.length;i+=4)if(mask.data[i+3]){visible++;expect([...mask.data.subarray(i,i+3)]).toEqual([255,255,255]);}
  expect(visible).toBeGreaterThan(0);
 }
});

test('no app-owned white literals bypass the theme; drawing paper stays white',()=>{
 const files=(dir:string):string[]=>readdirSync(resolve(__dirname,'..',dir),{withFileTypes:true}).flatMap((entry:any)=>entry.isDirectory()?files(`${dir}/${entry.name}`):/\.(tsx?|js|kt|xml)$/.test(entry.name)?[`${dir}/${entry.name}`]:[]);
 for(const path of ['App.tsx','theme.ts','tailwind.config.js',...files('components'),...files('android/app/src/main/java/com/bobmobile'),...files('android/app/src/main/res/values')]){
  let text=source(path);
  if(path==='components/drawing-editor.tsx'){
   // White belongs only to document content: eraser and exported paper, never canvas chrome.
   for(const paper of ["erasing?'#ffffff'",'fill="#ffffff"'])text=text.replace(paper,'DRAWING_PAPER');
  }
  const whites=[...text.matchAll(/(?:#|0xff)([0-9a-f]{6})\b/gi)].filter(([,hex])=>{
   const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
   return Math.min(...rgb)>=220&&Math.max(...rgb)-Math.min(...rgb)<=15;
  });
  expect({path,whites:whites.map(([hex])=>hex)}).toEqual({path,whites:[]});
  if(path.endsWith('BobPreviewActivity.kt'))text=text.replace('eraseColor(android.graphics.Color.WHITE)','PDF_PAPER');
  expect({path,whiteUtility:/\b(?:text|bg|border|stroke|fill)-white\b|['"]white['"]|#fff\b|Color\.WHITE|rgba?\(\s*255\s*,\s*255\s*,\s*255/i.test(text)}).toEqual({path,whiteUtility:false});
 }
 expect(source('components/drawing-editor.tsx')).toContain('fill="#ffffff"');
 expect(source('android/app/src/main/java/com/bobmobile/BobPreviewActivity.kt')).toContain('eraseColor(android.graphics.Color.WHITE)');
});
