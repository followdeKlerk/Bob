/**
 * @format
 */

import { AppRegistry } from 'react-native';
import {installJsFaultCapture} from './js-fault';
import { name as appName } from './app.json';

installJsFaultCapture();
// Install before loading the application, so startup failures are observable too.
const App = require('./App').default;
AppRegistry.registerComponent(appName, () => App);
