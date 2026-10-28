(()=>{
  const key=__BOB_INLINE_LAYOUT_KEY__,maxHeight=420;
  let last,queued=false,forceNext=false;
  function report(value,force){
    const signature=JSON.stringify(value);
    if(!force&&signature===last)return;
    last=signature;parent.postMessage({bobLayout:key,...value},'*');
  }
  function check(force=false){
    const root=document.documentElement,body=document.body;
    if(!root||!body)return;
    const width=innerWidth,height=innerHeight;
    // A temporarily detached/unlaid-out row is not proof of overflow. The host
    // still has a bounded deadline before an unmeasured surface is promoted.
    if(width<=0||height<=0)return;
    const elements=Array.from(body.querySelectorAll('*'));
    let fits=elements.length<=10000&&root.scrollWidth<=width+1&&body.scrollWidth<=width+1&&scrollX===0&&scrollY===0;
    let bottom=0;
    // In standards mode an auto-height root/body has its natural content bounds,
    // unlike scrollHeight, which has a viewport-height floor and cannot shrink.
    // Explicit 100vh/100% layouts intentionally continue to fill the viewport.
    for(const element of [root,body,...elements]){
      if(!fits)break;
      if(!(element instanceof Element)||!element.getClientRects().length)continue;
      const style=getComputedStyle(element);
      if(style.display==='none'||style.visibility==='hidden')continue;
      const rect=element.getBoundingClientRect();
      if(rect.right>width+1||rect.left< -1||rect.top< -1||rect.bottom>maxHeight+1){fits=false;break;}
      bottom=Math.max(bottom,rect.bottom+(element===root||element===body?Math.max(0,parseFloat(style.marginBottom)||0):0));
      if(element instanceof HTMLElement){
        if(element.scrollLeft!==0||element.scrollTop!==0||(element.clientWidth>0&&element.scrollWidth>element.clientWidth+1))fits=false;
        // Document-height growth is handled by the host resize handshake. A
        // nested scrolling/clipping region is never made acceptable by resizing.
        if(element!==root&&element!==body&&element.clientHeight>0&&element.scrollHeight>element.clientHeight+1)fits=false;
        if(element===body&&style.overflowY!=='visible'&&element.clientHeight>0&&element.scrollHeight>element.clientHeight+1)fits=false;
      }
    }
    const contentHeight=Math.max(1,Math.ceil(bottom));
    if(contentHeight>maxHeight)fits=false;
    report({fits,contentHeight,viewportWidth:width,viewportHeight:height,viewportFits:fits&&contentHeight<=height+1&&root.scrollHeight<=height+1},force);
  }
  function schedule(force=false){
    forceNext=forceNext||force;
    if(queued)return;queued=true;
    requestAnimationFrame(()=>{queued=false;const send=forceNext;forceNext=false;check(send);});
  }
  addEventListener('load',()=>{schedule(true);setInterval(check,300);});
  addEventListener('resize',()=>schedule(true));
  addEventListener('scroll',()=>schedule(true),true);
  addEventListener('bob:visual-data',()=>schedule(true));
  addEventListener('DOMContentLoaded',()=>{
    new MutationObserver(()=>schedule()).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
    new ResizeObserver(()=>schedule()).observe(document.body);
  });
})();
