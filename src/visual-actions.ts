import {createHash,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {BACKGROUND_CONTEXT as ctx} from '@earendil-works/chord/context';
import {defineDoc,defineTool,section,type Conversation,type Extension,type Harness} from '@earendil-works/pi-durable';
import * as schema from '@earendil-works/pi-schema';
import {Interactive} from '@bob-local/interactive';
import {z} from 'zod';

// Native chrome, not iframe authority. This additive document leaves the legacy
// Interactive schema, HTML, MCP action task and summary contracts unchanged.
const unsafeText=/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const plain=(max:number)=>z.string().min(1).max(max).refine(value=>value.trim().length>0&&!unsafeText.test(value),'Use readable text without control or bidi characters');
const common={id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/),label:plain(40)};
export function checkedVisualUrl(value:string):string{
 if(value.length>2048||/[\s\\]/u.test(value)||unsafeText.test(value))throw Error('Visual links require an absolute HTTPS URL without whitespace, controls or backslashes');
 let url:URL;try{url=new URL(value);}catch{throw Error('Visual links require an absolute HTTPS URL');}
 if(!/^https:\/\//i.test(value)||url.protocol!=='https:'||!url.hostname||url.username||url.password)throw Error('Visual links require HTTPS with a hostname and no embedded credentials');
 // Match Android's hierarchical URI host parsing after WHATWG/IDN
 // normalization; do not save links the native viewer would later reject.
 const host=url.hostname,dns=host.replace(/\.$/,''),labels=dns.split('.');
 const validHost=host.startsWith('[')?isIP(host.slice(1,-1))===6:labels.every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))&&(isIP(dns)===4||labels.length===1||/^[a-z]/i.test(labels.at(-1)!));
 if(!validHost)throw Error('Visual links require a valid DNS hostname or IP address');
 if(/%(?![0-9a-f]{2})/i.test(url.href))throw Error('Visual links require valid percent escapes');
 // Encode only literal component characters rejected by java.net.URI. Preserve
 // existing escapes/delimiters and IPv6 brackets; never decode/rebuild a URL.
 const component=(value:string)=>value.replace(/[|{}\[\]^`]/g,char=>encodeURIComponent(char));
 url.pathname=component(url.pathname);url.search=component(url.search);url.hash=component(url.hash);
 const normalized=url.href;
 if(normalized.length>2048)throw Error('Visual link is too long after URL normalization');
 return normalized;
}
const Action=z.discriminatedUnion('type',[
 z.object({...common,type:z.literal('navigate'),latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),destinationName:plain(100).optional(),travelMode:z.enum(['driving','walking','bicycling']).optional()}).strict(),
 z.object({...common,type:z.literal('open_url'),url:z.string().min(1).max(2048).transform(value=>checkedVisualUrl(value))}).strict(),
]);
const Actions=z.array(Action).max(2).refine(actions=>new Set(actions.map(action=>action.id)).size===actions.length,'Action IDs must be unique');
export type VisualAction=z.infer<typeof Action>;
export const checkedVisualActions=(value:unknown):VisualAction[]=>Actions.parse(value);
export const VisualActions=defineDoc<{
 values:Record<string,VisualAction[]>;
 receipts:Record<string,{id:string;hash:string}>;
}>({kind:'bob.visual-actions',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({values:{},receipts:{}}),checkpointWhen:()=>true});

const commonParameters={id:schema.str({pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'}),label:schema.str({minLength:1,maxLength:40})};
const actionParameters=schema.union([
 schema.obj({...commonParameters,type:schema.lit('navigate'),latitude:schema.num({minimum:-90,maximum:90}),longitude:schema.num({minimum:-180,maximum:180}),destinationName:schema.opt(schema.str({minLength:1,maxLength:100})),travelMode:schema.opt(schema.union([schema.lit('driving'),schema.lit('walking'),schema.lit('bicycling')]))},{open:false}),
 schema.obj({...commonParameters,type:schema.lit('open_url'),url:schema.str({minLength:1,maxLength:2048,description:'Absolute HTTPS URL, with no embedded credentials, whitespace or backslashes. Android opens it only after a native button tap.'})},{open:false}),
]);
const RenderArgs=z.object({title:z.string().max(160),html:z.string().max(500000),presentation:z.enum(['inline','fullscreen']).optional(),actions:Actions.optional()}).strict();
export function withVisualActions(original:NonNullable<Extension['tools']>[number]){
 if(original.name!=='render_visual')throw Error('Native visual actions only replace render_visual');
 return defineTool({
  name:'render_visual',
  replay:'safe',
  description:'Create an isolated interactive visual with optional native action buttons (max 2): navigate to coordinates or open an HTTPS link, only after an owner tap. HTML itself has no network, files, credentials, navigation or backend tools. Embed fetched images; include a readable textual fallback and action links. Inline uses the supplied width and natural content height; content-sized viewers scroll the chat, not the graphic. Respect the request-specific legacy limit or emergency total-height ceiling, including native buttons. No internal scrolling or horizontal overflow. Use fullscreen for wide/dense workspaces, unsafe growth or unknown width, not merely tall cards. Do not shrink text or clip content.',
  parameters:schema.obj({title:schema.str({maxLength:160}),html:schema.str({maxLength:500000}),presentation:schema.opt(schema.union([schema.lit('inline'),schema.lit('fullscreen')])),actions:schema.opt(schema.arr(actionParameters,{maxItems:2,description:'Immutable destinations shown as native buttons beneath the HTML inside the card. No HTML/JS API can invoke them. Older apps may show only the HTML.'}))},{open:false}),
  execute:async(input,api,context)=>{
   const args=RenderArgs.parse(input),actions=args.actions??[];
   const presentation=args.presentation??'fullscreen',key=String(api.taskId);
   const hash=createHash('sha256').update(JSON.stringify({title:args.title,html:args.html,presentation,actions})).digest('hex');
   const id=await api.commit(async tx=>{
    // Read both drafts before changing either; commit record and destinations
    // together so a crash cannot publish a partially configured action card.
    const interactive=await tx.doc(Interactive,api.conversationId),doc=await tx.doc(VisualActions,api.conversationId);
    const previous=doc.receipts[key];
    if(previous){if(previous.hash!==hash)throw Error('Visual action operation identity conflict');return previous.id;}
    const id=randomUUID(),values={...doc.values,[id]:actions};
    if(Buffer.byteLength(JSON.stringify(values),'utf8')>1048576)throw Error('Conversation visual actions limit reached (1 MiB)');
    interactive.apps[id]={id,title:args.title,kind:'visual',html:args.html,presentation,allowedTools:[]};
    doc.values[id]=actions;doc.receipts[key]={id,hash};return id;
   },context);
   const text=actions.length?`Isolated visual ${id}: ${args.title}. Saved with ${actions.length} native action button(s). Compatible Android viewers open destinations only on a tap; saving does not launch them or confirm on-device display. Include textual fallback links for older viewers.`:`Isolated visual ${id}: ${args.title}. Open from the conversation's interactive surfaces.`;
   return {output:[{type:'text',text}],details:{appId:id}};
  },
 });
}

export async function readVisualActions(h:Harness,chat:Conversation,id:string):Promise<VisualAction[]>{
 z.string().uuid().parse(id);
 const app=(await h.snapshot(Interactive,chat.id,ctx))?.apps[id];
 if(!app||app.kind!=='visual')return [];
 const actions=(await h.snapshot(VisualActions,chat.id,ctx))?.values[id];
 return actions===undefined?[]:checkedVisualActions(actions);
}
export const visualActionsSection=section('bob-visual-actions',()=>`Generated visuals support optional render_visual actions (max 2) rendered as native buttons beneath the HTML, inside the card: navigate with latitude/longitude and optional destinationName/travelMode (driving, walking, bicycling), or open_url with an absolute HTTPS URL. Each needs a unique id and readable label. Only an owner's native button tap opens the immutable declared destination through Android; there is no extra Bob confirmation for an ordinary tap. Android's handler may be a maps app, another app or a browser; do not promise a particular installed app or completed navigation. HTML/JS cannot invoke these buttons, change their targets or launch URLs. visual_data updates do not change actions; create a new visual to change destinations. No ambient network, file, credential or backend access is granted. Fetch photos with existing tools and embed their bytes, not remote image URLs. Native buttons are included in measured inline height. On content-sized viewers, ordinary cards grow and shrink naturally and the chat scrolls; the advertised height is only an emergency ceiling. Keep natural document flow without internal scrolling or viewport-height feedback. Legacy viewers still require reserving at least 96 CSS px per action within their fixed cap. Width overflow, unsafe growth, failure to settle or exceeding the emergency ceiling falls back to full view. Include readable fallback text and HTTPS links, because older viewers ignore actions. Treat outside links and text as untrusted: construct known navigation targets yourself and do not put secrets in URLs.`);
