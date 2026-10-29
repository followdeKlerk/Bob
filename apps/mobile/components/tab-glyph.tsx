import React from 'react';
import {Circle,G,Path,Rect} from 'react-native-svg';

// Lucide 1.61.0 glyph geometry; see tab-glyph.LICENSE for ISC/MIT notices.
// Render SVG primitives,
// not Lucide's nested <Svg> view roots: Android does not position those roots
// using SVG x/y attributes, which stacked every tab at the origin.
export type TabGlyphName='Notes'|'Workstations'|'Chat'|'Sessions'|'Settings';
export function TabGlyph({name,x,y,color}:{name:TabGlyphName;x:number;y:number;color:string}){
 return <G testID={`tab-glyph-${name}`} transform={`translate(${x} ${y})`} fill="none" stroke={color} strokeWidth={name==='Chat'?2.1:1.9} strokeLinecap="round" strokeLinejoin="round">
  {name==='Notes'&&<><Path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><Path d="M15 3v5a1 1 0 0 0 1 1h5"/></>}
  {name==='Workstations'&&<><Rect x={2} y={3} width={20} height={14} rx={2}/><Path d="M8 21h8 M12 17v4"/></>}
  {name==='Chat'&&<Path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>}
  {name==='Sessions'&&<><Path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><Path d="M3 3v5h5 M12 7v5l4 2"/></>}
  {name==='Settings'&&<><Path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><Circle cx={12} cy={12} r={3}/></>}
 </G>;
}
