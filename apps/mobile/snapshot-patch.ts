/** Connection-local read-model splice. Never applied to persisted history or a
 * mutation. Any gap/malformed range requires a fresh authoritative GET stream. */
export function applySnapshotPatch(previous:string|undefined,sequence:number,raw:string):{json:string;sequence:number}{
 const patch=JSON.parse(raw);
 if(!previous||!patch||typeof patch!=='object'||Array.isArray(patch)||
  ![patch.base,patch.sequence,patch.prefix,patch.remove,patch.length].every(value=>Number.isSafeInteger(value)&&value>=0)||
  patch.base!==sequence||patch.sequence!==sequence+1||patch.length!==previous.length||
  patch.prefix>previous.length||patch.remove>previous.length-patch.prefix||typeof patch.insert!=='string')throw Error('Invalid snapshot patch; reconnect required');
 return {json:previous.slice(0,patch.prefix)+patch.insert+previous.slice(patch.prefix+patch.remove),sequence:patch.sequence};
}
