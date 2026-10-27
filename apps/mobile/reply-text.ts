/** Copy replies, never serialized tool calls, hidden reasoning, or whitespace-only blocks. */
export function replyText(value:unknown):string {
 const text=typeof value==='string'?value:Array.isArray(value)?value
  .filter(block=>block?.type==='text'&&typeof block.text==='string')
  .map(block=>block.text).join('\n'):'';
 return text.trim()?text:'';
}
