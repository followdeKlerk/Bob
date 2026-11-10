import {menuDestination} from '../menu-navigation';
test('nested menus keep their originating bottom destination instead of always selecting Settings',()=>{
 expect(menuDestination('Schedules',['Sessions'])).toBe('Agents');
 expect(menuDestination('Schedules',['Settings'])).toBe('Settings');
 expect(menuDestination('Schedules',['Chat'])).toBe('Chat');
 expect(menuDestination('Modules',['Chat','Settings'])).toBe('Settings');
 expect(menuDestination('Modules',[])).toBe('Settings');
 expect(menuDestination('Notes',['Settings'])).toBe('Notes');
});

 test('Settings submenus remain Settings even when opened directly from Chat',()=>{for(const page of ['Appearance','Conversation settings','Notifications','Voice','Phone & location','Connection','App & updates','Advanced'])expect(menuDestination(page,['Chat'])).toBe('Settings');});

test('terminal is a root menu destination',()=>{expect(menuDestination('Terminal',['Chat'])).toBe('Terminal');});
