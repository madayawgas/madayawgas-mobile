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
  const [hasHeightLock, setHasHeightLock] = useState(false);
  const slideAnim = useRef(new Animated.Value(SLIDE_OFFSET)).current;
  const heightAnim = useRef(new Animated.Value(0)).current;

  const isExpandedRef = useRef(false);
  const hasHeightLockRef = useRef(false);
  const isDraggingRef = useRef(false);
  const isHeightAnimatingRef = useRef(false);
  const collapsedHeightRef = useRef(0);
  const fullExpandedHeightRef = useRef(Math.max(260, screenHeight - insets.top - 12));
  const dismissibleRef = useRef(dismissible);
  const expandableRef = useRef(expandable);
  const onCloseRef = useRef(onClose);

  const fullExpandedHeight = Math.max(260, screenHeight - insets.top - 12);
  isExpandedRef.current = isExpanded;
  hasHeightLockRef.current = hasHeightLock;
  fullExpandedHeightRef.current = fullExpandedHeight;
  dismissibleRef.current = dismissible;
  expandableRef.current = expandable;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (visible) {
      setIsExpanded(false);
      setHasHeightLock(false);
      isExpandedRef.current = false;
      hasHeightLockRef.current = false;
      isDraggingRef.current = false;
      isHeightAnimatingRef.current = false;
      slideAnim.setValue(SLIDE_OFFSET);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      setIsExpanded(false);
      setHasHeightLock(false);
    }
  }, [visible, slideAnim]);

  const springSlideBack = () => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 70,
      friction: 11,
    }).start();
  };

  const animateHeightTo = (targetHeight, unlockOnDone = false) => {
    isHeightAnimatingRef.current = true;
    Animated.spring(heightAnim, {
      toValue: targetHeight,
      useNativeDriver: false,
      tension: 65,
      friction: 11,
    }).start(() => {
      isHeightAnimatingRef.current = false;
      if (unlockOnDone && !isExpandedRef.current && !isDraggingRef.current) {
        hasHeightLockRef.current = false;
        setHasHeightLock(false);
      }
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 4,
      onPanResponderGrant: () => {
        isDraggingRef.current = true;
      },
      onPanResponderMove: (_, gestureState) => {
        const collapsedH = collapsedHeightRef.current;
        const expandedH = fullExpandedHeightRef.current;

        if (isExpandedRef.current) {
          if (gestureState.dy > 0) {
            const collapseRange = Math.max(0, expandedH - collapsedH);
            if (!hasHeightLockRef.current) {
              hasHeightLockRef.current = true;
              setHasHeightLock(true);
            }
            if (gestureState.dy <= collapseRange) {
              heightAnim.setValue(expandedH - gestureState.dy);
              slideAnim.setValue(0);
            } else {
              heightAnim.setValue(collapsedH);
              if (dismissibleRef.current) {
                slideAnim.setValue(gestureState.dy - collapseRange);
              }
            }
          }
          return;
        }

        if (gestureState.dy > 0) {
          // Dragging down from collapsed state
          if (hasHeightLockRef.current && collapsedH > 0) {
            heightAnim.setValue(collapsedH);
          }
          if (dismissibleRef.current) {
            slideAnim.setValue(gestureState.dy);
          }
        } else if (gestureState.dy < 0 && expandableRef.current && collapsedH > 0) {
          // Dragging up from collapsed: smoothly grow height without lifting bottom edge
          if (!hasHeightLockRef.current) {
            hasHeightLockRef.current = true;
            setHasHeightLock(true);
          }
          slideAnim.setValue(0);
          heightAnim.setValue(Math.min(expandedH, collapsedH - gestureState.dy));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        isDraggingRef.current = false;
        const collapsedH = collapsedHeightRef.current;
        const expandedH = fullExpandedHeightRef.current;
        const isSwipeUp = gestureState.dy < -40 || gestureState.vy < -0.5;
        const isSwipeDown = gestureState.dy > 50 || gestureState.vy > 0.5;

        if (isSwipeUp && expandableRef.current && !isExpandedRef.current && collapsedH > 0) {
          isExpandedRef.current = true;
          hasHeightLockRef.current = true;
          setIsExpanded(true);
          setHasHeightLock(true);
          animateHeightTo(expandedH, false);
          springSlideBack();
          return;
        }

        if (isSwipeDown) {
          if (isExpandedRef.current) {
            isExpandedRef.current = false;
            setIsExpanded(false);
            if (collapsedH > 0) {
              animateHeightTo(collapsedH, true);
            } else {
              hasHeightLockRef.current = false;
              setHasHeightLock(false);
            }
            springSlideBack();
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

        if (isExpandedRef.current) {
          animateHeightTo(expandedH, false);
        } else if (hasHeightLockRef.current && collapsedH > 0) {
          animateHeightTo(collapsedH, true);
        }
        springSlideBack();
      },
      onPanResponderTerminate: () => {
        isDraggingRef.current = false;
        if (isExpandedRef.current) {
          animateHeightTo(fullExpandedHeightRef.current, false);
        } else if (hasHeightLockRef.current && collapsedHeightRef.current > 0) {
          animateHeightTo(collapsedHeightRef.current, true);
        }
        springSlideBack();
      },
    })
  ).current;

  const keyboardAvailableHeight =
    avoidKeyboard && keyboardHeight > 0
      ? Math.max(220, screenHeight - keyboardHeight - insets.top - 12)
      : null;

  const computedMaxHeight = keyboardAvailableHeight
    ? keyboardAvailableHeight
    : isExpanded || hasHeightLock
    ? fullExpandedHeight
    : maxHeight;

  const sheetContent = (
    <Animated.View
      collapsable={false}
      style={{
        width: '100%',
        maxHeight: computedMaxHeight,
        transform: [{ translateY: slideAnim }],
      }}
    >
      <Animated.View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (!isExpandedRef.current && !isDraggingRef.current && !isHeightAnimatingRef.current && h > 0) {
            collapsedHeightRef.current = h;
          }
        }}
        style={[
          {
            width: '100%',
            overflow: 'hidden',
            borderTopLeftRadius: 32,
            borderTopRightRadius: 32,
          },
          hasHeightLock && !keyboardAvailableHeight
            ? {
                height: heightAnim,
                backgroundColor: '#ffffff',
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
