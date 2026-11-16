import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { mediaService } from '@/services/mediaService';
import { authService } from '@/services/authService';
import PrimaryButton from '@/components/ui/PrimaryButton';
import BottomSheetModal from '@/components/ui/BottomSheetModal';

const AvatarEditModal = ({
  visible,
  onClose,
  currentAvatarUrl,
  onAvatarUpdated,
}) => {
  const [previewUri, setPreviewUri] = useState(null);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const resetState = () => {
    setPreviewUri(null);
    setPicking(false);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    resetState();
    onClose();
  };

  const handlePick = async (source) => {
    try {
      setPicking(true);
      const uri = await mediaService.pickAndCompressAvatar(source);
      if (uri) {
        setPreviewUri(uri);
      }
    } catch (err) {
      Alert.alert(
        'Image Error',
        err.message || 'Unable to process image. Please try again.'
      );
    } finally {
      setPicking(false);
    }
  };

  const handleConfirmSave = async () => {
    if (!previewUri) return;

    try {
      setSubmitting(true);
      const result = await mediaService.uploadAvatar(previewUri);

      const resolvedUrl = result.avatarUrl || previewUri;
      const resolvedKey = result.avatarMediaKey || null;

      await authService.updateUser({
        avatarUrl: resolvedUrl,
        avatarMediaKey: resolvedKey,
      });

      if (onAvatarUpdated) {
        onAvatarUpdated(resolvedUrl);
      }

      Alert.alert(
        'Photo Updated',
        'Your profile photo has been updated successfully.'
      );
      handleClose();
    } catch (err) {
      Alert.alert(
        'Upload Failed',
        err.message || 'Failed to upload profile photo. Please check your internet connection.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemovePhoto = () => {
    Alert.alert(
      'Remove Photo',
      'Are you sure you want to remove your profile photo? This will revert your avatar to the default image.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setSubmitting(true);
              await mediaService.deleteAvatar();

              await authService.updateUser({
                avatarUrl: null,
                avatarMediaKey: null,
              });

              if (onAvatarUpdated) {
                onAvatarUpdated(null);
              }

              Alert.alert(
                'Photo Removed',
                'Your profile photo has been reset to default.'
              );
              handleClose();
            } catch (err) {
              Alert.alert(
                'Remove Failed',
                err.message || 'Failed to remove profile photo. Please check your internet connection.'
              );
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <BottomSheetModal
      visible={visible}
      onClose={handleClose}
      dismissible={!submitting}
      backdropOpacity={0.6}
    >
      <View className="bg-white rounded-t-[32px] p-6 pb-8">
          {/* DRAG HANDLE BAR */}
          <View className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-4" />

          {/* PREVIEW STATE */}
          {previewUri ? (
            <View className="items-center">
              <Text className="text-xl font-bold text-[#104D6B] mb-1">
                Preview Photo
              </Text>
              <Text className="text-xs text-slate-500 mb-6 text-center">
                Review your cropped photo before saving as your profile picture.
              </Text>

              {/* CIRCULAR PREVIEW */}
              <View
                style={{
                  height: 140,
                  width: 140,
                  borderRadius: 70,
                  backgroundColor: '#E2E8F0',
                  borderWidth: 4,
                  borderColor: '#104D6B',
                  overflow: 'hidden',
                  justifyContent: 'center',
                  alignItems: 'center',
                  elevation: 5,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.2,
                  shadowRadius: 4,
                  marginBottom: 24,
                }}
              >
                <Image
                  source={{ uri: previewUri }}
                  style={{ height: '100%', width: '100%' }}
                  resizeMode="cover"
                />
              </View>

              {/* ACTION BUTTONS */}
              <View className="w-full">
                <PrimaryButton
                  title="SAVE PROFILE PHOTO"
                  onPress={handleConfirmSave}
                  loading={submitting}
                  className="mb-2"
                />

                <PrimaryButton
                  title="CHOOSE ANOTHER"
                  variant="outline"
                  onPress={() => setPreviewUri(null)}
                  disabled={submitting}
                  className="mb-2"
                />

                <TouchableOpacity
                  onPress={handleClose}
                  disabled={submitting}
                  className="py-3 items-center"
                >
                  <Text className="text-sm font-semibold text-slate-400">
                    Cancel
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            /* ACTION SHEET SELECTION STATE */
            <View>
              {/* HEADER */}
              <View className="flex-row items-center justify-between pb-3 border-b border-slate-100 mb-4">
                <View>
                  <Text className="text-xl font-bold text-[#104D6B]">
                    Profile Photo
                  </Text>
                  <Text className="text-xs text-slate-500 mt-0.5">
                    Update or manage your cabin avatar
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={handleClose}
                  disabled={picking || submitting}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  className="p-1 rounded-full bg-slate-100"
                >
                  <Ionicons name="close" size={20} color="#64748B" />
                </TouchableOpacity>
              </View>

              {/* LOADING INDICATOR FOR PICKER */}
              {picking && (
                <View className="py-6 items-center justify-center">
                  <ActivityIndicator size="large" color="#0d4761" />
                  <Text className="text-xs text-slate-500 mt-2 font-medium">
                    Opening camera or gallery...
                  </Text>
                </View>
              )}

              {!picking && (
                <View className="space-y-3">
                  {/* OPTION: TAKE PHOTO */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => handlePick('camera')}
                    className="flex-row items-center p-3.5 rounded-2xl bg-slate-50 border border-slate-100 active:bg-slate-100"
                  >
                    <View className="w-11 h-11 rounded-full bg-sky-100 items-center justify-center mr-3.5">
                      <Ionicons name="camera-outline" size={22} color="#0284C7" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-bold text-slate-800">
                        Take Photo
                      </Text>
                      <Text className="text-xs text-slate-500">
                        Capture a new photo with your camera
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                  </TouchableOpacity>

                  {/* OPTION: CHOOSE FROM GALLERY */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => handlePick('gallery')}
                    className="flex-row items-center p-3.5 rounded-2xl bg-slate-50 border border-slate-100 active:bg-slate-100"
                  >
                    <View className="w-11 h-11 rounded-full bg-amber-100 items-center justify-center mr-3.5">
                      <Ionicons name="images-outline" size={22} color="#D97706" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-bold text-slate-800">
                        Choose from Gallery
                      </Text>
                      <Text className="text-xs text-slate-500">
                        Select an existing picture from your device
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                  </TouchableOpacity>

                  {/* OPTION: REMOVE PHOTO (CONDITIONAL) */}
                  {Boolean(currentAvatarUrl) && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={handleRemovePhoto}
                      disabled={submitting}
                      className="flex-row items-center p-3.5 rounded-2xl bg-red-50/60 border border-red-100 active:bg-red-100"
                    >
                      <View className="w-11 h-11 rounded-full bg-red-100 items-center justify-center mr-3.5">
                        <Ionicons name="trash-outline" size={20} color="#DC2626" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-bold text-red-600">
                          Remove Current Photo
                        </Text>
                        <Text className="text-xs text-red-400">
                          Reset to the default system avatar
                        </Text>
                      </View>
                      {submitting ? (
                        <ActivityIndicator size="small" color="#DC2626" />
                      ) : (
                        <Ionicons name="chevron-forward" size={18} color="#F87171" />
                      )}
                    </TouchableOpacity>
                  )}

                  {/* CANCEL BUTTON */}
                  <TouchableOpacity
                    onPress={handleClose}
                    className="py-3 items-center mt-2"
                  >
                    <Text className="text-sm font-bold text-slate-500">
                      Cancel
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
      </View>
    </BottomSheetModal>
  );
};

export default AvatarEditModal;
