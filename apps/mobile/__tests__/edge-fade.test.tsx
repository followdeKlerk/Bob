import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {View} from 'react-native';
import Svg,{LinearGradient,Stop} from 'react-native-svg';
import {EdgeFade} from '../components/edge-fade';
import {ThemeContext,tokens} from '../theme-context';

jest.mock('react-native-svg',()=>({__esModule:true,default:'Svg',Defs:'Defs',LinearGradient:'LinearGradient',Rect:'Rect',Stop:'Stop'}));

test.each(['light','dark'] as const)('%s fade matches its host surface; default top fade remains half strength and decoration passes through',async scheme=>{
 let tree!:Renderer.ReactTestRenderer;
 const render=(override?:string)=><ThemeContext.Provider value={tokens[scheme]}><View><EdgeFade edge="top" height={72}/><EdgeFade edge="bottom" height={140} color={override}/></View></ThemeContext.Provider>;
 await act(async()=>{tree=Renderer.create(render(tokens[scheme].colors.surface));});
 try{
  const [top,bottom]=tree.root.findAllByType(EdgeFade);
  expect(top.findByType(Svg).props.opacity).toBe(.5);
  expect(bottom.findByType(Svg).props.opacity).toBe(1);
  expect(top.findByType(LinearGradient).props).toMatchObject({y1:'0%',y2:'100%'});
  expect(bottom.findByType(LinearGradient).props).toMatchObject({y1:'100%',y2:'0%'});
  expect(top.findByType(LinearGradient).props.id).not.toBe(bottom.findByType(LinearGradient).props.id);
  for(const [fade,color] of [[top,tokens[scheme].colors.background],[bottom,tokens[scheme].colors.surface]] as const){
   const decoration=fade.findByType(View);
   expect(decoration.props).toMatchObject({pointerEvents:'none',accessible:false,importantForAccessibility:'no-hide-descendants'});
   expect(fade.findAllByType(Stop).map(stop=>[stop.props.offset,stop.props.stopOpacity,stop.props.stopColor])).toEqual([['0',1,color],['0.5',.94,color],['1',0,color]]);
  }
  await act(async()=>tree.update(render()));
  expect(tree.root.findAllByType(EdgeFade)[1].findAllByType(Stop).every(stop=>stop.props.stopColor===tokens[scheme].colors.background)).toBe(true);
 }finally{await act(async()=>tree.unmount());}
});
