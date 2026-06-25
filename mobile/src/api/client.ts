import { Platform, DeviceEventEmitter } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const BASE_URL = Platform.select({
  android: 'http://10.0.2.2:3000',
  ios: 'http://localhost:3000',
  default: 'http://localhost:3000',
});

export async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const url = `${BASE_URL}${path}`;
  
  // Retrieve token dynamically from SecureStore
  let token: string | null = null;
  try {
    token = await SecureStore.getItemAsync('user_jwt_token');
  } catch (e) {
    console.error('Failed to read JWT for fetch headers:', e);
  }

  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...options.headers,
    },
  });

  // Handle 401 Session Expiration
  if (response.status === 401) {
    try {
      await SecureStore.deleteItemAsync('user_jwt_token');
    } catch (e) {
      console.error('Failed to clear token during 401 logout:', e);
    }
    // Emit global event to force logout in navigator
    DeviceEventEmitter.emit('UNAUTHORIZED_LOGOUT');
    throw new Error('Session expired. Please log in again.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}
