const React=require('react');
const {AppRegistry,DeviceEventEmitter,NativeModules,FlatList,ScrollView,View}=require('react-native');
const {InlineSurface}=require('../../components/inline-surface');
for(const name of ['BobSurfaceLayout','BobSurfaceOverflow'])DeviceEventEmitter.addListener(name,event=>NativeModules.InlineProbe.record(name,JSON.stringify(event)));
function Probe({fixtures,inverted}){
 const values=JSON.parse(fixtures);
 const card=({item})=>React.createElement(InlineSurface,{backend:item.backend,surface:item.surface,onExpand:()=>{}});
 return React.createElement(View,{style:{flex:1,paddingTop:45,backgroundColor:'#303030'}},
  inverted?React.createElement(FlatList,{inverted:true,style:{width:313},data:values,keyExtractor:item=>item.surface.id,renderItem:card}):
  React.createElement(ScrollView,{style:{width:313}},values.map(item=>React.createElement(View,{key:item.surface.id},card({item})))));
}
AppRegistry.registerComponent('InlineReactProbe',()=>Probe);
