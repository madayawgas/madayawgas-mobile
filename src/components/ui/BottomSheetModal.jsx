import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Animated,
  Easing,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  PanResponder,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

const SLIDE_OFFSET = 320;

/**
 * Reusable bottom-sheet modal with a native-fading dark backdrop,
 * draggable top handle (drag up to expand full height, drag down to collapse/dismiss),
 * and cross-platform keyboard avoidance.
 */
const BottomSheetModal = ({
  visible,
  onClose,
  children,
  dismissible = true,
  avoidKeyboard = true,
  backdropOpacity = 0.6,
  maxHeight = '90%',
  showHandle = true,
  expandable = true,
}) => {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { keyboardHeight } = useKeyboardHeight(Boolean(visible) && avoidKeyboard);

  const [isExpanded, setIsExpanded] = useState(false);
  const slideAnim = useRef(new Animated.Value(SLIDE_OFFSET)).current;

  const isExpandedRef = useRef(false);
  const dismissibleRef = useRef(dismissible);
  const expandableRef = useRef(expandable);
  const onCloseRef = useRef(onClose);

  isExpandedRef.current = isExpanded;
  dismissibleRef.current = dismissible;
  expandableRef.current = expandable;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (visible) {
      setIsExpanded(false);
      slideAnim.setValue(SLIDE_OFFSET);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      setIsExpanded(false);
    }
  }, [visible, slideAnim]);

  const springBack = () => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 70,
      friction: 11,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 4,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          // Dragging down
          if (isExpandedRef.current || dismissibleRef.current) {
            slideAnim.setValue(gestureState.dy);
          }
        } else if (gestureState.dy < 0 && expandableRef.current && !isExpandedRef.current) {
          // Slight upward rubber-band feedback before expanding
          slideAnim.setValue(Math.max(-28, gestureState.dy * 0.35));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const isSwipeUp = gestureState.dy < -40 || gestureState.vy < -0.5;
        const isSwipeDown = gestureState.dy > 50 || gestureState.vy > 0.5;

        if (isSwipeUp && expandableRef.current && !isExpandedRef.current) {
          setIsExpanded(true);
          springBack();
          return;
        }

        if (isSwipeDown) {
          if (isExpandedRef.current) {
            setIsExpanded(false);
            springBack();
            return;
          }
          if (dismissibleRef.current && onCloseRef.current) {
            Animated.timing(slideAnim, {
              toValue: SLIDE_OFFSET,
              duration: 180,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }).start(() => {
              onCloseRef.current?.();
            });
            return;
          }
        }

        springBack();
      },
      onPanResponderTerminate: () => {
        springBack();
      },
    })
  ).current;

  const fullExpandedHeight = Math.max(260, screenHeight - insets.top - 12);
  const keyboardAvailableHeight =
    avoidKeyboard && keyboardHeight > 0
      ? Math.max(220, screenHeight - keyboardHeight - insets.top - 12)
      : null;

  const computedMaxHeight = keyboardAvailableHeight
    ? keyboardAvailableHeight
    : isExpanded
    ? fullExpandedHeight
    : maxHeight;

  const sheetContent = (
    <Animated.View
      collapsable={false}
      style={[
        {
          width: '100%',
          maxHeight: computedMaxHeight,
          transform: [{ translateY: slideAnim }],
        },
        isExpanded && !keyboardAvailableHeight
          ? {
              minHeight: fullExpandedHeight,
              backgroundColor: '#ffffff',
              borderTopLeftRadius: 32,
              borderTopRightRadius: 32,
            }
          : null,
      ]}
    >
      {showHandle && (
        <View
          {...panResponder.panHandlers}
          style={styles.handleZone}
          accessibilityLabel="Drag drawer handle"
        >
          <View style={styles.handlePill} />
        </View>
      )}
      {children}
    </Animated.View>
  );

  const androidKeyboardPadding =
    Platform.OS === 'android' && avoidKeyboard && keyboardHeight > 0
      ? keyboardHeight
      : 0;

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

        {Platform.OS === 'ios' && avoidKeyboard ? (
          <KeyboardAvoidingView
            behavior="padding"
            style={styles.sheetContainer}
            pointerEvents="box-none"
          >
            {sheetContent}
          </KeyboardAvoidingView>
        ) : (
          <View
            style={[
              styles.sheetContainer,
              androidKeyboardPadding > 0 ? { paddingBottom: androidKeyboardPadding } : null,
            ]}
            pointerEvents="box-none"
          >
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
  handleZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 28,
    zIndex: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handlePill: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.75)',
  },
});

export default BottomSheetModal;
