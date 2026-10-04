import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator } from 'react-native';

const PrimaryButton = ({ title, onPress, loading }) => {
  return (
    <TouchableOpacity
      className="bg-[#facc15] w-full py-4 rounded-full items-center mt-2"
      onPress={onPress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator color="#0d4761" />
      ) : (
        <Text className="text-[#0d4761] font-bold text-lg">{title}</Text>
      )}
    </TouchableOpacity>
  );
};
export default PrimaryButton;