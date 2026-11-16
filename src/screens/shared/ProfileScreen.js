import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import BottomNav from '../../components/navigation/BottomNav';
import PrimaryButton from '../../components/ui/PrimaryButton';
import EditProfileModal from '../../components/profile/EditProfileModal';
import ProfileBg from '../../../assets/svg/profile-bg.svg';
import { driverRepository, tripRepository } from '../../database';
import { driverService } from '../../services/driverService';
import { userApi } from '../../api';
import { authService } from '../../services/authService';
import { resolveMediaUrl } from '../../utils/mediaResolver';

const DRIVER_TABS = [
  { id: 'dashboard', label: 'Cabin', iconName: 'speedometer-outline', activeIconName: 'speedometer' },
  { id: 'maintenance', label: 'Vehicle', iconName: 'construct-outline', activeIconName: 'construct' },
  { id: 'profile', label: 'Profile', iconName: 'person-circle-outline', activeIconName: 'person-circle' },
];

const formatPhoneNumber = (phone) => {
  if (!phone) return 'N/A';
  const cleaned = phone.replace(/[^\d+]/g, '');
  const match = cleaned.match(/^(\+63)(\d{3})(\d{4})(\d{3})$/);
  if (match) {
    return `+(63) ${match[2]} ${match[3]} ${match[4]}`;
  }
  return phone;
};

const formatBirthdate = (raw) => {
  if (!raw) return 'Not set';
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  } catch {}
  return String(raw);
};

const ProfileScreen = ({
  user,
  onLogout,
  activeTab,
  onSelectTab,
  tabs,
  onEditProfile,
  vehicle,
}) => {
  const isDriver = user?.role === 'Driver' || user?.roleNames?.includes('Driver');
  const resolvedTabs = tabs || (isDriver ? DRIVER_TABS : undefined);
  const [vehicleData, setVehicleData] = useState(vehicle || null);
  const [currentUser, setCurrentUser] = useState(user || null);
  const [avatarUri, setAvatarUri] = useState(resolveMediaUrl(user?.avatarUrl) || null);
  const [imageError, setImageError] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Sync when parent user prop updates
  useEffect(() => {
    if (user) {
      setCurrentUser(user);
      const resolved = resolveMediaUrl(user.avatarUrl);
      setAvatarUri(resolved);
      setImageError(false);
    }
  }, [user]);

  // Hydrate latest profile from backend on mount
  useEffect(() => {
    let isMounted = true;
    const fetchLatestProfile = async () => {
      try {
        const res = await userApi.getProfile();
        if (isMounted && res?.user) {
          setCurrentUser(res.user);
          const resolved = resolveMediaUrl(res.user.avatarUrl);
          setAvatarUri(resolved);
          setImageError(false);
          await authService.updateUser(res.user);
        }
      } catch (err) {
        console.log('[ProfileScreen] Could not fetch remote profile on mount, using cached user:', err?.message || err);
      }
    };

    fetchLatestProfile();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (vehicle) {
      setVehicleData(vehicle);
      return;
    }
    if (!isDriver) return;

    let isMounted = true;
    const loadVehicle = async () => {
      try {
        const [telemetry, activeTrip] = await Promise.all([
          driverRepository.getVehicleTelemetry().catch(() => null),
          tripRepository.getActiveTrip().catch(() => null),
        ]);
        if (isMounted) {
          setVehicleData({
            plate_number: telemetry?.plate_number || activeTrip?.vehicle_plate || 'N/A',
            model: telemetry?.model || activeTrip?.truck_model || 'N/A',
          });
        }
      } catch {}
    };

    loadVehicle();

    const unsubRealtime = driverService.subscribeRealtime((event) => {
      if (
        event === 'VEHICLE_DRIVER_ASSIGNED' ||
        event === 'VEHICLE_STATUS_UPDATED' ||
        event === 'FLEET_VEHICLE_RELEASED'
      ) {
        loadVehicle();
      }
    });

    return () => {
      isMounted = false;
      unsubRealtime();
    };
  }, [isDriver, vehicle]);

  const fullName =
    [currentUser?.firstName, currentUser?.lastName].filter(Boolean).join(' ') || 'N/A';
  const birthdate = formatBirthdate(currentUser?.birthdate);
  const username = currentUser?.username || 'N/A';
  const phone = formatPhoneNumber(currentUser?.phone);
  const handleLogoutPress = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: onLogout,
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {/* HEADER */}
        <View className="relative h-[310px] w-full">

          {/* PROFILE BACKGROUND SVG */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          >
            <ProfileBg
              width="100%"
              height="100%"
              preserveAspectRatio="none"
            />
          </View>

          {/* HEADER TITLE */}
          <SafeAreaView
            edges={['top']}
            className="absolute left-0 right-0 top-0 z-10"
          >
            <Text className="ml-6 mt-10 text-[32px] font-bold tracking-tight text-white">
              My Profile
            </Text>
          </SafeAreaView>

          {/* PROFILE IMAGE */}
          <View className="absolute left-0 right-0 top-[140px] z-10 items-center">
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setShowEditModal(true)}
              style={{ position: 'relative' }}
            >
              <View
                style={{
                  height: 110,
                  width: 110,
                  borderRadius: 55,
                  backgroundColor: '#333333',
                  borderWidth: 4,
                  borderColor: '#FFFFFF',
                  overflow: 'hidden',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Image
                  source={
                    avatarUri && !imageError
                      ? { uri: avatarUri }
                      : require('../../../assets/images/placeholder.png')
                  }
                  style={{ height: '100%', width: '100%' }}
                  resizeMode="cover"
                  onError={() => {
                    console.log('[ProfileScreen] Remote avatar error, falling back to placeholder');
                    setImageError(true);
                  }}
                />
              </View>

              {/* CAMERA BADGE AFFORDANCE */}
              <View
                style={{
                  position: 'absolute',
                  bottom: 2,
                  right: 2,
                  backgroundColor: '#0d4761',
                  borderRadius: 18,
                  width: 34,
                  height: 34,
                  borderWidth: 3,
                  borderColor: '#FFFFFF',
                  justifyContent: 'center',
                  alignItems: 'center',
                  elevation: 4,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.25,
                  shadowRadius: 3,
                }}
              >
                <Ionicons name="camera" size={17} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* PROFILE INFORMATION */}
        <View className="px-5 pt-[6px]">
          {/* BASIC INFORMATION */}
          <View className="mb-4 rounded-[34px] border border-[#DFE8EF] bg-white px-5 pb-5 pt-5">
            <Text className="mb-5 text-[14px] font-bold text-[#7893A8]">
              Basic Information
            </Text>

            <View className="mb-3 flex-row items-center">
              <Text className="flex-1 pl-5 text-[13px] text-[#8299AB]">Name</Text>
              <Text numberOfLines={1} className="flex-1 text-[13px] font-bold text-[#104D6B]">
                {fullName}
              </Text>
            </View>

            <View className="mb-3 flex-row items-center">
              <Text className="flex-1 pl-5 text-[13px] text-[#8299AB]">Birthday</Text>
              <Text numberOfLines={1} className="flex-1 text-[13px] font-bold text-[#104D6B]">
                {birthdate}
              </Text>
            </View>

            <View className="flex-row items-center">
              <Text className="flex-1 pl-5 text-[13px] text-[#8299AB]">Mobile No.</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit className="flex-1 text-[13px] font-bold text-[#104D6B]">
                {phone}
              </Text>
            </View>
          </View>

          {/* VEHICLE INFORMATION (DRIVER ONLY) */}
          {isDriver && (
            <View className="mb-4 rounded-[34px] border border-[#DFE8EF] bg-white px-5 pb-5 pt-5">
              <Text className="mb-5 text-[14px] font-bold text-[#7893A8]">
                Vehicle Information
              </Text>

              <View className="mb-3 flex-row items-center">
                <Text className="flex-1 pl-5 text-[13px] text-[#8299AB]">Plate Number</Text>
                <Text numberOfLines={1} className="flex-1 text-[13px] font-bold text-[#104D6B]">
                  {vehicleData?.plate_number || 'N/A'}
                </Text>
              </View>

              <View className="mb-3 flex-row items-center">
                <Text className="flex-1 pl-5 text-[13px] text-[#8299AB]">Truck Model</Text>
                <Text numberOfLines={1} className="flex-1 text-[13px] font-bold text-[#104D6B]">
                  {vehicleData?.model || 'N/A'}
                </Text>
              </View>

              <View className="flex-row items-center">
                <Text className="flex-1 pl-5 text-[13px] text-[#8299AB]">Operational Role</Text>
                <Text numberOfLines={1} className="flex-1 text-[13px] font-bold text-[#104D6B]">
                  Frontline Route Driver
                </Text>
              </View>
            </View>
          )}

          {/* ACCOUNT INFORMATION */}
          <View className="mb-3 rounded-[34px] border border-[#DFE8EF] bg-white px-5 pb-8 pt-5">
            <Text className="mb-5 text-[14px] font-bold text-[#7893A8]">
              Account Information
            </Text>

            <View className="mb-5 flex-row items-center">
              <Text className="flex-1 pl-5 text-[13px] text-[#8299AB]">Username</Text>
              <Text numberOfLines={1} className="flex-1 text-[13px] font-bold text-[#104D6B]">
                {username}
              </Text>
            </View>

            <View className="flex-row items-center">
              <Text className="flex-1 pl-5 text-[13px] text-[#8299AB]">Password</Text>
              <Text className="flex-1 text-[13px] font-bold tracking-widest text-[#104D6B]">
                ••••••••••••
              </Text>
            </View>
          </View>

          {/* ACTION BUTTONS */}
          <View className="px-1 -mt-2">
            <PrimaryButton
              title="EDIT PROFILE"
              variant="outline"
              borderColor="border-[#DFE8EF]"
              textSize="text-base"
              onPress={onEditProfile || (() => setShowEditModal(true))}
            />

            <PrimaryButton
              title="LOG OUT"
              variant="danger-outline"
              textSize="text-base"
              onPress={handleLogoutPress}
            />
          </View>
        </View>
      </ScrollView>

      {/* Floating Bottom Nav */}
      <BottomNav activeTab={activeTab} onSelectTab={onSelectTab} tabs={resolvedTabs} />

      {/* Edit Profile Modal (Basic Information: Name, Birthday, Mobile No, Avatar) */}
      <EditProfileModal
        visible={showEditModal}
        onClose={() => setShowEditModal(false)}
        user={currentUser}
        onProfileUpdated={(updated) => {
          setCurrentUser(updated);
          const resolved = resolveMediaUrl(updated.avatarUrl);
          setAvatarUri(resolved);
          setImageError(false);
        }}
      />
    </View>
  );
};

export default ProfileScreen;
