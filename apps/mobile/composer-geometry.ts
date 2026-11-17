/** Shared by the editor, its actual App wrapper and the render regression fixture. DP, not text points. */
export function draftMetrics(fontScale:number,compact:boolean){
 const inline=compact&&fontScale<=1;
 const input=Math.max(48,Math.ceil(26*fontScale+20));
 return {input,controls:inline?0:52,minimum:inline?48:input+52,inline};
}
export function voicePanelMetrics(fontScale:number){
 return {phase:Math.ceil(36*fontScale)+8,actions:Math.max(48,Math.ceil(18*fontScale)+16)};
}
export type ComposerGeometryInput={height:number;keyboard:number;top:number;bottom:number;fontScale:number;heading?:number;attachments:boolean;voice:boolean;recovery:boolean;status?:boolean};
/** Reserve the ENTIRE minimum editor (including its separate 48dp control row),
 * heading, capsule chrome/gaps and essential audio controls BEFORE any previews.
 * Only previews/explanatory copy and the decorative avatar collapse under pressure. */
export function composerGeometry(input:ComposerGeometryInput){
 const {height,keyboard,top,bottom,fontScale,attachments,voice,recovery}=input;
 const compact=keyboard<=0,editor=draftMetrics(fontScale,compact),metrics=voicePanelMetrics(fontScale);
 const available=Math.max(0,height-Math.max(keyboard,bottom)-top);
 const audio=recovery||voice,essential=audio?metrics.phase+metrics.actions:0;
 const chrome=20+(compact?2:18),gap=compact?0:4;
 const naturalHeading=Math.max(76,input.heading??0);
 const naturalSlots=1+(audio?1:0)+(attachments?1:0);
 const natural=naturalHeading+chrome+gap*(naturalSlots-1)+editor.minimum+essential+(attachments?136:0);
 // Essential notices use the same compact lane while the keyboard is present,
 // including after opening their recovery surface has retired Voice Chat.
 const constrained=(audio||!!input.status)&&(natural>available||!!input.status&&keyboard>0);
 const heading=constrained?48:naturalHeading;
 const attachmentHeight=attachments&&!constrained?136:0;
 const slots=1+(audio?1:0)+(attachments?1:0);
 const reserved=heading+chrome+gap*(slots-1)+editor.minimum+essential+attachmentHeight;
 let remaining=Math.max(0,available-reserved);
 const editorExtra=editor.inline?0:Math.min(Math.max(0,156-editor.input),remaining);
 remaining-=editorExtra;
 const optionalSpace=Math.min(Math.max(0,280-essential),remaining);
 // Do not expose an unreadable sliver of a provider/partial line.
 const optional=optionalSpace>=Math.ceil(18*fontScale)+4?optionalSpace:0;
 return {available,constrained,heading,attachmentHeight,draftMax:editor.inline?48:editor.input+editorExtra,
  voiceMax:voice&&!recovery?essential+optional:0,recoveryMax:recovery?essential+optional:0,
  reserved,maximum:reserved+editorExtra+(audio?optional:0)};
}
