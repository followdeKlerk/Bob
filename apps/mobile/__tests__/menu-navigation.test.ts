import {menuDestination} from '../menu-navigation';
test('nested menus keep their originating bottom destination instead of always selecting Settings',()=>{
 expect(menuDestination('Schedules',['Sessions'])).toBe('Agents');
 expect(menuDestination('Schedules',['Settings'])).toBe('Settings');
 expect(menuDestination('Schedules',['Chat'])).toBe('Chat');
 expect(menuDestination('Modules',['Chat','Settings'])).toBe('Tools');
 expect(menuDestination('Modules',[])).toBe('Tools');
 expect(menuDestination('Connections',[])).toBe('Tools');
 expect(menuDestination('MCP Apps',['Settings'])).toBe('Tools');
 expect(menuDestination('Tools',['Chat'])).toBe('Tools');
 expect(menuDestination('Notes',['Settings'])).toBe('Notes');
});

 test('Settings submenus remain Settings even when opened directly from Chat',()=>{for(const page of ['Appearance','Conversation settings','Notifications','Voice','Phone & location','Connection','Storage & cache','App & updates','Advanced'])expect(menuDestination(page,['Chat'])).toBe('Settings');});

test('terminal is a root menu destination',()=>{expect(menuDestination('Terminal',['Chat'])).toBe('Terminal');});
