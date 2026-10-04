import './global.css';
import React, { useState, useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import SplashScreen from './src/screens/SplashScreen';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen'; // <-- Import Dashboard

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState(null); // <-- Add user state

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar
        backgroundColor={user ? "#0d4761" : (isReady ? "#ffffff" : "#0d4761")}
        barStyle={isReady && !user ? "dark-content" : "light-content"}
      />
      {!isReady ? (
        <SplashScreen />
      ) : user ? (
        <DashboardScreen user={user} />
      ) : (
        <LoginScreen onLogin={(userData) => setUser(userData)} />
      )}
    </SafeAreaProvider>
  );
}