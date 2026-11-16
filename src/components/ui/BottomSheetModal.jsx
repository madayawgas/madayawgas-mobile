import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Animated,
  Easing,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';

const SLIDE_OFFSET = 320;

/**
 * Reusable bottom-sheet modal with a native-fading dark backdrop
 * and a smoothly sliding sheet container.
 */
const BottomSheetModal = ({
  visible,
  onClose,
  children,
  dismissible = true,
  avoidKeyboard = false,
  backdropOpacity = 0.6,
  maxHeight = '90%',
}) => {
  const slideAnim = useRef(new Animated.Value(SLIDE_OFFSET)).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(SLIDE_OFFSET);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  const sheetContent = (
    <Animated.View
      collapsable={false}
      style={{
        width: '100%',
        maxHeight,
        transform: [{ translateY: slideAnim }],
      }}
    >
      {children}
    </Animated.View>
  );

  return (
    <Modal
      visible={Boolean(visible)}
      transparent={true}
      animationType="fade"
      statusBarTranslucent={true}
      onRequestClose={dismissible ? onClose : undefined}
    >
      <View
        style={[
          styles.backdrop,
          { backgroundColor: `rgba(0, 0, 0, ${backdropOpacity})` },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={dismissible ? onClose : undefined}
        />

        {avoidKeyboard ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.sheetContainer}
            pointerEvents="box-none"
          >
            {sheetContent}
          </KeyboardAvoidingView>
        ) : (
          <View style={styles.sheetContainer} pointerEvents="box-none">
            {sheetContent}
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
});

export default BottomSheetModal;
