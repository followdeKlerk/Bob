const path=require('path');
const {getDefaultConfig,mergeConfig}=require('@react-native/metro-config');
module.exports=mergeConfig(getDefaultConfig(__dirname),{
 watchFolders:[path.resolve(__dirname,'../../../..')],
 maxWorkers:2,
 resolver:{
  nodeModulesPaths:[path.resolve(__dirname,'../../node_modules'),path.resolve(__dirname,'../../../../node_modules')],
  resolveRequest(context,name,platform){
   if(name==='react-native-keychain'||name==='lucide-react-native'||name==='./message-actions'&&context.originModulePath.endsWith('inline-surface.tsx'))return {type:'sourceFile',filePath:path.join(__dirname,'probe-mocks.js')};
   return context.resolveRequest(context,name,platform);
  },
 },
 transformer:{enableBabelRCLookup:false},
});
