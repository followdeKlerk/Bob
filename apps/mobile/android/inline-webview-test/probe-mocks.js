// Test-only credential and icon chrome adapters. Native prepare, HTTP transport,
// Fabric component, device events, and production InlineSurface are NOT mocked.
const React=require('react');
const {View,Pressable,Text}=require('react-native');
exports.getGenericPassword=async()=>({password:'no-credentials'});
exports.Maximize2=()=>null;
exports.ActionRow=({children})=>React.createElement(View,{style:{flexDirection:'row',alignItems:'center',marginTop:4}},children);
exports.ActionIcon=({label,onPress})=>React.createElement(Pressable,{accessibilityLabel:label,onPress,style:{width:44,height:44}},React.createElement(Text,null,'↗'));
