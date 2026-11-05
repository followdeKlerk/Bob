import type {Context} from '@earendil-works/chord';
import type {Conversation, ConversationView, EntryId, EntryRecord} from '@earendil-works/pi-durable';

/** Pi 1.4 clients expect the active context, not Pi 1.5's bounded history window.
 * Keep the captured native documents/conversation, but expand entries at that
 * revision's tail (never at the possibly newer current context). One projector
 * belongs to one GET/SSE connection; document-only updates reuse its last read.
 */
export function createConversationProjection(chat: Pick<Conversation, 'context'>, context: Context) {
  let cached: {tail: EntryId; entries: Promise<readonly EntryRecord[]>} | undefined;
  return async (value: ConversationView): Promise<Omit<ConversationView, 'before'>> => {
    const {before: _before, ...view} = value;
    const tail = value.entries.at(-1)?.id ?? value.before;
    // An empty captured transcript must stay empty even if a commit races us.
    if (tail === undefined) return {...view, entries: []};
    if (cached?.tail !== tail) {
      cached = {tail, entries: chat.context(context, {at: tail}).then(view => view.entries)};
    }
    return {...view, entries: await cached.entries};
  };
}
