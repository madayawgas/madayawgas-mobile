import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator } from 'react-native';

const PrimaryButton = ({
  title,
  onPress,
  loading,
  variant = 'primary', // 'primary' | 'outline'
  bgColor = 'bg-[#facc15]',
  textColor = 'text-[#0d4761]',
  borderColor = 'border-[#DFE8EF]', // gray border for white buttons
  className = '',
}) => {
  const isOutline = variant === 'outline';

  const baseBg = isOutline ? 'bg-white' : bgColor;
  const baseBorder = isOutline ? `border ${borderColor}` : 'border-0';
  const baseText = isOutline ? 'text-[#104D6B]' : textColor;

  return (
    <TouchableOpacity
      className={`w-full py-3.5 rounded-full items-center my-1.5 ${baseBg} ${baseBorder} ${className}`}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={isOutline ? '#104D6B' : '#0d4761'} />
      ) : (
        <Text className={`font-bold text-md tracking-wider ${baseText}`}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

export default PrimaryButton;