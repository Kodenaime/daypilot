import React, { useState, useEffect } from 'react';
import { View, Button, ActivityIndicator, DeviceEventEmitter } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

import { DisplayText, HeadingText, BodyText, CaptionText } from '../components/Typography';
import { BASE_URL } from '../api/client';

// ----------------------------------------------------
// Placeholder Screens
// ----------------------------------------------------

// Onboarding Stack Screens
function SplashScreen({ navigation }: any) {
  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.navigate('GoogleSignIn');
    }, 2000);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-xl gap-xl">
      <View className="items-center gap-md">
        {/* Brand Logo Box */}
        <View className="w-20 h-20 rounded-[24px] bg-primary-light dark:bg-primary-dark items-center justify-center shadow-2xl">
          <View className="w-10 h-10 rounded-full border-4 border-white justify-center items-center">
            {/* Minimalist Compass Pointer */}
            <View className="w-1 h-4 bg-white rounded-full absolute top-1" />
            <View className="w-2 h-2 rounded-full bg-white" />
          </View>
        </View>
        
        <View className="items-center mt-md">
          <DisplayText className="text-text-primary-light dark:text-text-primary-dark font-extrabold text-center tracking-widest">
            DayPilot
          </DisplayText>
          <CaptionText className="text-text-secondary-light dark:text-text-secondary-dark text-center mt-xs">
            Your day, navigated.
          </CaptionText>
        </View>
      </View>

      <View className="mt-xl">
        <ActivityIndicator size="small" color="#0066FF" />
      </View>
    </View>
  );
}

function GoogleSignInScreen({ navigation, route }: any) {
  const { setAuth } = route?.params || {};
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Helper to resolve the correct backend IP dynamically on physical devices running via Expo CLI LAN
  const getBackendUrl = () => {
    const initialUrl = Linking.createURL('');
    const match = initialUrl.match(/exp:\/\/([^:/]+)/);
    if (match && match[1] && (match[1].startsWith('192.168.') || match[1].startsWith('10.') || match[1].startsWith('172.'))) {
      return `http://${match[1]}:3000`;
    }
    return BASE_URL || 'http://localhost:3000';
  };

  const handleDeepLink = async (event: { url: string }) => {
    console.log('Incoming deep link callback URL:', event.url);
    WebBrowser.dismissBrowser();
    
    // Parse URL and extract JWT token
    const parsed = Linking.parse(event.url);
    const token = parsed.queryParams?.token;
    
    if (token) {
      try {
        await SecureStore.setItemAsync('user_jwt_token', token as string);
        setAuth?.(true); // Transition state to Authenticated
        navigation.navigate('CalendarPermission');
      } catch (err) {
        console.error('Failed to securely store token:', err);
      }
    }
    setIsAuthenticating(false);
  };

  useEffect(() => {
    const subscription = Linking.addEventListener('url', handleDeepLink);

    // Check if the app was launched directly from an auth callback URL
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink({ url });
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const handleGoogleSignIn = async () => {
    setIsAuthenticating(true);
    const targetUrl = `${getBackendUrl()}/auth/google?platform=mobile`;
    console.log('Launching in-app browser to OAuth endpoint:', targetUrl);
    try {
      await WebBrowser.openBrowserAsync(targetUrl);
    } catch (error) {
      console.error('Failed to open web browser overlay:', error);
      setIsAuthenticating(false);
    }
  };

  return (
    <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-xl gap-xl">
      <View className="items-center gap-md">
        {/* Brand Logo Box */}
        <View className="w-16 h-16 rounded-[20px] bg-primary-light dark:bg-primary-dark items-center justify-center shadow-lg">
          <View className="w-8 h-8 rounded-full border-2 border-white justify-center items-center">
            <View className="w-0.5 h-3 bg-white rounded-full absolute top-0.5" />
            <View className="w-1.5 h-1.5 rounded-full bg-white" />
          </View>
        </View>
        
        <View className="items-center mt-sm">
          <HeadingText className="text-text-primary-light dark:text-text-primary-dark font-bold text-center">
            Sign In with Google
          </HeadingText>
          <CaptionText className="text-center mt-xs px-md">
            Connect your calendar to sync events and organize tasks.
          </CaptionText>
        </View>
      </View>

      <View className="w-full px-lg mt-md gap-md">
        {isAuthenticating ? (
          <ActivityIndicator size="small" color="#0066FF" />
        ) : (
          <Button
            title="Sign In with Google"
            onPress={handleGoogleSignIn}
            color="#0066FF"
          />
        )}
      </View>
    </View>
  );
}

function CalendarPermissionScreen({ navigation, route }: any) {
  // Use route.params to toggle the auth state
  const { setAuth } = route.params || {};
  return (
    <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-md gap-md">
      <HeadingText className="text-center">Calendar Permission & Initial Sync</HeadingText>
      <BodyText className="text-center">Grant access to sync your events</BodyText>
      <Button title="Simulate Sign-In (Go to App)" onPress={() => setAuth?.(true)} />
    </View>
  );
}

// Today Tab Stack Screens
function TodayScreen({ navigation, route }: any) {
  const { setAuth } = route.params || {};
  return (
    <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-md gap-md">
      <DisplayText className="text-primary-light dark:text-primary-dark">Today View</DisplayText>
      <BodyText className="text-center">Your tasks for today</BodyText>
      <View className="gap-sm self-stretch px-md">
        <Button title="Go to Task Detail" onPress={() => navigation.navigate('TaskDetail', { taskId: '123' })} />
        <Button title="Create Standalone Task" onPress={() => navigation.navigate('CreateTask')} />
        <Button title="View Overdue List" onPress={() => navigation.navigate('OverdueList')} />
      </View>
      <Button title="Log Out" color="red" onPress={async () => {
        await SecureStore.deleteItemAsync('user_jwt_token');
        setAuth?.(false);
      }} />
    </View>
  );
}

function TaskDetailScreen({ route, navigation }: any) {
  const { taskId } = route.params || {};
  return (
    <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-md gap-md">
      <HeadingText>Task Detail View</HeadingText>
      <BodyText>Task ID: {taskId}</BodyText>
      <Button title="Go Back" onPress={() => navigation.goBack()} />
    </View>
  );
}

function CreateTaskScreen({ navigation }: any) {
  return (
    <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-md gap-md">
      <HeadingText>Create Task View</HeadingText>
      <Button title="Go Back" onPress={() => navigation.goBack()} />
    </View>
  );
}

function OverdueListScreen({ navigation }: any) {
  return (
    <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-md gap-md">
      {/* Accent color token used specifically for overdue urgency indicators */}
      <HeadingText className="text-accent-light dark:text-accent-dark">Overdue Tasks View</HeadingText>
      <Button title="Go Back" onPress={() => navigation.goBack()} />
    </View>
  );
}

// Templates Tab Stack Screens
function TemplatesScreen({ navigation }: any) {
  return (
    <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-md gap-md">
      <HeadingText>Recurrence Templates View</HeadingText>
      <BodyText className="text-center">Manage your repeating tasks</BodyText>
      <Button title="Create Template" onPress={() => navigation.navigate('CreateTemplate')} />
    </View>
  );
}

// Settings Tab Screen
function SettingsScreen({ route }: any) {
  const { setAuth } = route.params || {};
  return (
    <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-md gap-md">
      <HeadingText>Settings View</HeadingText>
      <Button title="Log Out" color="red" onPress={async () => {
        await SecureStore.deleteItemAsync('user_jwt_token');
        setAuth?.(false);
      }} />
    </View>
  );
}

function CreateTemplateScreen({ navigation }: any) {
  return (
    <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-md gap-md">
      <HeadingText>Create Template View</HeadingText>
      <Button title="Go Back" onPress={() => navigation.goBack()} />
    </View>
  );
}

// ----------------------------------------------------
// Navigation Containers
// ----------------------------------------------------

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Onboarding Flow Stack
function OnboardingStack({ setAuth }: { setAuth: (val: boolean) => void }) {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="GoogleSignIn" component={GoogleSignInScreen} options={{ title: 'Sign In' }} />
      <Stack.Screen
        name="CalendarPermission"
        component={CalendarPermissionScreen}
        options={{ title: 'Sync Calendar' }}
        initialParams={{ setAuth }}
      />
    </Stack.Navigator>
  );
}

// Today Tab Sub-Stack
function TodayTabStack({ setAuth }: { setAuth: (val: boolean) => void }) {
  return (
    <Stack.Navigator>
      <Stack.Screen name="TodayMain" component={TodayScreen} options={{ title: 'Today' }} initialParams={{ setAuth }} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: 'Task Details' }} />
      <Stack.Screen name="CreateTask" component={CreateTaskScreen} options={{ title: 'New Task' }} />
      <Stack.Screen name="OverdueList" component={OverdueListScreen} options={{ title: 'Overdue List' }} />
    </Stack.Navigator>
  );
}

// Templates Tab Sub-Stack
function TemplatesTabStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="TemplatesMain" component={TemplatesScreen} options={{ title: 'Templates' }} />
      <Stack.Screen name="CreateTemplate" component={CreateTemplateScreen} options={{ title: 'New Template' }} />
    </Stack.Navigator>
  );
}

// Main App Bottom Tab Navigator
function MainTabs({ setAuth }: { setAuth: (val: boolean) => void }) {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="TodayTab" options={{ title: 'Today' }}>
        {(props) => <TodayTabStack {...props} setAuth={setAuth} />}
      </Tab.Screen>
      <Tab.Screen name="TemplatesTab" component={TemplatesTabStack} options={{ title: 'Templates' }} />
      <Tab.Screen name="SettingsTab" options={{ title: 'Settings' }}>
        {(props) => <SettingsScreen {...props} route={{ params: { setAuth } }} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

// Root Navigation Router Switcher
export default function RootNavigator() {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  useEffect(() => {
    async function checkAuthentication() {
      try {
        const storedToken = await SecureStore.getItemAsync('user_jwt_token');
        if (storedToken) {
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error('Failed to read auth token from SecureStore:', error);
      } finally {
        setIsLoading(false);
      }
    }
    checkAuthentication();

    // Listen for global 401 unauthorized session expiration events
    const subscription = DeviceEventEmitter.addListener('UNAUTHORIZED_LOGOUT', () => {
      console.log('Received global UNAUTHORIZED_LOGOUT event. Redirecting to onboarding stack.');
      setIsAuthenticated(false);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  if (isLoading) {
    // Elegant loading splash state
    return (
      <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-xl gap-xl">
        <View className="items-center gap-md">
          <View className="w-20 h-20 rounded-[24px] bg-primary-light dark:bg-primary-dark items-center justify-center shadow-2xl">
            <View className="w-10 h-10 rounded-full border-4 border-white justify-center items-center">
              <View className="w-1 h-4 bg-white rounded-full absolute top-1" />
              <View className="w-2 h-2 rounded-full bg-white" />
            </View>
          </View>
          <View className="items-center mt-md">
            <DisplayText className="text-text-primary-light dark:text-text-primary-dark font-extrabold text-center tracking-widest">
              DayPilot
            </DisplayText>
            <CaptionText className="text-text-secondary-light dark:text-text-secondary-dark text-center mt-xs">
              Your day, navigated.
            </CaptionText>
          </View>
        </View>
        <View className="mt-xl">
          <ActivityIndicator size="small" color="#0066FF" />
        </View>
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated ? (
        <Stack.Screen name="MainFlow">
          {(props) => <MainTabs {...props} setAuth={setIsAuthenticated} />}
        </Stack.Screen>
      ) : (
        <Stack.Screen name="OnboardingFlow">
          {(props) => <OnboardingStack {...props} setAuth={setIsAuthenticated} />}
        </Stack.Screen>
      )}
    </Stack.Navigator>
  );
}
