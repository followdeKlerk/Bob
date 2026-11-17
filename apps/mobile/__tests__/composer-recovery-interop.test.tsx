import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Platform,StyleSheet} from 'react-native';
import {ThemeContext,tokens} from '../theme-context';

declare const __dirname:string; // This regression runs in Jest's Node module wrapper.

Platform.OS='android';
// Do not replace Button with Pressable: production px/py utilities can override
// shorthand inline padding and invalidate the fixed heading's geometry.
require('react-native-css-interop/dist/runtime/components');
const {ComposerStatusIndicator}=require('../components/composer-recovery');

beforeAll(()=>{
 // Isolate Lightning CSS's native CustomGC handle from the Jest runtime.
 // Generate real Android utilities rather than mocking Button or its padding.
 const script=`const fs=require('node:fs'),path=require('node:path');
 const config={...require('./tailwind.config.js'),content:[{raw:fs.readFileSync('components/ui/button.tsx','utf8'),extension:'tsx'}]};
 require('postcss')([require('tailwindcss')(config)]).process('@tailwind base; @tailwind components; @tailwind utilities;',{from:path.resolve('global.css')}).then(css=>{
 const compiled=require('react-native-css-interop/css-to-rn').cssToReactNativeRuntime(css.css,{inlineRem:14});
 process.stdout.write(JSON.stringify(compiled));
 }).catch(error=>{console.error(error);process.exitCode=1;});`;
 // Metro's installed NativeWind configuration uses its default inlineRem=14.
 const nodeProcess=require('node:process'),mobileRoot=require('node:path').join(__dirname,'..');
 const compiled=JSON.parse(require('node:child_process').execFileSync(nodeProcess.execPath,['-e',script],{cwd:mobileRoot,env:{...nodeProcess.env,NATIVEWIND_OS:'android'},encoding:'utf8',timeout:15000}));
 require('react-native-css-interop').StyleSheet.registerCompiled(compiled);
});

test.each(['light','dark'] as const)('real compiled status button fits its 48dp heading at 2x text in %s',async scheme=>{
 let tree:Renderer.ReactTestRenderer|undefined;
 try{
  await act(async()=>{tree=Renderer.create(<ThemeContext.Provider value={tokens[scheme]}><ComposerStatusIndicator notices={[{label:'Not saved',message:'Synthetic failed draft save'}]} onOpen={()=>{}}/></ThemeContext.Provider>);});
  const host=tree!.root.findAll(node=>typeof node.type==='string'&&node.props.accessibilityLabel==='Not saved. Open composer recovery')[0];
  const style=StyleSheet.flatten(host.props.style);
  const text=host.findAll(node=>typeof node.type==='string'&&StyleSheet.flatten(node.props.style)?.lineHeight===18)[0];
  const textStyle=StyleSheet.flatten(text.props.style);
  expect(style).toMatchObject({paddingTop:4,paddingBottom:4,paddingLeft:8,paddingRight:8,minHeight:48,minWidth:48});
  const minimumAt2x=textStyle.lineHeight*2+style.paddingTop+style.paddingBottom+2*style.borderWidth;
  expect(Math.max(style.minHeight,minimumAt2x)).toBeLessThanOrEqual(48);
  expect(textStyle.color).toBe(tokens[scheme].colors.foreground);
 }finally{await act(async()=>tree?.unmount());}
});
