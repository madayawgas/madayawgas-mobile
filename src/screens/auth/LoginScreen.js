import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import InputField from '../../components/ui/InputField';
import PasswordField from '../../components/ui/PasswordField';
import PrimaryButton from '../../components/ui/PrimaryButton';
import KeyboardAwareScrollView from '../../components/ui/KeyboardAwareScrollView';
import LoginDesign from '../../../assets/svg/login-bg.svg';
import Logo2 from '../../../assets/svg/logo2.svg';
import { authService } from '../../services/authService';

const LoginScreen = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const passwordInputRef = useRef(null);

  const handleUsernameChange = (text) => {
    setUsername(text);
    if (errors.username) {
      setErrors((prev) => ({ ...prev, username: undefined }));
    }
  };

  const handlePasswordChange = (text) => {
    setPassword(text);
    if (errors.password) {
      setErrors((prev) => ({ ...prev, password: undefined }));
    }
  };

  const handleLogin = async () => {
    const trimmedUsername = username.trim();
    const nextErrors = {};

    if (!trimmedUsername) {
      nextErrors.username = 'Username is required.';
    }
    if (!password) {
      nextErrors.password = 'Password is required.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setLoading(true);

    try {
      const session = await authService.login({
        username: trimmedUsername,
        password,
      });
      onLogin(session);
    } catch (error) {
      Alert.alert('Login Failed', error.message || 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    Alert.alert(
      'Forgot Password?',
      'Please contact your dispatch supervisor or system administrator to reset your account password.'
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['bottom']}>
      <KeyboardAwareScrollView
        className="flex-1 bg-white"
        extraBottomPadding={32}
        contentContainerStyle={{ flexGrow: 1 }}
      >
          {/* Top Header Section with SVGs */}
          <View className="relative w-full h-72 bg-white">
            <View className="absolute top-0 left-0 right-0 bottom-0 w-full">
              <LoginDesign width="100%" height="100%" preserveAspectRatio="none" />
            </View>

            <View className="flex-1 items-center justify-center pt-8">
              <Logo2 width={200} height={110} />
            </View>
          </View>

          {/* Form Section */}
          <View className="flex-1 px-6 pt-4 pb-6 justify-between">
            <View>
              <View className="mb-6">
                <Text className="text-3xl font-bold text-[#0d4761] mb-1.5">
                  Welcome back
                </Text>
                <Text className="text-sm text-slate-500 font-medium">
                  Sign in to start your delivery shift
                </Text>
              </View>

              <InputField
                label="Username"
                placeholder="Enter your username"
                leftIcon="person-outline"
                value={username}
                onChangeText={handleUsernameChange}
                error={errors.username}
                autoComplete="username"
                textContentType="username"
                returnKeyType="next"
                onSubmitEditing={() => passwordInputRef.current?.focus()}
                blurOnSubmit={false}
                editable={!loading}
              />

              <PasswordField
                inputRef={passwordInputRef}
                label="Password"
                placeholder="Enter your password"
                leftIcon="lock-closed-outline"
                value={password}
                onChangeText={handlePasswordChange}
                error={errors.password}
                containerClassName="mb-6"
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                editable={!loading}
              />

              <PrimaryButton
                title="Log In"
                onPress={handleLogin}
                loading={loading}
              />
            </View>

            <View className="pt-4 items-center">
              <TouchableOpacity
                onPress={handleForgotPassword}
                disabled={loading}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Forgot Password"
                className="min-h-[44px] px-4 justify-center items-center"
              >
                <Text className="text-[#0d4761] font-semibold text-sm">
                  Forgot Password?
                </Text>
              </TouchableOpacity>
            </View>
          </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
};

export default LoginScreen;
