import {INITIAL_INLINE_HEIGHT,MAX_INLINE_HEIGHT} from './inline-visual-policy';

/** Advertise the new request format only to a backend that understands it.
 * Missing/unknown capability keeps older paired backends usable. This is UI
 * metadata, never a native action grant or permission to exceed the local guard. */
export function visualDisplayHeight(capability:unknown):number{
 return capability!==null&&typeof capability==='object'&&!Array.isArray(capability)
  &&(capability as {inlineHeight?:unknown}).inlineHeight===MAX_INLINE_HEIGHT
  ?MAX_INLINE_HEIGHT:INITIAL_INLINE_HEIGHT;
}
