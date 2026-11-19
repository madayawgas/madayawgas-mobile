import { UserSession } from '@/types';
import { authApi } from '../api/endpoints/authApi';
import { setActiveDatabaseUser } from '@/database';
import {
  sessionStore,
  AuthSessionListener,
  AuthSessionReason,
} from './sessionStore';

export const authService = {
  /**
   * Subscribes to authentication session state changes.
   * Useful for root coordinators (e.g. App.js) to react to login, logout, and revocation events.
   */
  subscribe(listener: AuthSessionListener): () => void {
    return sessionStore.subscribe(listener);
  },

  /**
   * Universal login method for the mobile application.
   * Authenticates against live authApi and persists session in SecureStore.
   */
  async login(credentials: { username: string; password: string }): Promise<UserSession> {
    const authResult = await authApi.login(credentials);
    if (!authResult?.user) {
      throw new Error('Invalid authentication response structure');
    }
    const token = authResult.token || `session-${authResult.user.id}`;
    await setActiveDatabaseUser(authResult.user.id);
    return sessionStore.saveSession(authResult.user, token);
  },

  /**
   * Retrieves the stored auth Bearer token.
   */
  async getStoredToken(): Promise<string | null> {
    return sessionStore.getStoredToken();
  },

  /**
   * Retrieves the parsed cached UserSession.
   */
  async getSession(): Promise<UserSession | null> {
    return sessionStore.getSession();
  },

  /**
   * Persists user and token into SecureStore and broadcasts to subscribers.
   */
  async saveSession(user: Omit<UserSession, 'token' | 'savedAt'>, token: string): Promise<UserSession> {
    return sessionStore.saveSession(user, token);
  },

  /**
   * Updates cached user fields (e.g. avatar, name) and broadcasts to subscribers.
   */
  async updateUser(updatedFields: Partial<UserSession>): Promise<UserSession | null> {
    return sessionStore.updateUser(updatedFields);
  },

  /**
   * Clears the current persistent session.
   * Accepts an optional reason: 'logout' (default) or 'revoked' (when 401 is received from backend).
   * Revocation calls are debounced to prevent duplicate alerts from concurrent requests.
   */
  async clearSession(reason: AuthSessionReason = 'logout'): Promise<void> {
    await sessionStore.clearSession(reason);
    await setActiveDatabaseUser(null);
  },

  /**
   * Universal change password method.
   * Submits new password to backend. On backend success, sessions are revoked.
   */
  async changePassword(newPassword: string, currentPassword?: string): Promise<void> {
    await authApi.changePassword({ newPassword, currentPassword });
  },

  /**
   * Checks if an authentication token exists in storage.
   */
  async isAuthenticated(): Promise<boolean> {
    return sessionStore.isAuthenticated();
  },
};
