/** App chrome shares the existing foreground/accessibility motion policy.
 * Nested chat providers can still suspend transcript motion independently. */
export {ChatMotionProvider as AppMotionProvider,useChatMotion as useAppMotion} from './chat-motion';

export const APP_MOTION={enter:180,press:70,release:130,distance:8,pressedOpacity:.74} as const;
