export const FLUID_TAB_HEIGHT=52;
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
 const bottom=x+offset*.18,depth=(55-strain*7)*FLUID_TAB_HEIGHT/60;
 const L=Math.max(0,Math.min(left,neck-52)),R=Math.min(w,Math.max(right,neck+52));
 const y=(value:number)=>value*FLUID_TAB_HEIGHT/60;
 const edgeL=Math.min(22,L),edgeR=Math.min(22,w-R);
 return `M0 0 H${w} Q${w} ${y(8)} ${w-edgeR} ${y(8)} H${R} C${R-(R-right)*.7} ${y(8)} ${right} ${y(17)} ${right} ${y(31)} C${right} ${y(46-strain*4)} ${bottom+(right-bottom)*.62} ${depth} ${bottom} ${depth} C${bottom-(bottom-left)*.62} ${depth} ${left} ${y(46-strain*4)} ${left} ${y(31)} C${left} ${y(17)} ${L+(left-L)*.7} ${y(8)} ${L} ${y(8)} H${edgeL} Q0 ${y(8)} 0 0 Z`;
}
