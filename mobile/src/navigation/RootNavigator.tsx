import React, { useState, useEffect } from 'react';
import { View, Button, ActivityIndicator, DeviceEventEmitter, FlatList, TextInput, TouchableOpacity, Alert, ScrollView, Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import DateTimePicker from '@react-native-community/datetimepicker';

import { DisplayText, HeadingText, BodyText, CaptionText } from '../components/Typography';
import { BASE_URL } from '../api/client';
import { useTodayTasks, Task } from '../hooks/useTodayTasks';
import { TaskCard } from '../components/TaskCard';
import { useTaskDetail, useUpdateTask, useDeleteTask } from '../hooks/useTaskDetail';
import { useCreateTask } from '../hooks/useCreateTask';
import { useCreateTemplate } from '../hooks/useCreateTemplate';

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
function TodayScreen({ navigation }: any) {
  const { data: tasks, isLoading, error } = useTodayTasks();

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
        <CaptionText className="text-primary-light dark:text-primary-dark font-bold uppercase tracking-wider">
          {todayDateString}
        </CaptionText>
        <DisplayText className="text-text-primary-light dark:text-text-primary-dark font-extrabold text-3xl">
          Today
        </DisplayText>
        
        {/* Sync Disclaimer */}
        <CaptionText className="text-text-secondary-light dark:text-text-secondary-dark mt-xs text-xs leading-5">
          ⚠️ Calendar sync may take a few minutes to reflect changes made directly in Google Calendar.
        </CaptionText>
      </View>

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
            <HeadingText className="text-text-primary-light dark:text-text-primary-dark font-bold text-center">
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
          className={`border border-border-light dark:border-border-dark p-md rounded-2xl text-text-primary-light dark:text-text-primary-dark text-base ${
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
          <BodyText className="text-text-primary-light dark:text-text-primary-dark font-medium">
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
            <BodyText className={`font-bold ${isCompleted ? 'text-text-primary-light dark:text-text-primary-dark' : 'text-white'}`}>
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
          className="border border-border-light dark:border-border-dark p-md rounded-2xl text-text-primary-light dark:text-text-primary-dark text-base bg-card-light dark:bg-card-dark"
        />
      </View>

      {/* Input Group: Deadline picker */}
      <View className="mb-lg">
        <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
          Deadline (Optional)
        </CaptionText>
        <View className="border border-border-light dark:border-border-dark p-md rounded-2xl bg-card-light dark:bg-card-dark flex-row items-center justify-between">
          <BodyText className="text-text-primary-light dark:text-text-primary-dark font-medium">
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
          className="border border-border-light dark:border-border-dark p-md rounded-2xl text-text-primary-light dark:text-text-primary-dark text-base bg-card-light dark:bg-card-dark"
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
                  <BodyText className={`font-bold text-sm ${isSelected ? 'text-white' : 'text-text-primary-light dark:text-text-primary-dark'}`}>
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
              className="border border-border-light dark:border-border-dark p-sm rounded-xl text-text-primary-light dark:text-text-primary-dark text-base bg-surface-light dark:bg-surface-dark"
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
            className="border border-border-light dark:border-border-dark p-sm rounded-xl text-text-primary-light dark:text-text-primary-dark text-base bg-surface-light dark:bg-surface-dark"
          />
        </View>
      )}

      {/* Input Group: Time of Day */}
      <View className="mb-lg">
        <CaptionText className="mb-xs font-bold text-text-secondary-light dark:text-text-secondary-dark">
          Time of Day
        </CaptionText>
        <View className="border border-border-light dark:border-border-dark p-md rounded-2xl bg-card-light dark:bg-card-dark flex-row items-center justify-between">
          <BodyText className="text-text-primary-light dark:text-text-primary-dark font-medium">
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
