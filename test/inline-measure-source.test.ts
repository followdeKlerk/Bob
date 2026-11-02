import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {INITIAL_INLINE_HEIGHT,MAX_INLINE_HEIGHT} from '../apps/mobile/inline-visual-policy.js';
const source=readFileSync('apps/mobile/android/app/src/main/assets/inline-measure.js','utf8');
function measure(natural:number,viewport=INITIAL_INLINE_HEIGHT,nestedOverflow=false){
 let load=()=>{},raf:(()=>void)|undefined;
 const sent:Array<{fits:boolean;contentHeight:number;viewportFits:boolean}>=[];
 class Element {
  scrollWidth=313;clientWidth=313;scrollHeight=natural;clientHeight=natural;scrollTop=0;scrollLeft=0;
  getClientRects(){return [this.getBoundingClientRect()];}
  getBoundingClientRect(){return {top:0,left:0,right:313,bottom:natural};}
 }
 const root=new Element(),body=new Element(),child=new Element();
 root.scrollHeight=Math.max(natural,viewport);
 if(nestedOverflow){child.clientHeight=20;child.scrollHeight=150;}
 (body as any).querySelectorAll=()=>nestedOverflow?[child]:[];
 vm.runInNewContext(source,{
  __BOB_INLINE_LAYOUT_KEY__:'test-layout',document:{documentElement:root,body},innerWidth:313,innerHeight:viewport,scrollX:0,scrollY:0,
  Element,HTMLElement:Element,getComputedStyle:()=>({display:'block',visibility:'visible',overflowY:'visible',marginBottom:'0px'}),
  addEventListener:(name:string,handler:()=>void)=>{if(name==='load')load=handler;},
  requestAnimationFrame:(handler:()=>void)=>{raf=handler;},setInterval:()=>{},
  MutationObserver:class{observe(){}},ResizeObserver:class{observe(){}},parent:{postMessage:(message:any)=>sent.push(message)},
 });
 load();raf?.();return sent;
}
test('initial loading stays 420 and JS, bundled measurement and native emergency constants agree',()=>{
 assert.equal(INITIAL_INLINE_HEIGHT,420);assert.equal(MAX_INLINE_HEIGHT,8192);
 assert.ok(source.includes(`maxHeight=${MAX_INLINE_HEIGHT}`));
 const native=readFileSync('apps/mobile/android/app/src/main/java/com/bobmobile/VisualActions.kt','utf8');
 assert.ok(native.includes(`const val MAX_INLINE_HEIGHT = ${MAX_INLINE_HEIGHT}`));
});
test('inline measurement reports natural height, not the scrollHeight viewport floor',()=>{
 const result=measure(214)[0];assert.equal(result.fits,true);assert.equal(result.contentHeight,214);assert.equal(result.viewportFits,true);
});
test('growth within the maximum requests a resize, while real or nested overflow rejects inline',()=>{
 const growth=measure(300,180)[0];assert.equal(growth.fits,true);assert.equal(growth.viewportFits,false);assert.equal(growth.contentHeight,300);
 for(const height of [650,1200,MAX_INLINE_HEIGHT]){
  const report=measure(height)[0];assert.equal(report.fits,true);assert.equal(report.contentHeight,height);assert.equal(report.viewportFits,false);
 }
 assert.equal(measure(MAX_INLINE_HEIGHT+1)[0].fits,false);assert.equal(measure(214,420,true)[0].fits,false);
 assert.deepEqual(measure(214,0),[],'detachment is not an overflow report; the host still bounds missing telemetry');
});
