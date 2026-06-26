import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { BodyText, CaptionText } from './Typography';
import { Task } from '../hooks/useTodayTasks';

interface TaskCardProps {
  task: Task;
  onPress: () => void;
}

export function TaskCard({ task, onPress }: TaskCardProps) {
  const isCompleted = task.status === 'completed';
  
  // Compute if task is overdue
  const isOverdue = 
    task.status === 'pending' && 
    task.deadline_at && 
    new Date(task.deadline_at) < new Date();

  // Helper to format local time nicely
  const formatTime = (isoString?: string) => {
    if (!isoString) return 'All Day';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'All Day';
    }
  };

  // Determine card styles based on urgency/completion
  const cardBorderClass = isOverdue
    ? 'border-l-4 border-l-accent-light dark:border-l-accent-dark border-border-light dark:border-border-dark'
    : 'border-l-2 border-l-primary-light dark:border-l-primary-dark border-border-light dark:border-border-dark';

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      className={`bg-card-light dark:bg-card-dark border p-md rounded-2xl flex-row items-center gap-md ${cardBorderClass} ${
        isCompleted ? 'opacity-50' : ''
      }`}
      style={styles.shadow}
    >
      {/* Status Checkbox */}
      <View
        className={`w-6 h-6 rounded-full border justify-center items-center ${
          isCompleted
            ? 'bg-success-light dark:bg-success-dark border-success-light dark:border-success-dark'
            : isOverdue
            ? 'border-accent-light dark:border-accent-dark border-2'
            : 'border-border-light dark:border-border-dark'
        }`}
      >
        {isCompleted && (
          <View className="w-2.5 h-1.5 border-l-2 border-b-2 border-white rotate-[-45deg] translate-y-[-1px]" />
        )}
        {isOverdue && !isCompleted && (
          <View className="w-1 h-1.5 bg-accent-light dark:bg-accent-dark rounded-full" />
        )}
      </View>

      {/* Task Information */}
      <View className="flex-1">
        <BodyText
          className={`font-semibold ${
            isCompleted
              ? 'line-through text-text-secondary-light dark:text-text-secondary-dark'
              : isOverdue
              ? 'text-accent-light dark:text-accent-dark'
              : 'text-text-primary-light dark:text-text-primary-dark'
          }`}
        >
          {task.title}
        </BodyText>
        <CaptionText
          className={`mt-xs font-medium ${
            isOverdue && !isCompleted
              ? 'text-accent-light dark:text-accent-dark'
              : 'text-text-secondary-light dark:text-text-secondary-dark'
          }`}
        >
          {formatTime(task.deadline_at)}
          {task.google_event_id && ' • Google Calendar'}
        </CaptionText>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
});
