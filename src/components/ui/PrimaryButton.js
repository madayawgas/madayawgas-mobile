import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator } from 'react-native';

const PrimaryButton = ({
  title,
  onPress,
  loading,
  variant = 'primary', // 'primary' | 'outline' | 'danger-outline' | 'danger'
  bgColor = 'bg-[#facc15]',
  textColor = 'text-[#0d4761]',
  borderColor = 'border-[#DFE8EF]', // gray border for white buttons
  className = '',
}) => {
  const isOutline = variant === 'outline';
  const isDangerOutline = variant === 'danger-outline';
  const isDanger = variant === 'danger';

  let baseBg = isOutline ? 'bg-white' : bgColor;
  let baseBorder = isOutline ? `border ${borderColor}` : 'border-0';
  let baseText = isOutline ? 'text-[#104D6B]' : textColor;

  if (isDangerOutline) {
    baseBg = 'bg-red-50/70';
    baseBorder = 'border border-red-200';
    baseText = 'text-red-600';
  } else if (isDanger) {
    baseBg = 'bg-red-600';
    baseBorder = 'border-0';
    baseText = 'text-white';
  }

  return (
    <TouchableOpacity
      className={`w-full py-3.5 rounded-full items-center my-1.5 ${baseBg} ${baseBorder} ${className}`}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator
          color={
            isDanger
              ? '#FFFFFF'
              : isDangerOutline
              ? '#DC2626'
              : isOutline
              ? '#104D6B'
              : '#0d4761'
          }
        />
      ) : (
        <Text className={`font-bold text-md tracking-wider ${baseText}`}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

export default PrimaryButton;