import {createInteractive as createRecordedInteractive} from '@bob-local/interactive';
import {defineExtension} from '@earendil-works/pi-durable';
import {readVisualData,visualDataSection,visualDataTool} from './visual-data.js';
import {createMcpTool,mcpToolsSection} from './mcp-tools.js';
export * from '@bob-local/interactive';

/** Add the data channel at the host boundary. The original surface document and
 * native MCP tasks stay byte-for-byte compatible with existing releases. */
export function createInteractive(...args:Parameters<typeof createRecordedInteractive>){
 const recorded=createRecordedInteractive(...args);
 return {...recorded,
  extension:defineExtension({...recorded.extension,tools:[...recorded.extension.tools??[],visualDataTool,createMcpTool(...args)],sections:[...recorded.extension.sections??[],visualDataSection,mcpToolsSection]}),
  async open(...input:Parameters<typeof recorded.open>){
   const opened=await recorded.open(...input);
   return opened.kind==='visual'?{...opened,visualData:await readVisualData(input[0],input[1],input[2])}:opened;
  },
  data:readVisualData,
 };
}
