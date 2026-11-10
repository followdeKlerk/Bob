export * from "@bob-local/core/contracts";
import {z} from 'zod';
import {CreateChat as CoreCreateChat} from '@bob-local/core/contracts';
/** Reject removed profiles rather than silently creating an unrestricted chat. */
export const CreateChat=CoreCreateChat.extend({profile:z.literal('normal').optional()});
