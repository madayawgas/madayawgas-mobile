import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { ENV } from '@/config';
import { apiClient, ApiError } from '../client';
import { sessionStore } from '@/services/sessionStore';
import { networkSentinel } from '@/sync/networkSentinel';
import { resolveMediaUrl } from '@/utils/mediaResolver';
import {
  UserProfileResponseData,
  UploadAvatarResponseData,
  UpdateProfileRequest,
} from '@/types';

const AVATAR_UPLOAD_TIMEOUT_MS = 10000; // 10s timeout limit

const normalizeProfileUser = (user: any) => {
  if (!user) return user;
  return {
    ...user,
    avatarUrl: resolveMediaUrl(user.avatarUrl),
  };
};

export const userApi = {
  /**
   * Fetches current user profile and permissions from /api/users/me
   */
  async getProfile(): Promise<UserProfileResponseData> {
    const res = await apiClient<UserProfileResponseData>('/users/me', {
      method: 'GET',
    });
    if (res.data?.user) {
      res.data.user = normalizeProfileUser(res.data.user);
    }
    if (res.data?.avatarUrl) {
      res.data.avatarUrl = resolveMediaUrl(res.data.avatarUrl);
    }
    return res.data;
  },

  /**
   * Updates personal profile information (firstName, lastName, phone, birthdate, avatarMediaKey)
   */
  async updateProfile(data: UpdateProfileRequest): Promise<UserProfileResponseData> {
    const res = await apiClient<UserProfileResponseData>('/users/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (res.data?.user) {
      res.data.user = normalizeProfileUser(res.data.user);
    }
    if (res.data?.avatarUrl) {
      res.data.avatarUrl = resolveMediaUrl(res.data.avatarUrl);
    }
    return res.data;
  },

  /**
   * Uploads/replaces own profile picture via POST /api/users/me/avatar
   * Uses multipart/form-data with field 'avatar'.
   */
  async uploadAvatar(localUri: string): Promise<UploadAvatarResponseData> {
    const uploadUrl = `${ENV.API_URL}/users/me/avatar`;
    const token = await sessionStore.getStoredToken();

    try {
      if (Platform.OS === 'web') {
        const blob = await fetch(localUri).then((r) => r.blob());
        const formData = new FormData();
        formData.append('avatar', blob, 'avatar.jpg');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), AVATAR_UPLOAD_TIMEOUT_MS);

        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: formData,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errData = await response.json().catch(() => null);
          throw new ApiError(
            errData?.message || `HTTP ${response.status}: Avatar upload failed`,
            response.status,
            errData
          );
        }

        const json = await response.json();
        const rawUrl = json.data?.avatarUrl || json.data?.user?.avatarUrl;
        return {
          user: normalizeProfileUser(json.data?.user),
          avatarUrl: resolveMediaUrl(rawUrl) || rawUrl,
          avatarMediaKey: json.data?.avatarMediaKey || json.data?.user?.avatarMediaKey,
        };
      }

      // Native iOS / Android upload via FileSystem
      const uploadPromise = FileSystem.uploadAsync(uploadUrl, localUri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'avatar',
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new ApiError(`Avatar upload timed out (${AVATAR_UPLOAD_TIMEOUT_MS}ms limit)`, 408)),
          AVATAR_UPLOAD_TIMEOUT_MS
        )
      );

      const uploadTask = await Promise.race([uploadPromise, timeoutPromise]);

      if (uploadTask.status >= 200 && uploadTask.status < 300) {
        const json = JSON.parse(uploadTask.body);
        const rawUrl = json.data?.avatarUrl || json.data?.user?.avatarUrl;
        return {
          user: normalizeProfileUser(json.data?.user),
          avatarUrl: resolveMediaUrl(rawUrl) || rawUrl,
          avatarMediaKey: json.data?.avatarMediaKey || json.data?.user?.avatarMediaKey,
        };
      }

      let parsedErr: any = null;
      try {
        parsedErr = JSON.parse(uploadTask.body);
      } catch {}

      if (uploadTask.status === 401) {
        await sessionStore.clearSession('revoked');
      }

      throw new ApiError(
        parsedErr?.message || `HTTP ${uploadTask.status}: Avatar upload failed`,
        uploadTask.status,
        parsedErr
      );
    } catch (error: any) {
      if (error instanceof ApiError && error.status === 408) {
        networkSentinel.reportNetworkFailure();
      } else if (!(error instanceof ApiError)) {
        networkSentinel.reportNetworkFailure();
      }
      throw error;
    }
  },

  /**
   * Removes current user's profile picture via DELETE /api/users/me/avatar
   */
  async deleteAvatar(): Promise<UserProfileResponseData> {
    const res = await apiClient<UserProfileResponseData>('/users/me/avatar', {
      method: 'DELETE',
    });
    return res.data;
  },
};
