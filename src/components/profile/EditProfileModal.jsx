import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { mediaService, resolveMediaUrl } from '@/services/mediaService';
import { userApi } from '@/api/endpoints/userApi';
import { authService } from '@/services/authService';
import InputField from '@/components/ui/InputField';
import ContactField from '@/components/ui/ContactField';
import PrimaryButton from '@/components/ui/PrimaryButton';
import BottomSheetModal from '@/components/ui/BottomSheetModal';

const EditProfileModal = ({
  visible,
  onClose,
  user,
  onProfileUpdated,
}) => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [photoUri, setPhotoUri] = useState(null); // local or remote preview
  const [isPhotoRemoved, setIsPhotoRemoved] = useState(false);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  // Populate form on open
  useEffect(() => {
    if (visible && user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');

      // Format birthdate to YYYY-MM-DD if ISO string
      let formattedBday = '';
      if (user.birthdate) {
        try {
          const d = new Date(user.birthdate);
          if (!isNaN(d.getTime())) {
            formattedBday = d.toISOString().split('T')[0];
          } else {
            formattedBday = String(user.birthdate);
          }
        } catch {
          formattedBday = String(user.birthdate);
        }
      }
      setBirthdate(formattedBday);

      // Clean phone to 10 digits for ContactField
      const rawPhone = user.phone || '';
      const digits = rawPhone.replace(/\D/g, '');
      const last10 = digits.startsWith('63') ? digits.slice(2, 12) : digits.slice(-10);

      // Format with 3-4-3 split for ContactField
      let formattedPhone = last10;
      if (last10.length > 3 && last10.length <= 7) {
        formattedPhone = `${last10.slice(0, 3)} ${last10.slice(3)}`;
      } else if (last10.length > 7) {
        formattedPhone = `${last10.slice(0, 3)} ${last10.slice(3, 7)} ${last10.slice(7)}`;
      }
      setPhoneDigits(formattedPhone);

      setPhotoUri(resolveMediaUrl(user.avatarUrl) || null);
      setIsPhotoRemoved(false);
      setShowPhotoOptions(false);
      setErrors({});
    }
  }, [visible, user]);

  const handlePickPhoto = async (source) => {
    try {
      setPickingPhoto(true);
      const uri = await mediaService.pickAndCompressAvatar(source);
      if (uri) {
        setPhotoUri(uri);
        setIsPhotoRemoved(false);
        setShowPhotoOptions(false);
      }
    } catch (err) {
      Alert.alert('Photo Error', err.message || 'Unable to select photo.');
    } finally {
      setPickingPhoto(false);
    }
  };

  const handleRemovePhoto = () => {
    Alert.alert(
      'Remove Photo',
      'Are you sure you want to remove your profile photo? It will reset to default upon saving.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setPhotoUri(null);
            setIsPhotoRemoved(true);
            setShowPhotoOptions(false);
          },
        },
      ]
    );
  };

  const handleSave = async () => {
    const newErrors = {};

    if (!firstName.trim()) {
      newErrors.firstName = 'First name is required.';
    }
    if (!lastName.trim()) {
      newErrors.lastName = 'Last name is required.';
    }

    const cleanPhone = phoneDigits.replace(/\D/g, '');
    if (cleanPhone.length > 0 && cleanPhone.length !== 10) {
      newErrors.phone = 'Please enter a valid 10-digit mobile number.';
    }

    if (birthdate.trim()) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(birthdate.trim())) {
        newErrors.birthdate = 'Please use format YYYY-MM-DD (e.g. 1995-08-25).';
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      setSaving(true);
      setErrors({});

      let finalAvatarMediaKey = user?.avatarMediaKey;
      let finalAvatarUrl = user?.avatarUrl;

      // 1. Process avatar upload if a new local photo was selected
      if (photoUri && (photoUri.startsWith('file://') || photoUri.startsWith('content://'))) {
        try {
          const uploadRes = await mediaService.uploadAvatar(photoUri);
          finalAvatarMediaKey = uploadRes.avatarMediaKey;
          finalAvatarUrl = uploadRes.avatarUrl || photoUri;
        } catch (uploadErr) {
          console.warn('[EditProfile] Direct avatar upload error:', uploadErr);
          // If avatar upload fails due to network, notify user
          Alert.alert(
            'Avatar Upload Failed',
            'Could not upload new profile photo. Please check your internet connection.'
          );
          setSaving(false);
          return;
        }
      } else if (isPhotoRemoved) {
        try {
          await mediaService.deleteAvatar();
          finalAvatarMediaKey = null;
          finalAvatarUrl = null;
        } catch (delErr) {
          console.warn('[EditProfile] Delete avatar error:', delErr);
        }
      }

      // 2. Format international phone number
      const fullPhone = cleanPhone ? `+63${cleanPhone}` : user?.phone || '';

      // 3. Dispatch PATCH /api/users/me
      const updatePayload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: fullPhone,
        birthdate: birthdate.trim() || undefined,
        avatarMediaKey: finalAvatarMediaKey,
      };

      const res = await userApi.updateProfile(updatePayload);
      const updatedUser = res?.user || {
        ...user,
        ...updatePayload,
        avatarUrl: finalAvatarUrl,
      };

      // Ensure local photoUri is preserved in session if remote URL was resolved
      if (finalAvatarUrl) {
        updatedUser.avatarUrl = resolveMediaUrl(finalAvatarUrl);
      }

      // 4. Update session store and notify application subscribers
      await authService.updateUser(updatedUser);

      if (onProfileUpdated) {
        onProfileUpdated(updatedUser);
      }

      Alert.alert('Profile Updated', 'Your basic information has been updated successfully.');
      onClose();
    } catch (err) {
      Alert.alert(
        'Update Failed',
        err.message || 'Unable to update profile. Please check your connection and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      dismissible={!saving}
      avoidKeyboard={true}
      backdropOpacity={0.6}
    >
      <View className="bg-white rounded-t-[32px] px-6 pt-7 pb-8">
          {/* HEADER */}
          <View className="flex-row items-center justify-between pb-3 border-b border-slate-100 mb-4">
            <View>
              <Text className="text-xl font-bold text-[#104D6B]">
                Edit Profile
              </Text>
              <Text className="text-xs text-slate-500 mt-0.5">
                Update your personal basic information
              </Text>
            </View>

            <TouchableOpacity
              onPress={onClose}
              disabled={saving}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              className="p-1.5 rounded-full bg-slate-100"
            >
              <Ionicons name="close" size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            {/* AVATAR EDIT SECTION */}
            <View className="items-center my-3">
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setShowPhotoOptions((prev) => !prev)}
                disabled={saving || pickingPhoto}
                style={{ position: 'relative' }}
              >
                <View
                  style={{
                    height: 104,
                    width: 104,
                    borderRadius: 52,
                    backgroundColor: '#E2E8F0',
                    borderWidth: 3.5,
                    borderColor: '#104D6B',
                    overflow: 'hidden',
                    justifyContent: 'center',
                    alignItems: 'center',
                    elevation: 3,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.18,
                    shadowRadius: 3,
                  }}
                >
                  <Image
                    source={
                      photoUri
                        ? { uri: photoUri }
                        : require('../../../assets/images/placeholder.png')
                    }
                    style={{ height: '100%', width: '100%' }}
                    resizeMode="cover"
                  />
                  {pickingPhoto && (
                    <View
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.45)',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    </View>
                  )}
                </View>

                {/* CAMERA BADGE */}
                <View
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    backgroundColor: '#0d4761',
                    borderRadius: 16,
                    width: 32,
                    height: 32,
                    borderWidth: 2.5,
                    borderColor: '#FFFFFF',
                    justifyContent: 'center',
                    alignItems: 'center',
                    elevation: 4,
                  }}
                >
                  <Ionicons name="camera" size={15} color="#FFFFFF" />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setShowPhotoOptions((prev) => !prev)}
                disabled={saving || pickingPhoto}
                className="mt-2"
              >
                <Text className="text-xs font-bold text-[#104D6B]">
                  Change Photo
                </Text>
              </TouchableOpacity>

              {/* PHOTO SOURCE OPTIONS DRAWER */}
              {showPhotoOptions && (
                <View className="w-full mt-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                  <Text className="text-xs font-bold text-slate-600 mb-2.5">
                    Select Photo Source:
                  </Text>
                  <View className="flex-row space-x-2">
                    <TouchableOpacity
                      onPress={() => handlePickPhoto('camera')}
                      className="flex-1 flex-row items-center justify-center py-2.5 px-3 rounded-xl bg-sky-50 border border-sky-200"
                    >
                      <Ionicons name="camera-outline" size={18} color="#0284C7" />
                      <Text className="ml-1.5 text-xs font-bold text-sky-700">
                        Camera
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handlePickPhoto('gallery')}
                      className="flex-1 flex-row items-center justify-center py-2.5 px-3 rounded-xl bg-amber-50 border border-amber-200"
                    >
                      <Ionicons name="images-outline" size={18} color="#D97706" />
                      <Text className="ml-1.5 text-xs font-bold text-amber-700">
                        Gallery
                      </Text>
                    </TouchableOpacity>

                    {Boolean(photoUri) && (
                      <TouchableOpacity
                        onPress={handleRemovePhoto}
                        className="flex-1 flex-row items-center justify-center py-2.5 px-3 rounded-xl bg-red-50 border border-red-200"
                      >
                        <Ionicons name="trash-outline" size={18} color="#DC2626" />
                        <Text className="ml-1.5 text-xs font-bold text-red-600">
                          Remove
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}
            </View>

            {/* BASIC INFORMATION FIELDS */}
            <View className="mt-2">
              <InputField
                label="First Name"
                placeholder="e.g. Juan"
                value={firstName}
                onChangeText={(val) => {
                  setFirstName(val);
                  if (errors.firstName) setErrors((prev) => ({ ...prev, firstName: null }));
                }}
                error={errors.firstName}
              />

              <InputField
                label="Last Name"
                placeholder="e.g. Dela Cruz"
                value={lastName}
                onChangeText={(val) => {
                  setLastName(val);
                  if (errors.lastName) setErrors((prev) => ({ ...prev, lastName: null }));
                }}
                error={errors.lastName}
              />

              <InputField
                label="Birthday"
                placeholder="YYYY-MM-DD (e.g. 1992-06-15)"
                value={birthdate}
                onChangeText={(val) => {
                  setBirthdate(val);
                  if (errors.birthdate) setErrors((prev) => ({ ...prev, birthdate: null }));
                }}
                error={errors.birthdate}
                keyboardType="numbers-and-punctuation"
              />

              <ContactField
                label="Mobile Number"
                value={phoneDigits}
                onChangeText={(val) => {
                  setPhoneDigits(val);
                  if (errors.phone) setErrors((prev) => ({ ...prev, phone: null }));
                }}
                error={errors.phone}
              />
            </View>

            {/* SUPERVISOR SCOPE NOTICE */}
            <View className="my-2 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex-row items-start">
              <Ionicons name="information-circle-outline" size={18} color="#64748B" style={{ marginTop: 1 }} />
              <Text className="flex-1 ml-2 text-[11px] leading-4 text-slate-500">
                Account credentials (username, password, roles) and assigned vehicle details are managed by plant supervisors and cannot be altered here.
              </Text>
            </View>

            {/* ACTION BUTTONS */}
            <View className="mt-4">
              <PrimaryButton
                title="SAVE CHANGES"
                onPress={handleSave}
                loading={saving}
                className="mb-2"
              />

              <TouchableOpacity
                onPress={onClose}
                disabled={saving}
                className="py-3 items-center"
              >
                <Text className="text-sm font-semibold text-slate-500">
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
      </View>
    </BottomSheetModal>
  );
};

export default EditProfileModal;
