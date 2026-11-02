import {CodingTools as NativeCodingTools, createReadTool, type ImageProcessor, type createEditTool} from '@earendil-works/pi-durable/tools';

// Keep native read/path/model-limit semantics. Load the installed Photon worker
// only for images; it auto-orients/resizes without writing the original and
// releases its WASM memory after idle. Text reads never load the processor.
let imageProcessor: Promise<ImageProcessor> | undefined;
const imageRead = createReadTool({images:{
  async prepare(...args) {
    imageProcessor ??= import('@earendil-works/pi-durable/images/node').then(module=>module.createNodePhotonImages());
    return (await imageProcessor).prepare(...args);
  },
}});

type EditTool = ReturnType<typeof createEditTool>;

function rejectNoopEdits(tool: EditTool): EditTool {
  return {
    ...tool,
    async execute(args, api, context) {
      // Check the entire batch before native execution can access or write the file.
      // Keep Durable's argument preparation and all native matching/safety checks.
      if (Array.isArray(args.edits)) {
        const index = args.edits.findIndex(edit => typeof edit.oldText === 'string' && edit.oldText === edit.newText);
        if (index !== -1) {
          throw new Error(`Edit block ${index + 1} has identical oldText and newText. Remove it or provide a replacement that changes the text; no edits were applied.`);
        }
      }
      return tool.execute(args, api, context);
    },
  };
}

export const CodingTools: typeof NativeCodingTools = {
  ...NativeCodingTools,
  // Native registrations share a string name rather than a discriminated union.
  tools: NativeCodingTools.tools?.map(tool => tool.name === 'read' ? imageRead : tool.name === 'edit' ? rejectNoopEdits(tool as EditTool) : tool),
};
