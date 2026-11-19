import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Tracks the active on-screen keyboard height across iOS and Android,
 * including inside native <Modal> windows where Android's windowSoftInputMode
 * and KeyboardAvoidingView are unreliable.
 */
export function useKeyboardHeight(enabled = true) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setKeyboardHeight(0);
      return;
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (event) => {
      const nextHeight = event?.endCoordinates?.height ?? 0;
      setKeyboardHeight(nextHeight);
    };

    const onHide = () => {
      setKeyboardHeight(0);
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [enabled]);

  return {
    keyboardHeight,
    isKeyboardVisible: keyboardHeight > 0,
  };
}

export default useKeyboardHeight;
