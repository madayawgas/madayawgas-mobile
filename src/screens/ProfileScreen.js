import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BottomNav from '../components/ui/BottomNav';

const ProfileScreen = ({ user, onLogout, activeTab, onSelectTab }) => {
  return (
    <SafeAreaView className="flex-1 bg-[#f9fafb]">
      <View className="flex-1 px-6 pt-6 justify-between pb-32">
        <View>
          <Text className="text-[#0d4761] text-[40px] font-bold mb-6 tracking-tight">Profile</Text>
        </View>

        {/* Logout Button */}
        <TouchableOpacity
          onPress={onLogout}
          className="bg-red-50 border border-red-200 py-4 rounded-2xl flex-row justify-center items-center"
        >
          <Ionicons name="log-out-outline" size={20} color="#dc2626" className="mr-2" />
          <Text className="text-red-600 font-bold text-base">Log Out</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Navigation */}
      <BottomNav activeTab={activeTab} onSelectTab={onSelectTab} />
    </SafeAreaView>
  );
};

export default ProfileScreen;