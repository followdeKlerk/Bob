import {CodingTools} from '@bob-local/coding';
import {CodemodeSandbox} from '@earendil-works/pi-codemode';
import {defineExtension,section} from '@earendil-works/pi-durable';
import {createCodemodeExtension} from '@earendil-works/pi-durable/codemode';

/** Host composition keeps existing coding-tools selections and native tool policy intact. */
export async function createCodingWithCodemode() {
 const sandbox=new CodemodeSandbox();
 try {
  // Use the Durable adapter, not sandbox.registerTool: nested calls must retain native
  // authorization, task identity, cancellation, replay receipts and result conversion.
  // Keep official model helpers enabled; their internal tools obey the same tools scope.
  const codemode=createCodemodeExtension({sandbox});
  const extension=defineExtension({
   ...CodingTools,
   tools:[...CodingTools.tools??[],...codemode.tools??[]],
   sections:[...CodingTools.sections??[],...codemode.sections??[],section('bob-codemode',({agent})=>
    agent.tools.some(tool=>tool.name==='codemode')
     ? 'Prefer codemode by default for suitable multi-step tool workflows; do not wait for the owner to request it. Use it for independent parallel calls, search-fetch-filter pipelines, pagination, loops, comparisons, calculations, reducing large intermediate results, and turning tool results into visuals. Use direct tools when simpler: a single straightforward call, image inspection, or a step requiring model judgement before deciding what to do next. Parallelize only independent operations; keep dependent steps ordered. Do not add unnecessary calls or force scripting where it provides no benefit. Scripts can call all conversation-enabled tools allowed by native caller policy, not just coding/read-only tools; existing consent and delegation rules still apply. Tools without an output schema return text, even when that text contains JSON: parse JSON text when needed. Structured bash results include exitCode: check it even when the promise resolves. Nested read image blocks are omitted from script values; use direct read to inspect images. Use image(block) to emit image data already available to a script.'
     : undefined)],
   tasks:[...CodingTools.tasks??[],...codemode.tasks??[]],
   hooks:[...CodingTools.hooks??[],...codemode.hooks??[]],
   wraps:[...CodingTools.wraps??[],...codemode.wraps??[]],
  });
  // 1.4.0's adapter uses built-in ToolTask and lazily creates its official v1
  // run/journal/store documents; there is no separate document registry to copy.
  return {extension,close:()=>sandbox.close()};
 } catch(error) {
  await sandbox.close().catch(()=>{});
  throw error;
 }
}
