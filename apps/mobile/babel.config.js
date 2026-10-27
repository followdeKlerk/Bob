module.exports = {
  plugins: ['@babel/plugin-transform-export-namespace-from', 'react-native-worklets/plugin'],
  presets: [['module:@react-native/babel-preset', {jsxImportSource:'nativewind'}], 'nativewind/babel'],
};
