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
