import React, { useRef, useState } from 'react';
import { View, Text, Animated, PanResponder, Dimensions, ScrollView } from 'react-native';
import PrimaryButton from '../ui/PrimaryButton';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// 80px leaves room for header and divider line
const HEADER_OFFSET = 80;
const DRAWER_HEIGHT = SCREEN_HEIGHT - HEADER_OFFSET;

// Increased resting peek height to give ample room below the total pill
const PEEK_HEIGHT = 235;

const EXPANDED_OFFSET = 0;
const PEEK_OFFSET = DRAWER_HEIGHT - PEEK_HEIGHT;

const OrderSummaryDrawer = ({
  customerName = 'Leshka Karenderia',
  selectedProducts = [],
  quantities = {},
  totalAmount = 0,
  onConfirm,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Starts minimized at PEEK_OFFSET
  const translateY = useRef(new Animated.Value(PEEK_OFFSET)).current;
  const currentOffset = useRef(PEEK_OFFSET);

  // Interpolate counter-translation so button remains stationary on screen
  const buttonTranslateY = translateY.interpolate({
    inputRange: [EXPANDED_OFFSET, PEEK_OFFSET],
    outputRange: [0, -PEEK_OFFSET],
    extrapolate: 'clamp',
  });

  const animateToOffset = (toValue) => {
    currentOffset.current = toValue;
    setIsExpanded(toValue === EXPANDED_OFFSET);
    Animated.spring(translateY, {
      toValue,
      useNativeDriver: true,
      tension: 65,
      friction: 10,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        let newY = currentOffset.current + gestureState.dy;
        if (newY < EXPANDED_OFFSET) newY = EXPANDED_OFFSET;
        if (newY > PEEK_OFFSET) newY = PEEK_OFFSET;
        translateY.setValue(newY);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy < -40 || gestureState.vy < -0.5) {
          animateToOffset(EXPANDED_OFFSET);
        } else if (gestureState.dy > 40 || gestureState.vy > 0.5) {
          animateToOffset(PEEK_OFFSET);
        } else {
          const closest =
            Math.abs(currentOffset.current - EXPANDED_OFFSET) <
            Math.abs(currentOffset.current - PEEK_OFFSET)
              ? EXPANDED_OFFSET
              : PEEK_OFFSET;
          animateToOffset(closest);
        }
      },
    })
  ).current;

  const handleActionPress = () => {
    if (!isExpanded) {
      animateToOffset(EXPANDED_OFFSET); // Slide up below header
    } else {
      onConfirm(); // Confirm order
    }
  };

  return (
    /* Outer Shadow & Animated Wrapper */
    <Animated.View
      style={{
        transform: [{ translateY }],
        height: DRAWER_HEIGHT,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 20,
      }}
      className="absolute bottom-0 left-0 right-0 bg-transparent"
    >
      {/* Inner Rounded Top Container */}
      <View
        style={{
          borderTopLeftRadius: 40,
          borderTopRightRadius: 40,
          borderWidth: 1,
          borderColor: '#D9D9D9',
          borderBottomWidth: 0,
        }}
        className="flex-1 bg-white px-6 pt-3 relative overflow-hidden"
      >
        {/* Scrollable Content Area */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          bounces={false}
        >
          {/* Top Drag Handle */}
          <View {...panResponder.panHandlers} className="w-full items-center pt-1 pb-1 bg-white">
            <View className="w-12 h-1 bg-[#0d4761] rounded-full mb-2" />
            <Text className="text-gray-400 text-xs italic mb-2">Order details</Text>
          </View>

          {/* Customer Name Row */}
          {!isExpanded ? (
            <View className="flex-row justify-between items-center mb-3 px-1">
              <Text className="text-gray-400 text-sm font-medium">Customer Name</Text>
              <Text className="text-[#0d4761] font-bold text-base">{customerName}</Text>
            </View>
          ) : (
            <Text className="text-[#0d4761] text-center text-xl font-bold my-2">
              {customerName}
            </Text>
          )}

          {/* Total Capsule */}
          <View className="bg-white border border-[#D9D9D9] rounded-full px-6 py-3.5 flex-row items-center justify-between shadow-xs mb-6">
            <Text className="text-gray-500 font-medium text-sm">
              {isExpanded ? 'Total:' : 'Order Total'}
            </Text>
            <Text className="text-[#0d4761] font-bold text-xl tracking-tight">
              ₱ {totalAmount.toLocaleString('en-US', { minimumFractionDigits: 0 })}
            </Text>
          </View>

          {/* Expanded Order Breakdown Table */}
          {isExpanded && (
            <View className="bg-white border border-[#D9D9D9] rounded-[28px] p-4 mb-4">
              <Text className="text-center text-gray-400 text-xs italic mb-3">
                Product order
              </Text>

              <View className="flex-row justify-between border-b border-gray-100 pb-2 mb-2 px-1">
                <Text className="text-gray-400 text-[11px] italic w-[30%]">Product</Text>
                <Text className="text-gray-400 text-[11px] italic text-center w-[20%]">Quantity</Text>
                <Text className="text-gray-400 text-[11px] italic text-right w-[22%]">Price</Text>
                <Text className="text-gray-400 text-[11px] italic text-right w-[28%]">Total</Text>
              </View>

              {selectedProducts.map((p) => {
                const qty = quantities[p.id] || 0;
                const lineTotal = qty * p.price;
                return (
                  <View key={p.id} className="flex-row justify-between items-center py-1.5 px-1">
                    <Text className="text-[#0d4761] text-xs font-semibold w-[30%]" numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text className="text-[#0d4761] text-xs font-semibold text-center w-[20%]">
                      {qty}
                    </Text>
                    <Text className="text-[#0d4761] text-xs font-semibold text-right w-[22%]">
                      ₱ {p.price.toFixed(0)}
                    </Text>
                    <Text className="text-[#0d4761] text-xs font-bold text-right w-[28%]">
                      ₱ {lineTotal.toLocaleString('en-US')}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* Fixed Position Bottom Button */}
        <Animated.View
          style={{
            position: 'absolute',
            bottom: 24,
            left: 24,
            right: 24,
            transform: [{ translateY: buttonTranslateY }],
          }}
        >
          <PrimaryButton
            title={isExpanded ? 'CONFIRM' : 'PROCEED'}
            onPress={handleActionPress}
          />
        </Animated.View>
      </View>
    </Animated.View>
  );
};

export default OrderSummaryDrawer;