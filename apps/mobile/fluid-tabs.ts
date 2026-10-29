export const FLUID_TAB_HEIGHT=60;
/** One continuous lower edge: tangent shoulders, a rounded lobe, and outer corners.
 * Positions are tab indices, so resizing never changes the selected destination. */
export function fluidTabPath(width:number,position:number,shoulderPosition=position):string{
 'worklet';
 const w=Math.max(1,width),p=Math.max(0,Math.min(4,position));
 const x=w*(p+.5)/5;
 const offset=Math.max(-9,Math.min(9,(shoulderPosition-p)*w/5));
 const radius=Math.min(24,w/12),neck=x+offset;
 const left=x-radius,right=x+radius;
 const L=Math.max(0,Math.min(left,neck-52)),R=Math.min(w,Math.max(right,neck+52));
 const edgeL=Math.min(22,L),edgeR=Math.min(22,w-R);
 return `M0 0 H${w} Q${w} 8 ${w-edgeR} 8 H${R} C${R-(R-right)*.7} 8 ${right} 17 ${right} 31 C${right} 46 ${x+radius*.62} 55 ${x} 55 C${x-radius*.62} 55 ${left} 46 ${left} 31 C${left} 17 ${L+(left-L)*.7} 8 ${L} 8 H${edgeL} Q0 8 0 0 Z`;
}
