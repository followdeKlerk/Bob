export const FLUID_TAB_HEIGHT=60;
/** One continuous lower edge: tangent shoulders, a rounded lobe, and outer corners.
 * Positions are tab indices, so resizing never changes the selected destination.
 * The default count preserves geometry for existing five-tab callers. */
export function fluidTabPath(width:number,position:number,shoulderPosition=position,tabCount=5):string{
 'worklet';
 const count=Math.max(1,Math.floor(tabCount));
 const w=Math.max(1,width),p=Math.max(0,Math.min(count-1,position));
 const x=w*(p+.5)/count;
 // The lobe leads while the neck trails. Bound deformation to a tab-relative
 // distance so long jumps stretch visibly without sweeping across the bar.
 const slot=w/count,maxDrag=Math.min(56,slot*.9);
 const trailing=Math.max(0,Math.min(count-1,shoulderPosition));
 const offset=Math.max(-maxDrag,Math.min(maxDrag,(trailing-p)*slot));
 const strain=Math.abs(offset)/maxDrag;
 const radius=Math.min(24,w/12),neck=x+offset;
 const left=Math.max(0,x-radius+Math.min(0,offset)*.65);
 const right=Math.min(w,x+radius+Math.max(0,offset)*.65);
 const bottom=x+offset*.18,depth=55-strain*7;
 const L=Math.max(0,Math.min(left,neck-52)),R=Math.min(w,Math.max(right,neck+52));
 const edgeL=Math.min(22,L),edgeR=Math.min(22,w-R);
 return `M0 0 H${w} Q${w} 8 ${w-edgeR} 8 H${R} C${R-(R-right)*.7} 8 ${right} 17 ${right} 31 C${right} ${46-strain*4} ${bottom+(right-bottom)*.62} ${depth} ${bottom} ${depth} C${bottom-(bottom-left)*.62} ${depth} ${left} ${46-strain*4} ${left} 31 C${left} 17 ${L+(left-L)*.7} 8 ${L} 8 H${edgeL} Q0 8 0 0 Z`;
}
