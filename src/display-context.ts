import {INLINE_VISUAL_EMERGENCY_HEIGHT} from '@bob-local/core/contracts';
export {INLINE_VISUAL_EMERGENCY_HEIGHT};

type Display={inline:{width:number;height:number};fullscreen:{width:number;height:number}};
/** Request-scoped viewer evidence, not a global assumption about old clients. */
export function displayContext(display:Display):string{
 const rules=display.inline.height===INLINE_VISUAL_EMERGENCY_HEIGHT
  ? `Inline width is fixed to ${display.inline.width} CSS pixels, but height grows and shrinks naturally with the content; the CHAT scrolls, not an internal graphic region. The inline height value ${INLINE_VISUAL_EMERGENCY_HEIGHT} is an emergency total-height ceiling including native action buttons, not a target size or a normal card cap. Ordinary tall cards should stay inline. Use natural document flow; avoid height:100vh/100% and viewport-dependent height feedback. No horizontal overflow, nested scrolling, clipping or text shrinking. Fullscreen is for wide/dense workspaces, unsafe growth or uncertain width—not simply because a card is taller than one screen.`
  : 'This viewer has a legacy fixed inline height limit. Inline must fit completely within the supplied width and height, including native action buttons, without internal scrolling. Use inline only for content that fits; choose fullscreen for taller content or uncertain fit.';
 return `[Bob display context for this request: CSS-pixel layout bounds ${JSON.stringify(display)}. ${rules} No page headings or introductory prose that consume the visual. Fullscreen opens on user tap, not automatically. Keep typography readable. Use responsive layouts; width may change before opening.]`;
}
