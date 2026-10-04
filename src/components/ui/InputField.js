import React from 'react';
import { View, Text, TextInput } from 'react-native';

const InputField = ({ label, placeholder, value, onChangeText }) => {
  return (
    <View className="mb-4 w-full">
      <Text className="text-[#0d4761] font-bold mb-2">{label}</Text>
      <TextInput
        className="bg-[#f4f5f7] px-4 py-4 rounded-xl text-[#0d4761] w-full"
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
      />
    </View>
  );
};
export default InputField;