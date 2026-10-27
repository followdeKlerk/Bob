import {McpServer,InMemoryTransport} from '@modelcontextprotocol/server';
import {RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/app-bridge';
import {build} from 'esbuild';
import {z} from 'zod';

/** Real MCP SDK client/server transport; counter is test data, not an AI response. */
export async function createMcpFixture() {
  const bundle=await build({entryPoints:['test/mcp-fixture-app.ts'],bundle:true,minify:true,platform:'browser',format:'iife',write:false});
  const html=`<!doctype html><html><head><style>body{font:20px sans-serif;background:#101916;color:#edf4f0;padding:24px}button{font:20px sans-serif;padding:16px;background:#c8f9dd;color:#12251c;border:0;border-radius:12px}pre{white-space:pre-wrap}</style></head><body><h1>Real MCP App test</h1><p id="connection">Connecting…</p><p id="count">MCP counter: 0</p><button id="increment" disabled>Increase real MCP counter</button><pre id="error"></pre><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`;
  let counter=0;const servers=new Set<McpServer>();
  let pause: {started:()=>void;wait:Promise<void>}|undefined;
  return {
    html,
    get counter(){return counter;},
    holdNextIncrement(){let started!:()=>void,release!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;});pause={started,wait};return {started:began,release};},
    async transport(_id:string) {
      const server=new McpServer({name:'Bob test MCP server',version:'1.0.0'});servers.add(server);
      server.registerTool('show',{title:'Counter',inputSchema:z.object({}),_meta:{ui:{resourceUri:'ui://bob/counter',visibility:['model']}}},async()=>({content:[{type:'text',text:`Counter ${counter}`}],structuredContent:{count:counter}}));
      server.registerTool('increment',{inputSchema:z.object({amount:z.number().int().min(1).max(10)}),_meta:{ui:{visibility:['app']}}},async({amount})=>{const pending=pause;pause=undefined;if(pending){pending.started();await pending.wait;}counter+=amount;return {content:[{type:'text',text:`Counter ${counter}`}],structuredContent:{count:counter}};});
      server.registerResource('counter','ui://bob/counter',{mimeType:RESOURCE_MIME_TYPE},async()=>({contents:[{uri:'ui://bob/counter',mimeType:RESOURCE_MIME_TYPE,text:html}]}));
      const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();await server.connect(serverTransport);return clientTransport;
    },
    async close(){await Promise.all([...servers].map(server=>server.close()));},
  };
}
