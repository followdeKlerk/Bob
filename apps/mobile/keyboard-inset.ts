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
      const subscription = DeviceEventEmitter.addListener(
        'BobKeyboardInset',
        (event: {imeBottom?: number}) => setInset(Math.max(0, event?.imeBottom ?? 0)),
      );
      const native = NativeModules.BobKeyboard;
      if (native?.enable) {
        native.enable().catch(() => setInset(0));
      }
      return () => subscription.remove();
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
