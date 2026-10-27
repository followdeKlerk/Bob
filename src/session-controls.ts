import {defineDoc} from '@earendil-works/pi-durable';
/** Additive UI-only document, not a change to ChatMeta, task schemas, or SQLite.
 * Compatibility: older conversations have no snapshot (all flags are false).
 * First control write materializes version 1; older code ignores this independent
 * document and can still read every message. No history is deleted or rewritten.
 */
export const SessionUI=defineDoc<{pinned:boolean;archived:boolean;trashed:boolean}>({
 kind:'bob.session-ui',version:1,scope:'conversation',history:'latest',fork:'initial',
 initial:()=>({pinned:false,archived:false,trashed:false}),checkpointWhen:()=>true,
});
