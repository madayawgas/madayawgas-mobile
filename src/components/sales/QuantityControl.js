import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const WARNING_DURATION_MS = 2800;

const QuantityControl = ({ quantity, onUpdateQuantity, maxQuantity }) => {
  const hasMax = typeof maxQuantity === 'number';
  const currentQty = quantity || 0;
  const isAtOrOverMax = hasMax && currentQty >= maxQuantity;
  const isOverLimit = hasMax && currentQty > maxQuantity;

  const [exceededAttempt, setExceededAttempt] = useState(false);
  const warningTimerRef = useRef(null);

  const clearWarningTimer = () => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
  };

  const triggerExceededWarning = () => {
    clearWarningTimer();
    setExceededAttempt(true);
    warningTimerRef.current = setTimeout(() => {
      setExceededAttempt(false);
      warningTimerRef.current = null;
    }, WARNING_DURATION_MS);
  };

  const dismissExceededWarning = () => {
    clearWarningTimer();
    if (exceededAttempt) {
      setExceededAttempt(false);
    }
  };

  useEffect(() => {
    return () => clearWarningTimer();
  }, []);

  const showLimitWarning = isOverLimit || exceededAttempt;

  const handleTextChange = (text) => {
    const cleanNumber = text.replace(/[^0-9]/g, '');
    const rawValue = cleanNumber === '' ? 0 : parseInt(cleanNumber, 10);

    if (hasMax && rawValue > maxQuantity) {
      onUpdateQuantity(maxQuantity);
      triggerExceededWarning();
      return;
    }

    dismissExceededWarning();
    onUpdateQuantity(rawValue);
  };

  const adjustQuantity = (delta) => {
    const nextQty = currentQty + delta;
    if (hasMax && delta > 0 && nextQty > maxQuantity) {
      onUpdateQuantity(maxQuantity);
      triggerExceededWarning();
      return;
    }

    dismissExceededWarning();
    onUpdateQuantity(Math.max(0, nextQty));
  };

  return (
    <View className="items-end">
      {/* Light Grey Pill Container (Turns Red Only When Attempting to Exceed Stock) */}
      <View
        style={{
          borderRadius: 9999,
          backgroundColor: showLimitWarning ? '#fef2f2' : '#E5E7EB',
          borderWidth: 1,
          borderColor: showLimitWarning ? '#ef4444' : '#D9D9D9',
        }}
        className="flex-row items-center justify-between px-3 py-1.5"
      >
        <TouchableOpacity
          onPress={() => adjustQuantity(-1)}
          disabled={currentQty <= 0}
          style={{ opacity: currentQty <= 0 ? 0.35 : 1 }}
          className="w-7 h-7 bg-white rounded-full items-center justify-center border border-[#D9D9D9]"
          activeOpacity={0.7}
        >
          <Ionicons name="remove" size={14} color={showLimitWarning ? '#dc2626' : '#0d4761'} />
        </TouchableOpacity>

        <TextInput
          style={{ color: showLimitWarning ? '#dc2626' : '#0d4761' }}
          className="font-bold text-sm text-center px-2 py-0 min-w-[40px]"
          keyboardType="number-pad"
          value={String(quantity ?? 0)}
          onChangeText={handleTextChange}
          selectTextOnFocus
        />

        <TouchableOpacity
          onPress={() => adjustQuantity(1)}
          style={{ opacity: isAtOrOverMax ? 0.35 : 1 }}
          className="w-7 h-7 bg-white rounded-full items-center justify-center border border-[#D9D9D9]"
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={14} color={showLimitWarning ? '#dc2626' : '#0d4761'} />
        </TouchableOpacity>
      </View>

      {/* Inline Limit Notice (Shown Only When Attempting to Exceed Stock) */}
      {hasMax && showLimitWarning && (
        <Text className="text-red-500 text-[10px] font-semibold mt-1">
          Max: {maxQuantity} available on board (cannot exceed)
        </Text>
      )}
    </View>
  );
};

export default QuantityControl;