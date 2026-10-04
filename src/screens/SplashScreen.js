import React from 'react';
import { View } from 'react-native';
import Logo from '../../assets/svg/logo.svg';

const SplashScreen = () => {
  return (
    <View className="flex-1 bg-[#0A4B6E] items-center justify-center">
      <Logo width={120} height={120} />
    </View>
  );
};
export default SplashScreen;