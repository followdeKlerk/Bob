import {menuDestination} from '../menu-navigation';
test('nested menus keep their originating bottom destination instead of always selecting Settings',()=>{
 expect(menuDestination('Schedules',['Sessions'])).toBe('Sessions');
 expect(menuDestination('Schedules',['Settings'])).toBe('Settings');
 expect(menuDestination('Schedules',['Chat'])).toBe('Chat');
 expect(menuDestination('Modules',['Chat','Settings'])).toBe('Settings');
 expect(menuDestination('Modules',[])).toBe('Settings');
 expect(menuDestination('Notes',['Settings'])).toBe('Notes');
});
