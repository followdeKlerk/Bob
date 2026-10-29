import {FLUID_TAB_HEIGHT,fluidTabPath} from '../fluid-tabs';
test.each([240,313,361,760])('fluid geometry stays bounded at width %i, including edge tabs and rapid reversals',width=>{
 for(let position=0;position<=4;position+=.125){
  for(const shoulder of [0,2,4]){
   const path=fluidTabPath(width,position,shoulder);
   expect(path).not.toMatch(/NaN|Infinity/);
   expect(path.startsWith(`M0 0 H${width} `)).toBe(true);
   const values=(path.match(/-?\d+(?:\.\d+)?/g)??[]).map(Number);
   expect(values.every(value=>value>=0&&value<=Math.max(width,FLUID_TAB_HEIGHT))).toBe(true);
   expect(path.endsWith('Q0 8 0 0 Z')).toBe(true);
  }
 }
});
test('shoulders start tangent to the flat surface and the lobe has a rounded bottom',()=>{
 const path=fluidTabPath(360,2);
 // Both shoulder control points share the flat-edge y coordinate (8),
 // rather than the abrupt vertical joins in the first mockup.
 expect(path).toContain('H232 C212.4 8 204 17 204 31');
 expect(path).toContain('180 55 C165.12 55 156 46 156 31');
 expect(path).toContain('C156 17 147.6 8 128 8');
});
test('shape stretches during travel, settles exactly, and clamps spring overshoot',()=>{
 expect(fluidTabPath(313,2,1)).not.toBe(fluidTabPath(313,2,2));
 expect(fluidTabPath(313,2,2)).toBe(fluidTabPath(313,2));
 expect(fluidTabPath(313,-.2,0)).toBe(fluidTabPath(313,0));
 expect(fluidTabPath(313,4.2,4)).toBe(fluidTabPath(313,4));
});

test('liquid travel stretches toward the trailing tab and lifts the rounded bottom, symmetrically',()=>{
 const curve=(position:number,tail:number)=>{
  const segments=fluidTabPath(360,position,tail).split(' C').slice(1).map(part=>(part.match(/-?\d+(?:\.\d+)?/g)??[]).slice(0,6).map(Number));
  return {right:segments[0][4],left:segments[2][4],bottomX:segments[1][4],depth:segments[1][5]};
 };
 const still=curve(2,2),movingRight=curve(2,0),movingLeft=curve(2,4);
 expect(still).toEqual({right:204,left:156,bottomX:180,depth:55});
 expect(movingRight.left).toBeLessThan(still.left-30);
 expect(movingRight.right).toBe(still.right);
 expect(movingLeft.right).toBeGreaterThan(still.right+30);
 expect(movingLeft.left).toBe(still.left);
 expect(movingRight.depth).toBe(48);expect(movingLeft.depth).toBe(48);
 expect(movingRight.bottomX+movingLeft.bottomX).toBeCloseTo(360);
 expect(movingRight.left+movingLeft.right).toBeCloseTo(360);
});

test.each([240,313,361,760])('fractional retargets and resize remain finite and bounded at width %i',width=>{
 for(let head=0;head<=4;head+=.2)for(let tail=0;tail<=4;tail+=.2){
  const path=fluidTabPath(width,head,tail);
  expect(path).not.toMatch(/NaN|Infinity/);
  const values=(path.match(/-?\d+(?:\.\d+)?/g)??[]).map(Number);
  expect(values.every(value=>value>=0&&value<=Math.max(width,FLUID_TAB_HEIGHT))).toBe(true);
 }
});
