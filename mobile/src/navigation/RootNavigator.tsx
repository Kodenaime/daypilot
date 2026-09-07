import React, { useState, useEffect } from 'react';
import { View, Button, ActivityIndicator, DeviceEventEmitter, FlatList, TextInput, TouchableOpacity, Alert, ScrollView, Platform, Switch } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import DateTimePicker from '@react-native-community/datetimepicker';
let messaging: any = null;
try {
  messaging = require('@react-native-firebase/messaging').default;
} catch (e) {
  console.log('[RootNavigator] React Native Firebase messaging not available in this environment.');
}

import { DisplayText, HeadingText, BodyText, CaptionText } from '../components/Typography';
import { BASE_URL, apiFetch } from '../api/client';
import { useTodayTasks, Task } from '../hooks/useTodayTasks';
import { TaskCard } from '../components/TaskCard';
import { FocusWidget } from '../components/FocusWidget';
import { useTaskDetail, useUpdateTask, useDeleteTask } from '../hooks/useTaskDetail';
import { useCreateTask } from '../hooks/useCreateTask';
import { useCreateTemplate } from '../hooks/useCreateTemplate';
import { useTemplates, useTemplateDetail, useUpdateTemplate, useDeactivateTemplate } from '../hooks/useTemplates';
import { useOverdueTasks } from '../hooks/useOverdueTasks';
import { useUserProfile, useUpdateUserProfile } from '../hooks/useUserProfile';
import { useAllTasks } from '../hooks/useAllTasks';
import { useNextFocusTask } from '../hooks/useNextFocusTask';

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
          <DisplayText className="text-textPrimary-light dark:text-textPrimary-dark font-extrabold text-center tracking-widest">
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

  const getBackendUrl = () => {
    return BASE_URL;
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
    const redirectUri = Linking.createURL('');
    const targetUrl = `${getBackendUrl()}/auth/google?platform=mobile&redirect_uri=${encodeURIComponent(redirectUri)}`;
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
          <HeadingText className="text-textPrimary-light dark:text-textPrimary-dark font-bold text-center">
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
  const { setAuth } = route.params || {};
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      await apiFetch('/sync/initial', {
        method: 'POST'
      });
      console.log('[Calendar Sync] Initial sync completed successfully. Entering application.');
      setAuth?.(true);
    } catch (err: any) {
      console.error('[Calendar Sync] Initial sync failed:', err);
      setSyncError(err.message || 'Failed to complete initial calendar sync.');
      setIsSyncing(false);
    }
  };

  return (
    <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-xl gap-xl">
      <View className="items-center gap-md">
        <View className="w-16 h-16 rounded-[20px] bg-primary-light dark:bg-primary-dark items-center justify-center shadow-lg">
          <DisplayText className="text-white text-3xl">🗓️</DisplayText>
        </View>
        <HeadingText className="text-textPrimary-light dark:text-textPrimary-dark font-bold text-center mt-sm">
          Calendar Permission & Sync
        </HeadingText>
        <BodyText className="text-center text-textSecondary-light dark:text-textSecondary-dark px-md">
          We need permission to sync events from your Google Calendar to build your daily timeline.
        </BodyText>
      </View>

      <View className="w-full px-lg gap-md mt-md">
        {isSyncing ? (
          <View className="items-center gap-sm">
            <ActivityIndicator size="small" color="#0066FF" />
            <CaptionText className="text-textSecondary-light dark:text-textSecondary-dark">Syncing Google Calendar events...</CaptionText>
          </View>
        ) : (
          <>
            <Button
              title="Sync Google Calendar"
              onPress={handleSync}
              color="#0066FF"
            />
            {syncError && (
              <CaptionText className="text-accent-light dark:text-accent-dark text-center mt-xs">
                {syncError}
              </CaptionText>
            )}
            <TouchableOpacity onPress={() => setAuth?.(true)} className="mt-sm">
              <CaptionText className="text-primary-light dark:text-primary-dark font-semibold text-center text-sm">
                Skip & Go to App →
              </CaptionText>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

// Today Tab Stack Screens
function TodayScreen({ navigation }: any) {
  const { data: tasks, isLoading, error } = useTodayTasks();
  const { data: overdueTasks } = useOverdueTasks();
  const { data: focusData } = useNextFocusTask();
  
  const focusTask = focusData?.task;
  const focusTaskMutation = useUpdateTask(focusTask?.id || '');

  const overdueCount = overdueTasks?.length || 0;

  const sortedTasks = [...(tasks || [])].sort((a, b) => {
    const timeA = a.deadline_at ? new Date(a.deadline_at).getTime() : 0;
    const timeB = b.deadline_at ? new Date(b.deadline_at).getTime() : 0;
    return timeA - timeB;
  });

  const todayDateString = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <View className="flex-1 bg-background-light dark:bg-background-dark px-md pt-lg">
      {/* Premium Date Header */}
      <View className="mb-md">
        <View className="flex-row justify-between items-start">
          <View className="flex-1">
            <CaptionText className="text-primary-light dark:text-textPrimary-dark font-bold uppercase tracking-wider">
              {todayDateString}
            </CaptionText>
            <DisplayText className="text-textPrimary-light dark:text-textPrimary-dark font-extrabold text-3xl">
              Today
            </DisplayText>
          </View>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => navigation.navigate('AllTasks')}
            className="p-sm bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl"
          >
            <DisplayText className="text-lg">🔍</DisplayText>
          </TouchableOpacity>
        </View>
        
        {/* Sync Disclaimer */}
        <CaptionText className="text-text-secondary-light dark:text-text-secondary-dark mt-xs text-xs leading-5">
          ⚠️ Calendar sync may take a few minutes to reflect changes made directly in Google Calendar.
        </CaptionText>
      </View>

      {/* Overdue Badge / Indicator */}
      {overdueCount > 0 && (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => navigation.navigate('OverdueList')}
          className="bg-accent-light/10 border border-accent-light/30 p-sm rounded-xl mb-md flex-row justify-between items-center"
        >
          <View className="flex-row items-center gap-xs">
            <CaptionText className="text-accent-light dark:text-accent-dark font-bold text-sm">
              ⚠️ {overdueCount} Overdue Task{overdueCount > 1 ? 's' : ''}
            </CaptionText>
          </View>
          <CaptionText className="text-accent-light dark:text-accent-dark font-bold text-xs">
            View All →
          </CaptionText>
        </TouchableOpacity>
      )}

      {focusData && (
        <FocusWidget
          task={focusTask || null}
          onComplete={() => focusTaskMutation.mutate({ status: 'completed' })}
        />
      )}

      {isLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="small" color="#0066FF" />
        </View>
      ) : error ? (
        <View className="flex-1 justify-center items-center gap-sm">
          <BodyText className="text-accent-light dark:text-accent-dark font-semibold">
            Failed to load tasks
          </BodyText>
          <CaptionText className="text-center">
            {(error as Error).message}
          </CaptionText>
        </View>
      ) : sortedTasks.length === 0 ? (
        /* Friendly Empty State */
        <View className="flex-1 justify-center items-center p-lg gap-md">
          <View className="w-16 h-16 rounded-[20px] bg-surface-light dark:bg-surface-dark items-center justify-center border border-border-light dark:border-border-dark">
            <View className="w-8 h-8 rounded-full border-2 border-primary-light dark:border-primary-dark justify-center items-center opacity-40">
              <View className="w-0.5 h-3 bg-primary-light dark:bg-primary-dark rounded-full absolute top-0.5" />
              <View className="w-1.5 h-1.5 rounded-full bg-primary-light dark:bg-primary-dark" />
            </View>
          </View>
          <View className="items-center gap-xs">
            <HeadingText className="text-textPrimary-light dark:text-textPrimary-dark font-bold text-center">
              All caught up!
            </HeadingText>
            <CaptionText className="text-center px-lg">
              No tasks scheduled for today. Tap below to create one.
            </CaptionText>
          </View>
          <View className="mt-md">
            <Button
              title="Create Standalone Task"
              onPress={() => navigation.navigate('CreateTask')}
              color="#0066FF"
            />
          </View>
        </View>
      ) : (
        <FlatList
          data={sortedTasks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TaskCard
              task={item}
              onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })}
            />
          )}
          ItemSeparatorComponent={() => <View className="h-4" />} // space-md = 16px gap
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}

      {/* Floating Action Button (FAB) for creating tasks */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => navigation.navigate('CreateTask')}
        className="absolute bottom-6 right-6 w-14 h-14 bg-primary-light dark:bg-primary-dark rounded-full justify-center items-center shadow-lg"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 4.65,
          elevation: 8,
        }}
      >
        <DisplayText className="text-white text-3xl font-light">+</DisplayText>
      </TouchableOpacity>
    </View>
  );
}

function TaskDetailScreen({ route, navigation }: any) {
  const { taskId } = route.params || {};
  
  const { data: task, isLoading, error, refetch } = useTaskDetail(taskId);
  const updateMutation = useUpdateTask(taskId);
  const deleteMutation = useDeleteTask(taskId);

  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Sync state once task data fetches successfully
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDeadline(task.deadline_at ? new Date(task.deadline_at) : null);
    }
  }, [task]);

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark">
        <ActivityIndicator size="small" color="#0066FF" />
      </View>
    );
  }

  if (error || !task) {
    return (
      <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark p-md gap-md">
        <HeadingText className="text-accent-light dark:text-accent-dark">Error loading task details</HeadingText>
        <BodyText className="text-center">{(error as Error)?.message || 'Task not found.'}</BodyText>
        <Button title="Try Again" onPress={() => refetch()} />
        <Button title="Go Back" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const isGoogleTask = !!task.google_event_id;
  const isCompleted = task.status === 'completed';
  const hasRecurrence = !!(task as any).recurrence_template_id;

  const handleToggleCompletion = () => {
    const nextStatus = isCompleted ? 'pending' : 'completed';
    updateMutation.mutate({ status: nextStatus }, {
      onSuccess: () => {
        Alert.alert('Success', `Task marked as ${nextStatus === 'completed' ? 'complete' : 'pending'}.`);
      }
    });
  };

  const handleSaveChanges = () => {
    if (isGoogleTask) return;
    if (!title.trim()) {
      Alert.alert('Validation Error', 'Title cannot be empty.');
      return;
    }

    updateMutation.mutate({
      title: title.trim(),
      deadline_at: deadline ? deadline.toISOString() : null
    }, {
      onSuccess: () => {
        Alert.alert('Success', 'Task details saved successfully.');
      }
    });
  };

  const handleDeleteTask = () => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete this task? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteMutation.mutate(undefined, {
              onSuccess: () => {
                navigation.goBack();
              }
            });
          }
        }
      ]
    );
  };

  const handleDateChange = (_event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const currentDeadline = deadline || new Date();
      currentDeadline.setFullYear(selectedDate.getFullYear());
      currentDeadline.setMonth(selectedDate.getMonth());
      currentDeadline.setDate(selectedDate.getDate());
      setDeadline(new Date(currentDeadline));
    }
  };

  const handleTimeChange = (_event: any, selectedTime?: Date) => {
    setShowTimePicker(false);
    if (selectedTime) {
      const currentDeadline = deadline || new Date();
      currentDeadline.setHours(selectedTime.getHours());
      currentDeadline.setMinutes(selectedTime.getMinutes());
      setDeadline(new Date(currentDeadline));
    }
  };

  return (
    <ScrollView className="flex-1 bg-background-light dark:bg-background-dark px-md pt-lg">
      {/* Header Row */}
      <View className="flex-row justify-between items-center mb-lg">
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <CaptionText className="text-primary-light dark:text-primary-dark font-semibold text-base">
            ← Back
          </CaptionText>
        </TouchableOpacity>
        <HeadingText className="font-bold">Task Details</HeadingText>
        <View className="w-10" />
      </View>

      {/* Google Warning Banner */}
      {isGoogleTask && (
        <View className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark p-sm rounded-xl mb-md">
          <CaptionText className="text-text-secondary-light dark:text-text-secondary-dark text-xs text-center leading-5">
            ℹ️ This event is synced from Google Calendar. Title and deadline modifications can only be performed on the Calendar app directly.
          </CaptionText>
        </View>
      )}

      {/* Recurrence Template Badge */}
      {hasRecurrence && (
        <View className="bg-primary-light/10 self-start px-sm py-xs rounded-full mb-md flex-row items-center gap-xs">
          <View className="w-1.5 h-1.5 rounded-full bg-primary-light dark:bg-primary-dark" />
          <CaptionText className="text-primary-light dark:text-primary-dark text-xs font-semibold uppercase tracking-wider">
            🔁 Recurring Task
          </CaptionText>
        </View>
      )}

      {/* Input Group: Title */}
      <View className="mb-md">
        <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
          Title
        </CaptionText>
        <TextInput
          editable={!isGoogleTask}
          value={title}
          onChangeText={setTitle}
          className={`border border-border-light dark:border-border-dark p-md rounded-2xl text-textPrimary-light dark:text-textPrimary-dark text-base ${
            isGoogleTask ? 'bg-surface-light dark:bg-surface-dark opacity-70' : 'bg-card-light dark:bg-card-dark'
          }`}
        />
      </View>

      {/* Input Group: Deadline picker */}
      <View className="mb-lg">
        <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
          Deadline
        </CaptionText>
        <View className="border border-border-light dark:border-border-dark p-md rounded-2xl bg-card-light dark:bg-card-dark flex-row items-center justify-between">
          <BodyText className="text-textPrimary-light dark:text-textPrimary-dark font-medium">
            {deadline ? deadline.toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short'
            }) : 'No deadline'}
          </BodyText>
          {!isGoogleTask && (
            <View className="flex-row gap-xs">
              <TouchableOpacity
                onPress={() => setShowDatePicker(true)}
                className="bg-primary-light/10 px-sm py-xs rounded-lg"
              >
                <CaptionText className="text-primary-light dark:text-primary-dark font-bold text-xs">
                  Set Date
                </CaptionText>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowTimePicker(true)}
                className="bg-primary-light/10 px-sm py-xs rounded-lg"
              >
                <CaptionText className="text-primary-light dark:text-primary-dark font-bold text-xs">
                  Set Time
                </CaptionText>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Date Picker Components */}
      {showDatePicker && (
        <DateTimePicker
          value={deadline || new Date()}
          mode="date"
          display="default"
          onChange={handleDateChange}
        />
      )}
      {showTimePicker && (
        <DateTimePicker
          value={deadline || new Date()}
          mode="time"
          display="default"
          onChange={handleTimeChange}
        />
      )}

      {/* Action Buttons */}
      <View className="gap-md mt-md mb-xl">
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleToggleCompletion}
          disabled={updateMutation.isPending}
          className={`p-md rounded-2xl justify-center items-center ${
            isCompleted ? 'bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark' : 'bg-success-light dark:bg-success-dark'
          }`}
        >
          {updateMutation.isPending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <BodyText className={`font-bold ${isCompleted ? 'text-textPrimary-light dark:text-textPrimary-dark' : 'text-white'}`}>
              {isCompleted ? '↩️ Mark Incomplete' : '✅ Mark Complete'}
            </BodyText>
          )}
        </TouchableOpacity>

        {!isGoogleTask && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleSaveChanges}
            disabled={updateMutation.isPending}
            className="bg-primary-light dark:bg-primary-dark p-md rounded-2xl justify-center items-center"
          >
            {updateMutation.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <BodyText className="text-white font-bold">
                💾 Save Changes
              </BodyText>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleDeleteTask}
          disabled={deleteMutation.isPending}
          className="border border-red-500/30 p-md rounded-2xl justify-center items-center"
        >
          {deleteMutation.isPending ? (
            <ActivityIndicator size="small" color="red" />
          ) : (
            <BodyText className="text-red-500 font-bold">
              🗑️ Delete Task
            </BodyText>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function CreateTaskScreen({ navigation }: any) {
  const createTaskMutation = useCreateTask();
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const handleDateChange = (_event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const currentDeadline = deadline || new Date();
      currentDeadline.setFullYear(selectedDate.getFullYear());
      currentDeadline.setMonth(selectedDate.getMonth());
      currentDeadline.setDate(selectedDate.getDate());
      setDeadline(new Date(currentDeadline));
    }
  };

  const handleTimeChange = (_event: any, selectedTime?: Date) => {
    setShowTimePicker(false);
    if (selectedTime) {
      const currentDeadline = deadline || new Date();
      currentDeadline.setHours(selectedTime.getHours());
      currentDeadline.setMinutes(selectedTime.getMinutes());
      setDeadline(new Date(currentDeadline));
    }
  };

  const handleSave = () => {
    if (!title.trim()) {
      Alert.alert('Validation Error', 'Title is required.');
      return;
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    createTaskMutation.mutate({
      title: title.trim(),
      deadline_at: deadline ? deadline.toISOString() : null,
      timezone_snapshot: timezone
    }, {
      onSuccess: () => {
        navigation.goBack();
      },
      onError: (err) => {
        Alert.alert('Error', err.message || 'Failed to create task');
      }
    });
  };

  return (
    <ScrollView className="flex-1 bg-background-light dark:bg-background-dark px-md pt-lg">
      {/* Header Row */}
      <View className="flex-row justify-between items-center mb-lg">
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <CaptionText className="text-primary-light dark:text-primary-dark font-semibold text-base">
            ← Cancel
          </CaptionText>
        </TouchableOpacity>
        <HeadingText className="font-bold">New Task</HeadingText>
        <View className="w-10" />
      </View>

      {/* Input Group: Title */}
      <View className="mb-md">
        <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
          Title
        </CaptionText>
        <TextInput
          placeholder="What needs to be done?"
          placeholderTextColor="#999"
          value={title}
          onChangeText={setTitle}
          className="border border-border-light dark:border-border-dark p-md rounded-2xl text-textPrimary-light dark:text-textPrimary-dark text-base bg-card-light dark:bg-card-dark"
        />
      </View>

      {/* Input Group: Deadline picker */}
      <View className="mb-lg">
        <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
          Deadline (Optional)
        </CaptionText>
        <View className="border border-border-light dark:border-border-dark p-md rounded-2xl bg-card-light dark:bg-card-dark flex-row items-center justify-between">
          <BodyText className="text-textPrimary-light dark:text-textPrimary-dark font-medium">
            {deadline ? deadline.toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short'
            }) : 'No deadline'}
          </BodyText>
          <View className="flex-row gap-xs">
            <TouchableOpacity
              onPress={() => setShowDatePicker(true)}
              className="bg-primary-light/10 px-sm py-xs rounded-lg"
            >
              <CaptionText className="text-primary-light dark:text-primary-dark font-bold text-xs">
                Set Date
              </CaptionText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowTimePicker(true)}
              className="bg-primary-light/10 px-sm py-xs rounded-lg"
            >
              <CaptionText className="text-primary-light dark:text-primary-dark font-bold text-xs">
                Set Time
              </CaptionText>
            </TouchableOpacity>
            {deadline && (
              <TouchableOpacity
                onPress={() => setDeadline(null)}
                className="bg-red-500/10 px-sm py-xs rounded-lg"
              >
                <CaptionText className="text-red-500 font-bold text-xs">
                  Clear
                </CaptionText>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Date Picker Components */}
      {showDatePicker && (
        <DateTimePicker
          value={deadline || new Date()}
          mode="date"
          display="default"
          onChange={handleDateChange}
        />
      )}
      {showTimePicker && (
        <DateTimePicker
          value={deadline || new Date()}
          mode="time"
          display="default"
          onChange={handleTimeChange}
        />
      )}

      {/* Action Buttons */}
      <View className="gap-md mt-md mb-xl">
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleSave}
          disabled={createTaskMutation.isPending}
          className="bg-primary-light dark:bg-primary-dark p-md rounded-2xl justify-center items-center"
        >
          {createTaskMutation.isPending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <BodyText className="text-white font-bold">
              💾 Create Task
            </BodyText>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function OverdueListScreen({ navigation }: any) {
  const { data: overdueTasks, isLoading, error } = useOverdueTasks();

  const sortedOverdue = [...(overdueTasks || [])].sort((a, b) => {
    const timeA = a.deadline_at ? new Date(a.deadline_at).getTime() : 0;
    const timeB = b.deadline_at ? new Date(b.deadline_at).getTime() : 0;
    return timeA - timeB; // Oldest first
  });

  return (
    <View className="flex-1 bg-background-light dark:bg-background-dark px-md pt-lg">
      {/* Header Row */}
      <View className="flex-row justify-between items-center mb-lg">
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <CaptionText className="text-primary-light dark:text-primary-dark font-semibold text-base">
            ← Back
          </CaptionText>
        </TouchableOpacity>
        <HeadingText className="font-bold text-accent-light dark:text-accent-dark">⚠️ All Overdue Tasks</HeadingText>
        <View className="w-10" />
      </View>

      {isLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="small" color="#FF4500" />
        </View>
      ) : error ? (
        <View className="flex-1 justify-center items-center gap-sm">
          <BodyText className="text-accent-light font-semibold">Failed to load overdue tasks</BodyText>
        </View>
      ) : sortedOverdue.length === 0 ? (
        <View className="flex-1 justify-center items-center p-lg gap-sm">
          <DisplayText className="text-success-light text-center text-4xl">🎉</DisplayText>
          <HeadingText className="text-textPrimary-light dark:text-textPrimary-dark font-bold text-center mt-sm">No Overdue Tasks!</HeadingText>
          <CaptionText className="text-center">You are completely up to date.</CaptionText>
        </View>
      ) : (
        <FlatList
          data={sortedOverdue}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TaskCard
              task={item}
              onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })}
            />
          )}
          ItemSeparatorComponent={() => <View className="h-4" />}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

function AllTasksScreen({ navigation }: any) {
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'overdue'>('all');

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, 400);
    return () => clearTimeout(handler);
  }, [searchText]);

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useAllTasks({ search: debouncedSearch, status: statusFilter });

  const allTasks = data?.pages.flatMap((page) => page.tasks) || [];

  return (
    <View className="flex-1 bg-background-light dark:bg-background-dark px-md pt-lg">
      {/* Header Row */}
      <View className="flex-row justify-between items-center mb-md">
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <CaptionText className="text-primary-light dark:text-primary-dark font-semibold text-base">
            ← Back
          </CaptionText>
        </TouchableOpacity>
        <HeadingText className="font-bold text-textPrimary-light dark:text-textPrimary-dark">Search Tasks</HeadingText>
        <View className="w-10" />
      </View>

      {/* Search Input Box */}
      <View className="mb-md">
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search task title..."
          placeholderTextColor="#8E8E93"
          className="bg-surface-light dark:bg-surface-dark text-textPrimary-light dark:text-textPrimary-dark border border-border-light dark:border-border-dark px-md py-sm rounded-xl text-base"
        />
      </View>

      {/* Segmented/Filter Selector */}
      <View className="flex-row gap-xs mb-md">
        {(['all', 'pending', 'completed', 'overdue'] as const).map((s) => {
          const isSelected = statusFilter === s;
          const label = s.charAt(0).toUpperCase() + s.slice(1);
          return (
            <TouchableOpacity
              key={s}
              activeOpacity={0.8}
              onPress={() => setStatusFilter(s)}
              className={`flex-1 py-xs rounded-xl border items-center justify-center ${
                isSelected
                  ? 'bg-primary-light dark:bg-primary-dark border-primary-light dark:border-primary-dark'
                  : 'border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark'
              }`}
            >
              <CaptionText className={`font-bold ${isSelected ? 'text-white' : 'text-textSecondary-light dark:text-textSecondary-dark'} text-xs`}>
                {label}
              </CaptionText>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Dynamic Results List */}
      {isLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="small" color="#0066FF" />
        </View>
      ) : error ? (
        <View className="flex-1 justify-center items-center">
          <BodyText className="text-accent-light font-semibold">Error loading tasks</BodyText>
        </View>
      ) : (
        <FlatList
          data={allTasks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TaskCard
              task={item}
              onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })}
            />
          )}
          ItemSeparatorComponent={() => <View className="h-4" />}
          contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={() => {
            if (isFetchingNextPage) {
              return (
                <View className="py-md justify-center items-center">
                  <ActivityIndicator size="small" color="#0066FF" />
                </View>
              );
            }
            return null;
          }}
          ListEmptyComponent={() => (
            <View className="flex-1 justify-center items-center p-lg gap-md mt-xl">
              <DisplayText className="text-4xl text-center">🔍</DisplayText>
              <HeadingText className="text-textPrimary-light dark:text-textPrimary-dark font-bold text-center mt-sm">
                No matching tasks
              </HeadingText>
              <CaptionText className="text-center">
                Try adjusting your search query or status filter.
              </CaptionText>
            </View>
          )}
        />
      )}
    </View>
  );
}

function getOrdinalSuffix(day: number) {
  if (day > 3 && day < 21) return 'th';
  switch (day % 10) {
    case 1:  return "st";
    case 2:  return "nd";
    case 3:  return "rd";
    default: return "th";
  }
}

function getFriendlyRecurrence(template: any) {
  const time = template.time_of_day ? template.time_of_day.slice(0, 5) : '';
  const displayTime = time ? ` at ${time}` : '';
  
  switch (template.recurrence_type) {
    case 'daily':
      return `Daily${displayTime}`;
    case 'weekly':
      const days = template.days_of_week || [];
      const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayNames = days.map((d: number) => weekdays[d]).join(', ');
      return `Weekly on ${dayNames}${displayTime}`;
    case 'monthly':
      return `Monthly on the ${template.day_of_month}${getOrdinalSuffix(template.day_of_month)}${displayTime}`;
    case 'custom_interval':
      return `Every ${template.interval_days} day${template.interval_days > 1 ? 's' : ''}${displayTime}`;
    default:
      return '';
  }
}

// Templates Tab Stack Screens
function TemplatesScreen({ navigation }: any) {
  const { data: templates, isLoading, error } = useTemplates();

  const sortedTemplates = [...(templates || [])].sort((a, b) => {
    if (a.is_active === b.is_active) {
      return a.title.localeCompare(b.title);
    }
    return a.is_active ? -1 : 1; // Active first
  });

  return (
    <View className="flex-1 bg-background-light dark:bg-background-dark px-md pt-lg">
      <View className="mb-md flex-row justify-between items-center">
        <DisplayText className="text-textPrimary-light dark:text-textPrimary-dark font-extrabold text-3xl">
          Templates
        </DisplayText>
      </View>

      {isLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="small" color="#0066FF" />
        </View>
      ) : error ? (
        <View className="flex-1 justify-center items-center gap-sm">
          <BodyText className="text-accent-light font-semibold">Failed to load templates</BodyText>
        </View>
      ) : sortedTemplates.length === 0 ? (
        <View className="flex-1 justify-center items-center p-lg gap-md">
          <HeadingText className="text-textPrimary-light dark:text-textPrimary-dark font-bold text-center">
            No templates yet
          </HeadingText>
          <CaptionText className="text-center px-lg">
            Create recurring templates to automate daily, weekly, or custom repeating tasks.
          </CaptionText>
        </View>
      ) : (
        <FlatList
          data={sortedTemplates}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => navigation.navigate('EditTemplate', { templateId: item.id })}
              className={`p-md rounded-2xl border ${
                item.is_active
                  ? 'bg-card-light dark:bg-card-dark border-border-light dark:border-border-dark'
                  : 'bg-surface-light dark:bg-surface-dark border-border-light dark:border-border-dark opacity-60'
              }`}
            >
              <View className="flex-row justify-between items-start mb-xs">
                <HeadingText className="text-textPrimary-light dark:text-textPrimary-dark font-bold flex-1 mr-sm text-base">
                  {item.title}
                </HeadingText>
                <View className={`px-sm py-xs rounded-full ${item.is_active ? 'bg-success-light/10' : 'bg-red-500/10'}`}>
                  <CaptionText className={`font-bold text-[10px] ${item.is_active ? 'text-success-light dark:text-success-dark' : 'text-red-500'}`}>
                    {item.is_active ? 'ACTIVE' : 'INACTIVE'}
                  </CaptionText>
                </View>
              </View>
              <BodyText className="text-textSecondary-light dark:text-textSecondary-dark text-sm mt-xs">
                🔁 {getFriendlyRecurrence(item)}
              </BodyText>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View className="h-4" />}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Floating Action Button (FAB) for creating templates */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => navigation.navigate('CreateTemplate')}
        className="absolute bottom-6 right-6 w-14 h-14 bg-primary-light dark:bg-primary-dark rounded-full justify-center items-center shadow-lg"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 4.65,
          elevation: 8,
        }}
      >
        <DisplayText className="text-white text-3xl font-light">+</DisplayText>
      </TouchableOpacity>
    </View>
  );
}

// Settings Tab Screen
function SettingsScreen({ route }: any) {
  const { setAuth } = route.params || {};
  const { data: profile, isLoading, error } = useUserProfile();
  const updateMutation = useUpdateUserProfile();
  const [themePreference, setThemePreference] = useState<'light' | 'dark' | 'system'>('system');
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync('theme_preference').then((val) => {
      if (val === 'light' || val === 'dark' || val === 'system') {
        setThemePreference(val);
      }
    });
  }, []);

  const handleThemeChange = async (pref: 'light' | 'dark' | 'system') => {
    setThemePreference(pref);
    await SecureStore.setItemAsync('theme_preference', pref);
    DeviceEventEmitter.emit('THEME_PREFERENCE_CHANGED', pref);
  };

  const handleToggle = (key: 'briefing_enabled' | 'push_enabled' | 'email_enabled', value: boolean) => {
    updateMutation.mutate({ [key]: value }, {
      onError: (err) => {
        Alert.alert('Error', err.message || 'Failed to update preferences');
      }
    });
  };

  const getBriefingTimeDate = (): Date => {
    const d = new Date();
    const timeStr = profile?.briefing_time || '05:55';
    const [h, m] = timeStr.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  };

  const formatBriefingTime12h = (timeStr: string = '05:55'): string => {
    const [hStr, mStr] = timeStr.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    const displayMinute = String(m).padStart(2, '0');
    return `${displayHour}:${displayMinute} ${ampm}`;
  };

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark">
        <ActivityIndicator size="small" color="#0066FF" />
      </View>
    );
  }

  const syncStatusText = profile?.sync_status === 'healthy' ? 'Connected' : 'Reconnection needed';
  const syncStatusColor = profile?.sync_status === 'healthy' ? 'text-success-light dark:text-success-dark' : 'text-accent-light dark:text-accent-dark';

  return (
    <ScrollView className="flex-1 bg-background-light dark:bg-background-dark px-md pt-lg">
      <DisplayText className="text-textPrimary-light dark:text-textPrimary-dark font-extrabold text-3xl mb-lg">
        Settings
      </DisplayText>

      {/* Account Section */}
      <View className="mb-lg">
        <HeadingText className="mb-xs font-bold text-textSecondary-light dark:text-textSecondary-dark text-sm uppercase tracking-wider">
          Account
        </HeadingText>
        <View className="bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark p-md rounded-2xl gap-sm">
          <View className="flex-row justify-between items-center">
            <BodyText className="text-textPrimary-light dark:text-textPrimary-dark font-semibold">Email</BodyText>
            <BodyText className="text-textSecondary-light dark:text-textSecondary-dark">{profile?.email}</BodyText>
          </View>
          <View className="flex-row justify-between items-center border-t border-border-light dark:border-border-dark pt-sm">
            <BodyText className="text-textPrimary-light dark:text-textPrimary-dark font-semibold">Google Calendar</BodyText>
            <BodyText className={`font-bold ${syncStatusColor}`}>{syncStatusText}</BodyText>
          </View>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={async () => {
              await SecureStore.deleteItemAsync('user_jwt_token');
              setAuth?.(false);
            }}
            className="mt-sm bg-red-500/10 p-sm rounded-xl items-center"
          >
            <CaptionText className="text-red-500 font-bold text-sm">
              🚪 Log Out
            </CaptionText>
          </TouchableOpacity>
        </View>
      </View>

      {/* Notifications Section */}
      <View className="mb-lg">
        <HeadingText className="mb-xs font-bold text-textSecondary-light dark:text-textSecondary-dark text-sm uppercase tracking-wider">
          Notifications
        </HeadingText>
        <View className="bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark p-md rounded-2xl gap-md">
          <View className="flex-row justify-between items-center">
            <View className="flex-1 mr-sm">
              <BodyText className="text-textPrimary-light dark:text-textPrimary-dark font-semibold">Daily Briefing</BodyText>
              <CaptionText className="text-xs leading-4">
                {profile?.briefing_enabled
                  ? `Receive a summary of today's schedule at ${formatBriefingTime12h(profile?.briefing_time)}.`
                  : "Receive a summary of today's schedule at 5:55 AM local time."}
              </CaptionText>
            </View>
            <Switch
              value={profile?.briefing_enabled}
              onValueChange={(val) => handleToggle('briefing_enabled', val)}
              trackColor={{ false: '#767577', true: '#0066FF' }}
              thumbColor={Platform.OS === 'ios' ? undefined : '#f4f3f4'}
            />
          </View>

          {profile?.briefing_enabled && (
            <View className="flex-row justify-between items-center border-t border-border-light dark:border-border-dark pt-md">
              <View className="flex-1 mr-sm">
                <BodyText className="text-textPrimary-light dark:text-textPrimary-dark font-semibold">Briefing Time</BodyText>
                <CaptionText className="text-xs leading-4">
                  Briefing delivered at {formatBriefingTime12h(profile?.briefing_time)}
                </CaptionText>
              </View>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setShowPicker(true)}
                className="bg-primary-light/10 dark:bg-primary-dark/20 px-md py-xs rounded-xl"
              >
                <BodyText className="text-primary-light dark:text-primary-dark font-bold text-sm">
                  Choose Time
                </BodyText>
              </TouchableOpacity>
            </View>
          )}

          <View className="flex-row justify-between items-center border-t border-border-light dark:border-border-dark pt-md">
            <View className="flex-1 mr-sm">
              <BodyText className="text-textPrimary-light dark:text-textPrimary-dark font-semibold">Push Notifications</BodyText>
              <CaptionText className="text-xs leading-4">Receive dynamic alerts on this device for upcoming deadlines.</CaptionText>
            </View>
            <Switch
              value={profile?.push_enabled}
              onValueChange={(val) => handleToggle('push_enabled', val)}
              trackColor={{ false: '#767577', true: '#0066FF' }}
              thumbColor={Platform.OS === 'ios' ? undefined : '#f4f3f4'}
            />
          </View>

          <View className="flex-row justify-between items-center border-t border-border-light dark:border-border-dark pt-md">
            <View className="flex-1 mr-sm">
              <BodyText className="text-textPrimary-light dark:text-textPrimary-dark font-semibold">Email Alerts</BodyText>
              <CaptionText className="text-xs leading-4">Receive warning reminders to your connected Google email address.</CaptionText>
            </View>
            <Switch
              value={profile?.email_enabled}
              onValueChange={(val) => handleToggle('email_enabled', val)}
              trackColor={{ false: '#767577', true: '#0066FF' }}
              thumbColor={Platform.OS === 'ios' ? undefined : '#f4f3f4'}
            />
          </View>
        </View>
      </View>

      {showPicker && (
        <DateTimePicker
          value={getBriefingTimeDate()}
          mode="time"
          display="default"
          onChange={(event: any, selectedDate?: Date) => {
            setShowPicker(false);
            if (selectedDate) {
              const hours = String(selectedDate.getHours()).padStart(2, '0');
              const minutes = String(selectedDate.getMinutes()).padStart(2, '0');
              const timeStr = `${hours}:${minutes}`;
              updateMutation.mutate({ briefingTime: timeStr }, {
                onError: (err) => {
                  Alert.alert('Error', err.message || 'Failed to update briefing time');
                }
              });
            }
          }}
        />
      )}

      {/* Appearance Section */}
      <View className="mb-xl">
        <HeadingText className="mb-xs font-bold text-textSecondary-light dark:text-textSecondary-dark text-sm uppercase tracking-wider">
          Appearance
        </HeadingText>
        <View className="bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark p-md rounded-2xl">
          <View className="flex-row gap-xs">
            {(['light', 'dark', 'system'] as const).map((pref) => {
              const isSelected = themePreference === pref;
              const label = pref.charAt(0).toUpperCase() + pref.slice(1);
              return (
                <TouchableOpacity
                  key={pref}
                  activeOpacity={0.8}
                  onPress={() => handleThemeChange(pref)}
                  className={`flex-1 py-sm rounded-xl border items-center justify-center ${
                    isSelected
                      ? 'bg-primary-light dark:bg-primary-dark border-primary-light dark:border-primary-dark'
                      : 'border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark'
                  }`}
                >
                  <CaptionText className={`font-bold ${isSelected ? 'text-white' : 'text-text-secondary-light dark:text-text-secondary-dark'}`}>
                    {label}
                  </CaptionText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function CreateTemplateScreen({ navigation }: any) {
  const createTemplateMutation = useCreateTemplate();
  const [title, setTitle] = useState('');
  const [recurrenceType, setRecurrenceType] = useState<'daily' | 'weekly' | 'monthly' | 'custom_interval'>('daily');
  const [timeOfDay, setTimeOfDay] = useState<Date>(() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0); // Default to 09:00 AM
    return d;
  });
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Weekly state (array of numbers 0..6)
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);

  // Monthly state (1..31)
  const [dayOfMonth, setDayOfMonth] = useState('1');

  // Custom interval state (positive integer)
  const [intervalDays, setIntervalDays] = useState('1');

  const toggleDayOfWeek = (day: number) => {
    if (daysOfWeek.includes(day)) {
      setDaysOfWeek(daysOfWeek.filter((d) => d !== day));
    } else {
      setDaysOfWeek([...daysOfWeek, day].sort());
    }
  };

  const handleTimeChange = (_event: any, selectedTime?: Date) => {
    setShowTimePicker(false);
    if (selectedTime) {
      setTimeOfDay(selectedTime);
    }
  };

  const handleSave = () => {
    if (!title.trim()) {
      Alert.alert('Validation Error', 'Title is required.');
      return;
    }

    // Extract HH:MM
    const hours = String(timeOfDay.getHours()).padStart(2, '0');
    const minutes = String(timeOfDay.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const payload: any = {
      title: title.trim(),
      recurrence_type: recurrenceType,
      time_of_day: timeStr,
      timezone_snapshot: timezone,
    };

    if (recurrenceType === 'weekly') {
      if (daysOfWeek.length === 0) {
        Alert.alert('Validation Error', 'Please select at least one day of the week.');
        return;
      }
      payload.days_of_week = daysOfWeek;
    } else if (recurrenceType === 'monthly') {
      const dom = parseInt(dayOfMonth, 10);
      if (isNaN(dom) || dom < 1 || dom > 31) {
        Alert.alert('Validation Error', 'Day of month must be a number between 1 and 31.');
        return;
      }
      payload.day_of_month = dom;
    } else if (recurrenceType === 'custom_interval') {
      const val = parseInt(intervalDays, 10);
      if (isNaN(val) || val <= 0) {
        Alert.alert('Validation Error', 'Interval days must be a positive integer.');
        return;
      }
      payload.interval_days = val;
    }

    createTemplateMutation.mutate(payload, {
      onSuccess: () => {
        Alert.alert('Success', 'Recurring template created successfully.');
        navigation.goBack();
      },
      onError: (err) => {
        Alert.alert('Error', err.message || 'Failed to create template');
      },
    });
  };

  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <ScrollView className="flex-1 bg-background-light dark:bg-background-dark px-md pt-lg">
      {/* Header Row */}
      <View className="flex-row justify-between items-center mb-lg">
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <CaptionText className="text-primary-light dark:text-primary-dark font-semibold text-base">
            ← Cancel
          </CaptionText>
        </TouchableOpacity>
        <HeadingText className="font-bold">New Recurring Template</HeadingText>
        <View className="w-10" />
      </View>

      {/* Input Group: Title */}
      <View className="mb-md">
        <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
          Template Title
        </CaptionText>
        <TextInput
          placeholder="e.g., Take medication, Daily check-in..."
          placeholderTextColor="#999"
          value={title}
          onChangeText={setTitle}
          className="border border-border-light dark:border-border-dark p-md rounded-2xl text-textPrimary-light dark:text-textPrimary-dark text-base bg-card-light dark:bg-card-dark"
        />
      </View>

      {/* Input Group: Recurrence Type Segmented Control */}
      <View className="mb-md">
        <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
          Recurrence Type
        </CaptionText>
        <View className="flex-row flex-wrap gap-xs">
          {(['daily', 'weekly', 'monthly', 'custom_interval'] as const).map((type) => {
            const isSelected = recurrenceType === type;
            const label = type === 'custom_interval' ? 'Custom' : type.charAt(0).toUpperCase() + type.slice(1);
            return (
              <TouchableOpacity
                key={type}
                activeOpacity={0.8}
                onPress={() => setRecurrenceType(type)}
                className={`px-md py-sm rounded-xl border ${
                  isSelected
                    ? 'bg-primary-light dark:bg-primary-dark border-primary-light dark:border-primary-dark'
                    : 'border-border-light dark:border-border-dark bg-card-light dark:bg-card-dark'
                }`}
              >
                <CaptionText className={`font-bold ${isSelected ? 'text-white' : 'text-text-secondary-light dark:text-text-secondary-dark'}`}>
                  {label}
                </CaptionText>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Conditional Fields depending on selected type */}
      {recurrenceType === 'weekly' && (
        <View className="mb-md bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark p-md rounded-2xl">
          <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
            Select Days of Week
          </CaptionText>
          <View className="flex-row justify-between mt-xs">
            {weekdays.map((day, index) => {
              const isSelected = daysOfWeek.includes(index);
              return (
                <TouchableOpacity
                  key={index}
                  activeOpacity={0.7}
                  onPress={() => toggleDayOfWeek(index)}
                  className={`w-10 h-10 rounded-full items-center justify-center ${
                    isSelected ? 'bg-primary-light dark:bg-primary-dark' : 'bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark'
                  }`}
                >
                  <BodyText className={`font-bold text-sm ${isSelected ? 'text-white' : 'text-textPrimary-light dark:text-textPrimary-dark'}`}>
                    {day}
                  </BodyText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {recurrenceType === 'monthly' && (
        <View className="mb-md bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark p-md rounded-2xl gap-sm">
          <View>
            <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
              Day of Month (1 - 31)
            </CaptionText>
            <TextInput
              keyboardType="number-pad"
              placeholder="e.g. 15"
              placeholderTextColor="#999"
              value={dayOfMonth}
              onChangeText={setDayOfMonth}
              className="border border-border-light dark:border-border-dark p-sm rounded-xl text-textPrimary-light dark:text-textPrimary-dark text-base bg-surface-light dark:bg-surface-dark"
            />
          </View>
          <CaptionText className="text-text-secondary-light dark:text-text-secondary-dark text-xs italic leading-4">
            ℹ️ If the selected day doesn't exist in a month (e.g. Feb 30th), the template generator will automatically skip that month.
          </CaptionText>
        </View>
      )}

      {recurrenceType === 'custom_interval' && (
        <View className="mb-md bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark p-md rounded-2xl">
          <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
            Interval (Every N Days)
          </CaptionText>
          <TextInput
            keyboardType="number-pad"
            placeholder="e.g. 3"
            placeholderTextColor="#999"
            value={intervalDays}
            onChangeText={setIntervalDays}
            className="border border-border-light dark:border-border-dark p-sm rounded-xl text-textPrimary-light dark:text-textPrimary-dark text-base bg-surface-light dark:bg-surface-dark"
          />
        </View>
      )}

      {/* Input Group: Time of Day */}
      <View className="mb-lg">
        <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
          Time of Day
        </CaptionText>
        <View className="border border-border-light dark:border-border-dark p-md rounded-2xl bg-card-light dark:bg-card-dark flex-row items-center justify-between">
          <BodyText className="text-textPrimary-light dark:text-textPrimary-dark font-medium">
            {timeOfDay.toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </BodyText>
          <TouchableOpacity
            onPress={() => setShowTimePicker(true)}
            className="bg-primary-light/10 px-sm py-xs rounded-lg"
          >
            <CaptionText className="text-primary-light dark:text-primary-dark font-bold text-xs">
              Set Time
            </CaptionText>
          </TouchableOpacity>
        </View>
      </View>

      {/* Date Picker Components */}
      {showTimePicker && (
        <DateTimePicker
          value={timeOfDay}
          mode="time"
          display="default"
          onChange={handleTimeChange}
        />
      )}

      {/* Universal Anchor Explanation Note */}
      <View className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark p-sm rounded-xl mb-md">
        <CaptionText className="text-text-secondary-light dark:text-text-secondary-dark text-xs text-center leading-5 font-medium">
          ℹ️ Universal Anchor Rule: Your first repeating task instance will start generating tomorrow, not today.
        </CaptionText>
      </View>

      {/* Action Buttons */}
      <View className="gap-md mt-md mb-xl">
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleSave}
          disabled={createTemplateMutation.isPending}
          className="bg-primary-light dark:bg-primary-dark p-md rounded-2xl justify-center items-center"
        >
          {createTemplateMutation.isPending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <BodyText className="text-white font-bold">
              💾 Save Recurring Template
            </BodyText>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function EditTemplateScreen({ route, navigation }: any) {
  const { templateId } = route.params || {};
  const { data: template, isLoading } = useTemplateDetail(templateId);
  const updateMutation = useUpdateTemplate(templateId);
  const deactivateMutation = useDeactivateTemplate(templateId);

  const [title, setTitle] = useState('');
  const [timeOfDay, setTimeOfDay] = useState<Date>(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [intervalDays, setIntervalDays] = useState('1');

  useEffect(() => {
    if (template) {
      setTitle(template.title);
      if (template.time_of_day) {
        const [h, m] = template.time_of_day.split(':');
        const d = new Date();
        d.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
        setTimeOfDay(d);
      }
      if (template.days_of_week) {
        setDaysOfWeek(template.days_of_week);
      }
      if (template.day_of_month) {
        setDayOfMonth(String(template.day_of_month));
      }
      if (template.interval_days) {
        setIntervalDays(String(template.interval_days));
      }
    }
  }, [template]);

  const handleTimeChange = (_event: any, selectedTime?: Date) => {
    setShowTimePicker(false);
    if (selectedTime) {
      setTimeOfDay(selectedTime);
    }
  };

  const toggleDayOfWeek = (day: number) => {
    if (daysOfWeek.includes(day)) {
      setDaysOfWeek(daysOfWeek.filter((d) => d !== day));
    } else {
      setDaysOfWeek([...daysOfWeek, day].sort());
    }
  };

  const handleSave = () => {
    if (!title.trim()) {
      Alert.alert('Validation Error', 'Title is required.');
      return;
    }

    const hours = String(timeOfDay.getHours()).padStart(2, '0');
    const minutes = String(timeOfDay.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;

    const payload: any = {
      title: title.trim(),
      time_of_day: timeStr,
    };

    if (template?.recurrence_type === 'weekly') {
      if (daysOfWeek.length === 0) {
        Alert.alert('Validation Error', 'Please select at least one day of the week.');
        return;
      }
      payload.days_of_week = daysOfWeek;
    } else if (template?.recurrence_type === 'monthly') {
      const dom = parseInt(dayOfMonth, 10);
      if (isNaN(dom) || dom < 1 || dom > 31) {
        Alert.alert('Validation Error', 'Day of month must be a number between 1 and 31.');
        return;
      }
      payload.day_of_month = dom;
    } else if (template?.recurrence_type === 'custom_interval') {
      const val = parseInt(intervalDays, 10);
      if (isNaN(val) || val <= 0) {
        Alert.alert('Validation Error', 'Interval days must be a positive integer.');
        return;
      }
      payload.interval_days = val;
    }

    updateMutation.mutate(payload, {
      onSuccess: () => {
        Alert.alert('Success', 'Template updated successfully.');
        navigation.goBack();
      },
      onError: (err) => {
        Alert.alert('Error', err.message || 'Failed to update template');
      }
    });
  };

  const handleDeactivate = () => {
    Alert.alert(
      'Deactivate Template',
      'Are you sure you want to deactivate this recurrence template? This will stop future task instances from being generated.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: () => {
            deactivateMutation.mutate(undefined, {
              onSuccess: () => {
                Alert.alert('Success', 'Template deactivated.');
                navigation.goBack();
              },
              onError: (err) => {
                Alert.alert('Error', err.message || 'Failed to deactivate template');
              }
            });
          }
        }
      ]
    );
  };

  if (isLoading || !template) {
    return (
      <View className="flex-1 justify-center items-center bg-background-light dark:bg-background-dark">
        <ActivityIndicator size="small" color="#0066FF" />
      </View>
    );
  }

  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <ScrollView className="flex-1 bg-background-light dark:bg-background-dark px-md pt-lg">
      <View className="flex-row justify-between items-center mb-lg">
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <CaptionText className="text-primary-light dark:text-primary-dark font-semibold text-base">
            ← Cancel
          </CaptionText>
        </TouchableOpacity>
        <HeadingText className="font-bold">Edit Template</HeadingText>
        <View className="w-10" />
      </View>

      {/* Info Badge */}
      <View className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark p-sm rounded-xl mb-md flex-row items-center justify-between">
        <CaptionText className="font-semibold text-xs text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
          Type: {template.recurrence_type}
        </CaptionText>
        <View className={`px-sm py-xs rounded-full ${template.is_active ? 'bg-success-light/10' : 'bg-red-500/10'}`}>
          <CaptionText className={`font-bold text-xs ${template.is_active ? 'text-success-light dark:text-success-dark' : 'text-red-500'}`}>
            {template.is_active ? '● Active' : '● Inactive'}
          </CaptionText>
        </View>
      </View>

      {/* Input Group: Title */}
      <View className="mb-md">
        <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
          Template Title
        </CaptionText>
        <TextInput
          editable={template.is_active}
          value={title}
          onChangeText={setTitle}
          className="border border-border-light dark:border-border-dark p-md rounded-2xl text-textPrimary-light dark:text-textPrimary-dark text-base bg-card-light dark:bg-card-dark"
        />
      </View>

      {/* Conditional Fields depending on type */}
      {template.recurrence_type === 'weekly' && (
        <View className="mb-md bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark p-md rounded-2xl">
          <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
            Select Days of Week
          </CaptionText>
          <View className="flex-row justify-between mt-xs">
            {weekdays.map((day, index) => {
              const isSelected = daysOfWeek.includes(index);
              return (
                <TouchableOpacity
                  key={index}
                  disabled={!template.is_active}
                  activeOpacity={0.7}
                  onPress={() => toggleDayOfWeek(index)}
                  className={`w-10 h-10 rounded-full items-center justify-center ${
                    isSelected ? 'bg-primary-light dark:bg-primary-dark' : 'bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark'
                  }`}
                >
                  <BodyText className={`font-bold text-sm ${isSelected ? 'text-white' : 'text-textPrimary-light dark:text-textPrimary-dark'}`}>
                    {day}
                  </BodyText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {template.recurrence_type === 'monthly' && (
        <View className="mb-md bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark p-md rounded-2xl gap-sm">
          <View>
            <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
              Day of Month (1 - 31)
            </CaptionText>
            <TextInput
              editable={template.is_active}
              keyboardType="number-pad"
              value={dayOfMonth}
              onChangeText={setDayOfMonth}
              className="border border-border-light dark:border-border-dark p-sm rounded-xl text-textPrimary-light dark:text-textPrimary-dark text-base bg-surface-light dark:bg-surface-dark"
            />
          </View>
          <CaptionText className="text-text-secondary-light dark:text-text-secondary-dark text-xs italic leading-4">
            ℹ️ If the selected day doesn't exist in a month, the template generator will automatically skip that month.
          </CaptionText>
        </View>
      )}

      {template.recurrence_type === 'custom_interval' && (
        <View className="mb-md bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark p-md rounded-2xl">
          <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
            Interval (Every N Days)
          </CaptionText>
          <TextInput
            editable={template.is_active}
            keyboardType="number-pad"
            value={intervalDays}
            onChangeText={setIntervalDays}
            className="border border-border-light dark:border-border-dark p-sm rounded-xl text-textPrimary-light dark:text-textPrimary-dark text-base bg-surface-light dark:bg-surface-dark"
          />
        </View>
      )}

      {/* Time of Day */}
      <View className="mb-lg">
        <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
          Time of Day
        </CaptionText>
        <View className="border border-border-light dark:border-border-dark p-md rounded-2xl bg-card-light dark:bg-card-dark flex-row items-center justify-between">
          <BodyText className="text-textPrimary-light dark:text-textPrimary-dark font-medium">
            {timeOfDay.toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </BodyText>
          <TouchableOpacity
            disabled={!template.is_active}
            onPress={() => setShowTimePicker(true)}
            className="bg-primary-light/10 px-sm py-xs rounded-lg"
          >
            <CaptionText className="text-primary-light dark:text-primary-dark font-bold text-xs">
              Set Time
            </CaptionText>
          </TouchableOpacity>
        </View>
      </View>

      {showTimePicker && (
        <DateTimePicker
          value={timeOfDay}
          mode="time"
          display="default"
          onChange={handleTimeChange}
        />
      )}

      <View className="gap-md mt-md mb-xl">
        {template.is_active && (
          <>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleSave}
              disabled={updateMutation.isPending}
              className="bg-primary-light dark:bg-primary-dark p-md rounded-2xl justify-center items-center"
            >
              {updateMutation.isPending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <BodyText className="text-white font-bold">
                  💾 Save Changes
                </BodyText>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleDeactivate}
              disabled={deactivateMutation.isPending}
              className="border border-red-500/30 p-md rounded-2xl justify-center items-center"
            >
              {deactivateMutation.isPending ? (
                <ActivityIndicator size="small" color="red" />
              ) : (
                <BodyText className="text-red-500 font-bold">
                  🚫 Deactivate Template
                </BodyText>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
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
      <Stack.Screen name="AllTasks" component={AllTasksScreen} options={{ title: 'Search Tasks' }} />
    </Stack.Navigator>
  );
}

// Templates Tab Sub-Stack
function TemplatesTabStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="TemplatesMain" component={TemplatesScreen} options={{ title: 'Templates' }} />
      <Stack.Screen name="CreateTemplate" component={CreateTemplateScreen} options={{ title: 'New Template' }} />
      <Stack.Screen name="EditTemplate" component={EditTemplateScreen} options={{ title: 'Edit Template' }} />
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

  // FCM Token Refresh & Sync logic
  useEffect(() => {
    if (!isAuthenticated) return;

    let isMounted = true;
    let unsubscribeRefresh: (() => void) | undefined;

    async function syncFCMToken(token: string) {
      try {
        console.log('[FCM Sync] Syncing FCM token with backend:', token);
        await apiFetch('/users/me/fcm-token', {
          method: 'PATCH',
          body: JSON.stringify({ fcmToken: token }),
        });
        console.log('[FCM Sync] FCM token successfully synced.');
      } catch (err) {
        console.error('[FCM Sync] Failed to sync FCM token to backend:', err);
      }
    }

    async function setupFCM() {
      if (!messaging) {
        console.log('[FCM Setup] FCM messaging is not available (running in Expo Go / simulator). Skipping configuration.');
        return;
      }
      try {
        // Request Permission (standard FCM client setup)
        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (enabled) {
          // Get current token (runs on every app launch when session is valid)
          const token = await messaging().getToken();
          if (token && isMounted) {
            await syncFCMToken(token);
          }

          // Register token refresh listener
          unsubscribeRefresh = messaging().onTokenRefresh(async (newToken: string) => {
            if (isMounted) {
              await syncFCMToken(newToken);
            }
          });
        } else {
          console.log('[FCM Setup] FCM notification permissions denied.');
        }
      } catch (err) {
        console.error('[FCM Setup] Error setting up FCM messaging:', err);
      }
    }

    setupFCM();

    return () => {
      isMounted = false;
      if (unsubscribeRefresh) {
        unsubscribeRefresh();
      }
    };
  }, [isAuthenticated]);

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
            <DisplayText className="text-textPrimary-light dark:text-textPrimary-dark font-extrabold text-center tracking-widest">
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
