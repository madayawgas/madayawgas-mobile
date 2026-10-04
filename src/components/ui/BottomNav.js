import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const BottomNav = () => {
  return (
    <View className="absolute bottom-6 self-center flex-row bg-white rounded-[2rem] shadow-lg border border-gray-200 px-6 py-2 items-center justify-between w-11/12">

      {/* Active Tab */}
      <TouchableOpacity className="bg-[#0d4761] px-6 py-2 rounded-full items-center justify-center">
        <Ionicons name="server" size={24} color="#facc15" />
      </TouchableOpacity>

      {/* Inactive Tabs */}
      <TouchableOpacity className="items-center justify-center px-4">
        <Ionicons name="cart-outline" size={24} color="#0d4761" />
        <Text className="text-[10px] text-[#0d4761] font-bold mt-1 uppercase">Order</Text>
      </TouchableOpacity>

      <TouchableOpacity className="items-center justify-center px-4">
        <Ionicons name="person-outline" size={24} color="#0d4761" />
        <Text className="text-[10px] text-[#0d4761] font-bold mt-1 uppercase">Customer</Text>
      </TouchableOpacity>

      <TouchableOpacity className="items-center justify-center px-4">
        <Ionicons name="bus-outline" size={24} color="#0d4761" />
        <Text className="text-[10px] text-[#0d4761] font-bold mt-1 uppercase">Fleet</Text>
      </TouchableOpacity>

    </View>
  );
};

export default BottomNav;