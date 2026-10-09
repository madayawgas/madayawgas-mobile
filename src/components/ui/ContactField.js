import React from 'react';
import { View, Text, TextInput } from 'react-native';

const ContactField = ({
  label = "Contact Number",
  value,
  onChangeText,
  error
}) => {
  // Auto-formats 10 raw digits into "999 9999 999" (3 - 4 - 3 split)
  const handleTextChange = (text) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 10);

    let formatted = cleaned;
    if (cleaned.length > 3 && cleaned.length <= 7) {
      formatted = `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
    } else if (cleaned.length > 7) {
      formatted = `${cleaned.slice(0, 3)} ${cleaned.slice(3, 7)} ${cleaned.slice(7)}`;
    }

    if (onChangeText) {
      // Pass formatted value back to parent (e.g. "999 9999 999")
      onChangeText(formatted);
    }
  };

  return (
    <View className="mb-4 w-full">
      {label ? <Text className="text-[#0d4761] font-bold mb-2">{label}</Text> : null}

      <View className="flex-row items-center bg-[#f4f5f7] px-4 py-3.5 rounded-xl border border-transparent">
        {/* Fixed Country Code */}
        <Text className="text-[#0d4761] font-bold text-base">+(63)</Text>

        {/* Vertical Divider */}
        <View className="w-[1px] h-5 bg-gray-300 mx-3" />

        {/* 10-Digit User Input */}
        <TextInput
          className="flex-1 text-[#0d4761] font-medium text-base tracking-wider py-0"
          placeholder="999 9999 999"
          placeholderTextColor="#9ca3af"
          keyboardType="number-pad"
          maxLength={12} // 10 digits + 2 spaces
          value={value}
          onChangeText={handleTextChange}
        />
      </View>

      {error ? <Text className="text-red-500 text-xs mt-1 ml-1">{error}</Text> : null}
    </View>
  );
};

export default ContactField;