import { z } from "zod";
export const protocol = 1 as const;
export const HistoryAccess=z.object({read:z.array(z.number().int().positive().safe()).max(1000)}).strict();
export const PeerConnection=z.object({id:z.string().uuid(),name:z.string().min(1).max(100),endpoint:z.string().url(),read:z.array(z.number().int().positive()).max(1000),message:z.array(z.number().int().positive()).max(1000),enabled:z.boolean(),devLoopback:z.boolean(),allConversations:z.boolean().optional(),ownerDeviceId:z.string().uuid().optional(),authorizationExpired:z.boolean().optional()}).strict();
export const PeerOverview=z.object({inbound:z.array(z.object({peerId:z.string().uuid(),name:z.string(),read:z.array(z.number().int().positive()),message:z.array(z.number().int().positive()),revoked:z.boolean(),allConversations:z.boolean().optional(),authorizationExpired:z.boolean().optional()}).strict()),outbound:z.array(PeerConnection)}).strict();
export const HistoryPage=z.object({backendId:z.string().uuid(),conversationId:z.number().int().positive(),coverage:z.literal('stored-entries'),items:z.array(z.object({id:z.number().int().positive(),kind:z.string(),data:z.unknown().optional(),model:z.array(z.object({role:z.string(),content:z.unknown()}).passthrough()).optional()}).passthrough()),next:z.string().max(4096).optional()}).strict();
export const ModuleSelection=z.object({ids:z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).max(32)}).strict();
export const ModuleInfo=z.object({id:z.string(),name:z.string(),packageName:z.string(),version:z.string(),durable:z.string(),dependencies:z.record(z.string(),z.string()),requires:z.array(z.string()),available:z.boolean(),installed:z.boolean(),registered:z.boolean(),defaultSelected:z.boolean(),selected:z.boolean().optional()}).strict();
export const NativeWork = z.object({id:z.number().int().positive(),kind:z.string(),background:z.boolean(),abortRequested:z.boolean(),state:z.enum(['running','ready','waiting','sleeping','completing','blocked'])}).strict();
export const McpConnection = z.object({
  id:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), endpoint:z.string().url(),
  allowedTools:z.array(z.string().min(1).max(200)).min(1).max(100), enabled:z.boolean(),
}).strict();
export const InteractiveSummary = z.object({
  id: z.string().uuid(), conversationId: z.number().int().positive(), title: z.string(),
  presentation: z.enum(['inline','fullscreen']).optional(),
  kind: z.enum(['visual', 'mcp']), allowedTools: z.array(z.string()), serverId: z.string().optional(), resourceUri: z.string().optional(),
}).strict();
export const Attachment = z.object({
  id: z.string().uuid(), conversationId: z.number().int().positive(),
  name: z.string().min(1).max(255), mime: z.string(),
  size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const TransferLimits = z.object({ uploadLimit: z.number().int().min(1024).max(1073741824) }).strict();
export const Id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9:_-]+$/);
export const Model = z
  .object({
    provider: z.string().min(1).max(80),
    modelId: z.string().min(1).max(160),
  })
  .strict();
export const CreateChat = z
  .object({
    title: z.string().max(160),
    cwd: z.string().max(4096).optional(),
    model: Model.optional(),
    instructions: z.string().max(32000).optional(),
  })
  .strict();
export const Message = z
  .object({
    requestId: z.string().uuid(),
    questionId: z.string().min(1).max(256).optional(),
    text: z.string().min(1).max(200000),
    mode: z.enum(["steer", "followUp"]),
    display: z.object({inline:z.object({width:z.number().int().min(1).max(10000),height:z.literal(420)}).strict(),fullscreen:z.object({width:z.number().int().min(1).max(10000),height:z.number().int().min(1).max(10000)}).strict()}).strict().optional(),
    allowSubagents: z.boolean().default(false),
  })
  .strict();
export const Stop = z.object({ scope: z.enum(["root", "tree"]) }).strict();
export const Pair = z
  .object({
    backendId: z.string().uuid(),
    invitation: z.string().min(32).max(128),
    name: z.string().min(1).max(100),
  })
  .strict();
export const Configure = z
  .object({
    model: Model.optional(),
    thinkingLevel: z.enum(["off","minimal","low","medium","high","xhigh","max"]).optional(),
    instructions: z.string().max(32000).nullable().optional(),
    cwd: z.string().max(4096).optional(),
  })
  .strict();
export const Skill = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    description: z.string().max(500),
    markdown: z.string().max(128000),
    enabled: z.boolean(),
  })
  .strict();
export type MessageRequest = z.infer<typeof Message>;
export const PairingInvitation = z
  .object({
    protocol: z.literal(1),
    backendId: z.string().uuid(),
    endpoint: z.string().url(),
    invitation: z.string().min(32).max(128),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type Pairing = {
  protocol: 1;
  backendId: string;
  endpoint: string;
  invitation: string;
  expiresAt: number;
};
