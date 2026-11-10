/** Only the video surface and Android seek target have a native height. All labels,
 * status and buttons live in React's natural layout, including at large font scales. */
export function inlineMediaSizing(_fontScale:number,width:number,video:boolean) {
 const safeWidth=Number.isFinite(width)&&width>0?width:288;
 const videoHeight=video?Math.max(120,Math.round(safeWidth*9/16)):0;
 const seekHeight=48;
 return {videoHeight,seekHeight,height:videoHeight+seekHeight};
}
