import {cleanWorkstationAlias,workstationLabel} from '../workstation-label';
const a={backendId:'aaaa-1',name:'desktop.tail1234.ts.net'},b={backendId:'bbbb-2',name:'laptop.tail1234.ts.net'};
test('aliases are short local display names, with a compact original-name fallback',()=>{
 expect(workstationLabel(a)).toBe('desktop');expect(workstationLabel({...a,alias:'Desk'})).toBe('Desk');
 expect(cleanWorkstationAlias('  Home\n PC \u202e ')).toBe('Home PC');expect(cleanWorkstationAlias('')).toBe('');
 expect(()=>cleanWorkstationAlias('x'.repeat(25))).toThrow('24 characters');
 expect(cleanWorkstationAlias('😀'.repeat(24))).toBe('😀'.repeat(24));
 expect(workstationLabel({...a,alias:'x'.repeat(25)})).toBe('Workstation');
 expect(a.name).toBe('desktop.tail1234.ts.net');
});
test('duplicate aliases cannot silently make two workstations indistinguishable',()=>{
 const one={...a,alias:'PC'},two={...b,alias:'pc'};
 expect(workstationLabel(one,[one,two])).toBe('PC · aaaa');expect(workstationLabel(two,[one,two])).toBe('pc · bbbb');
});
