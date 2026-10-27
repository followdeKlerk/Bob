import {emptyConversationMessage} from '../empty-conversation';
const loaded={ready:true,loading:false,page:{items:[]}};
test('a successfully loaded new conversation is an ordinary empty state',()=>{
 expect(emptyConversationMessage(loaded)).toBe('No messages yet.');
});
test('initial loading and refreshing are not reported as empty',()=>{
 expect(emptyConversationMessage({ready:false,loading:false})).toBe('Loading conversation…');
 expect(emptyConversationMessage({...loaded,loading:true})).toBe('Loading conversation…');
 expect(emptyConversationMessage({ready:true,loading:false})).toBe('Loading conversation…');
});
test('failure is left to the existing error and retry footer, not called an empty chat',()=>{
 expect(emptyConversationMessage({...loaded,error:'Offline'})).toBeUndefined();
 expect(emptyConversationMessage({ready:true,loading:false,error:'Offline'})).toBeUndefined();
});
