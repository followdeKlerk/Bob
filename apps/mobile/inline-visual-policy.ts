// CSS pixels (native dp). Loading is provisional; measured content owns row height.
export const INITIAL_INLINE_HEIGHT = 420;
// Emergency total budget for the HTML document plus its measured native actions.
export const MAX_INLINE_HEIGHT = 8192;

// Virtualized chat rows remount. Retain only a bounded provisional total height,
// never a native session, credentials, HTML or data. Width/font changes are safe:
// the normal isolated-host handshake must remeasure before revealing content.
type HeightScope = {backendId:string;conversationId:number;id:string};
const measuredHeights = new Map<string,number>();
const MAX_REMEMBERED_HEIGHTS = 64;
const heightKey = (scope:HeightScope) => JSON.stringify([scope.backendId,scope.conversationId,scope.id]);
export function initialInlineHeight(scope:HeightScope):number {
 const key=heightKey(scope),height=measuredHeights.get(key);
 if(height===undefined)return INITIAL_INLINE_HEIGHT;
 measuredHeights.delete(key);measuredHeights.set(key,height);
 return height;
}
export function rememberInlineHeight(scope:HeightScope,height:number):void {
 if(!Number.isInteger(height)||height<1||height>MAX_INLINE_HEIGHT)return;
 const key=heightKey(scope);measuredHeights.delete(key);measuredHeights.set(key,height);
 if(measuredHeights.size>MAX_REMEMBERED_HEIGHTS)measuredHeights.delete(measuredHeights.keys().next().value!);
}
export function forgetInlineHeight(scope:HeightScope):void { measuredHeights.delete(heightKey(scope)); }
