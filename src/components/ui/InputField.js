import React, { useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const InputField = ({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  leftIcon,
  inputRef,
  containerClassName = 'mb-4',
  style,
  onFocus,
  onBlur,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = (e) => {
    setIsFocused(true);
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e) => {
    setIsFocused(false);
    if (onBlur) onBlur(e);
  };

  const borderAndBgClass = error
    ? 'bg-red-50/40 border-red-500'
    : isFocused
      ? 'bg-white border-[#0d4761]'
      : 'bg-[#f4f5f7] border-slate-200';

  const iconColor = error ? '#ef4444' : isFocused ? '#0d4761' : '#64748b';

  return (
    <View className={`w-full ${containerClassName}`}>
      {label ? (
        <Text className="text-xs font-bold text-[#0d4761] uppercase tracking-wider mb-1.5">
          {label}
        </Text>
      ) : null}

      <View
        className={`flex-row items-center min-h-[52px] rounded-xl px-4 border ${borderAndBgClass}`}
      >
        {leftIcon ? (
          <Ionicons
            name={leftIcon}
            size={20}
            color={iconColor}
            style={{ marginRight: 10 }}
          />
        ) : null}

        <TextInput
          ref={inputRef}
          className="flex-1 text-base font-medium text-[#0d4761]"
          style={[{ color: '#0d4761', paddingVertical: 0 }, style]}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          selectionColor="rgba(13, 71, 97, 0.22)"
          cursorColor="#0d4761"
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
      </View>

      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="text-red-500 text-xs font-medium mt-1.5 ml-1"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
};

export default InputField;
