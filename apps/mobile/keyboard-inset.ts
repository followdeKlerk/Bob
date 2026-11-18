import {useEffect, useState} from 'react';
import {DeviceEventEmitter, Dimensions, Keyboard, NativeModules, Platform} from 'react-native';

/**
 * Bottom inset, in dp, that the soft keyboard currently occupies.
 *
 * Android runs edge-to-edge, so the window is not resized for the keyboard and the native
 * IME inset is reported through BobKeyboard. iOS reports keyboard geometry directly.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'android') {
      let alive=true,eventReceived=false;
      const subscription = DeviceEventEmitter.addListener(
        'BobKeyboardInset',
        (event: {imeBottom?: number}) => {eventReceived=true;const value=event?.imeBottom;if(alive&&typeof value==='number'&&Number.isFinite(value))setInset(Math.max(0,value));},
      );
      const native = NativeModules.BobKeyboard;
      if (native?.enable) {
        void native.enable().then((value:unknown)=>{if(alive&&!eventReceived&&typeof value==='number'&&Number.isFinite(value))setInset(Math.max(0,value));}).catch(()=>{/* Keep the last known inset; failure is not a keyboard hide. */});
      }
      return () => {alive=false;subscription.remove();};
    }
    const show = Keyboard.addListener('keyboardWillShow', event => {
      const windowHeight = Dimensions.get('window').height;
      setInset(Math.max(0, windowHeight - event.endCoordinates.screenY));
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return inset;
}
