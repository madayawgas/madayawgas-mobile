import React from 'react';
import { View, Text } from 'react-native';

const CustomerCard = ({ name, contact, dateString }) => {
  // Simple helper to calculate a mock "time ago" string based on the date
  const getTimeAgo = (date) => {
    const diffDays = Math.floor((new Date() - new Date(date)) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 365)} years ago`; // Matches the "5 years ago" UI detail
  };

  return (
    <View className="flex-row items-center border border-gray-200 rounded-full p-2 mb-3 bg-white">
      {/* Circular Avatar */}
      <View className="w-16 h-16 bg-[#0d4761] rounded-full mr-4" />

      {/* Customer Info */}
      <View className="flex-1 justify-center">
        <Text className="text-[#0d4761] font-bold text-base leading-tight mb-1">{name}</Text>
        <Text className="text-gray-400 text-[11px]">{contact}</Text>
      </View>

      {/* Time Ago Label */}
      <Text className="text-gray-400 text-[10px] italic pr-4">
        {getTimeAgo(dateString)}
      </Text>
    </View>
  );
};

export default CustomerCard;