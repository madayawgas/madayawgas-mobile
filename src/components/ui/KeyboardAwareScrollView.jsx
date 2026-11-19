import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

/**
 * Cross-platform keyboard-aware scrollable form container.
 * Uses KeyboardAvoidingView on iOS and explicit keyboard-height bottom padding
 * on Android so inputs and submit actions remain reachable under edge-to-edge layouts.
 */
const KeyboardAwareScrollView = ({
  children,
  className = 'flex-1 bg-white',
  contentContainerStyle,
  extraBottomPadding = 24,
  scrollRef,
  ...scrollViewProps
}) => {
  const { keyboardHeight } = useKeyboardHeight();
  const insets = useSafeAreaInsets();

  const baseBottomPadding =
    contentContainerStyle && typeof contentContainerStyle.paddingBottom === 'number'
      ? contentContainerStyle.paddingBottom
      : extraBottomPadding;

  const androidKeyboardPadding =
    Platform.OS === 'android' && keyboardHeight > 0
      ? Math.max(0, keyboardHeight - insets.bottom) + extraBottomPadding
      : baseBottomPadding;

  const mergedContentStyle = [
    contentContainerStyle,
    Platform.OS === 'android'
      ? { paddingBottom: androidKeyboardPadding }
      : { paddingBottom: baseBottomPadding },
  ];

  const scrollNode = (
    <ScrollView
      ref={scrollRef}
      className={className}
      bounces={false}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      contentContainerStyle={mergedContentStyle}
      {...scrollViewProps}
    >
      {children}
    </ScrollView>
  );

  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        {scrollNode}
      </KeyboardAvoidingView>
    );
  }

  return <View className="flex-1">{scrollNode}</View>;
};

export default KeyboardAwareScrollView;
