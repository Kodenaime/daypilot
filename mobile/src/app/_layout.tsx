import React, { useEffect, useState } from 'react';
import { useColorScheme, DeviceEventEmitter } from 'react-native';
import { useColorScheme as useTailwindColorScheme } from 'nativewind';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer, NavigationIndependentTree } from '@react-navigation/native';
import { useFonts, Inter_400Regular, Inter_700Bold } from '@expo-google-fonts/inter';
import * as SecureStore from 'expo-secure-store';
import RootNavigator from '../navigation/RootNavigator';
import '../global.css';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

const queryClient = new QueryClient();

export default function TabLayout() {
  const systemColorScheme = useColorScheme();
  const { setColorScheme } = useTailwindColorScheme();
  const [themePreference, setThemePreference] = useState<'light' | 'dark' | 'system'>('system');

  // Load theme preference on mount and listen to changes
  useEffect(() => {
    SecureStore.getItemAsync('theme_preference').then((val) => {
      if (val === 'light' || val === 'dark' || val === 'system') {
        setThemePreference(val);
      }
    });

    const sub = DeviceEventEmitter.addListener('THEME_PREFERENCE_CHANGED', (newPref) => {
      setThemePreference(newPref);
    });
    return () => sub.remove();
  }, []);

  const activeColorScheme = themePreference === 'system' ? systemColorScheme : themePreference;

  // Keep Tailwind color scheme in sync with override or system
  useEffect(() => {
    setColorScheme(activeColorScheme === 'dark' ? 'dark' : 'light');
  }, [activeColorScheme]);

  // Load Inter fonts dynamically
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_700Bold,
  });

  // Custom navigation theme mapping the design token parameters
  const theme = activeColorScheme === 'dark' ? {
    dark: true,
    colors: {
      primary: '#3D8BFF', // Dark Mode color-primary
      background: '#0E0E10', // Dark Mode color-background
      card: '#1A1A1D', // Dark Mode color-surface
      text: '#F2F2F3', // Dark Mode color-text-primary
      border: '#2A2A2E', // Dark Mode color-border
      notification: '#FF6433', // Dark Mode color-accent
    },
    fonts: {
      regular: { fontFamily: 'Inter_400Regular', fontWeight: '400' as const },
      medium: { fontFamily: 'Inter_400Regular', fontWeight: '500' as const },
      bold: { fontFamily: 'Inter_700Bold', fontWeight: '700' as const },
      heavy: { fontFamily: 'Inter_700Bold', fontWeight: '800' as const },
    }
  } : {
    dark: false,
    colors: {
      primary: '#0066FF', // Light Mode color-primary
      background: '#FFFFFF', // Light Mode color-background
      card: '#F7F8FA', // Light Mode color-surface
      text: '#1A1A1D', // Light Mode color-text-primary
      border: '#E5E6E8', // Light Mode color-border
      notification: '#FF4500', // Light Mode color-accent
    },
    fonts: {
      regular: { fontFamily: 'Inter_400Regular', fontWeight: '400' as const },
      medium: { fontFamily: 'Inter_400Regular', fontWeight: '500' as const },
      bold: { fontFamily: 'Inter_700Bold', fontWeight: '700' as const },
      heavy: { fontFamily: 'Inter_700Bold', fontWeight: '800' as const },
    }
  };

  if (!fontsLoaded) {
    return null; // Return null until fonts are successfully loaded to prevent flashes of unstyled layout
  }

  return (
    <QueryClientProvider client={queryClient}>
      <NavigationIndependentTree>
        <NavigationContainer theme={theme}>
          <AnimatedSplashOverlay />
          <RootNavigator />
        </NavigationContainer>
      </NavigationIndependentTree>
    </QueryClientProvider>
  );
}
